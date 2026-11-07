/**
 * Focused lifecycle tests for the LIVE local-weapon rig attachment flow
 * (Batch 2C, Task B) — the exact production mount sequence the runtime
 * performs, exercised on the real licensed rigged GLB with a NullEngine:
 *
 *  1. fallback mount first: the weapon root starts parented to the
 *     character `visualRoot` at the legacy (0, 0.02, -0.22) mount — the
 *     synchronous procedural-body / asset-failure position;
 *  2. rigged-body settle: once the character model exists, the runtime
 *     creates ONE `CharacterWeaponAttachment` for the instance and the
 *     weapon root is re-parented under the real right-hand joint. No
 *     meshes, nodes, or materials are created or lost by the re-parent.
 *  3. locomotion: `setTransform` (translation + yaw) moves the held
 *     weapon exactly with the body; the muzzle anchor follows;
 *  4. crouch: after scene animation frames advance the skeletal crouch
 *     clip, `setCrouchBlend(1)` lowers the hand and weapon about the
 *     planted feet while the body root stays put;
 *  5. body visibility: hiding the character hides the held weapon through
 *     the same scene-graph chain (and restores it);
 *  6. the procedural fallback path (no character at all) keeps the weapon
 *     on the visualRoot mount, fully functional;
 *  7. teardown order (attachment → character → weapon) disposes cleanly,
 *     without leaks or exceptions;
 *  8. presentation safety: every weapon mesh stays non-pickable and
 *     collision-disabled after the hand attachment (no gameplay impact).
 *
 * Note on animation: the crouch test drives the live skeletal crouch clip
 * by advancing scene animation frames (the production render lifecycle);
 * the other tests keep the joint static. The weapon-follow capability for
 * animated hands is additionally proven by the socket-movement test in
 * `characterWeaponAttachment.test.ts` (driving the joint as an animation
 * engine would).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CharacterAsset } from "./characterAsset";
import { CharacterModel } from "./CharacterModel";
import { CharacterWeaponAttachment } from "./CharacterWeaponAttachment";
import { WeaponModelPresentation } from "../WeaponModelPresentation";

const GLB_PATH = fileURLToPath(
  new URL("../../../../public/assets/character/BuildShiftBaseCharacter.glb", import.meta.url),
);

let engine: NullEngine;
let scene: Scene;

function makeScene(): void {
  engine = new NullEngine();
  scene = new Scene(engine);
}

afterEach(() => {
  scene?.dispose();
  engine?.dispose();
});

async function buildCharacter(prefix: string): Promise<CharacterModel> {
  const bytes = readFileSync(GLB_PATH);
  const asset = await CharacterAsset.fromBuffer(
    new Uint8Array(bytes).buffer,
    scene,
  );
  const model = await CharacterModel.create(scene, asset, "local", prefix);
  // The asset's root node ships disabled; in production the facade's body
  // swap enables the incoming body (`_swapBody` → `setEnabled(true)`). Mirror
  // that contract here so tests exercise the rendered (enabled) state.
  model.setEnabled(true);
  return model;
}

/** The legacy synchronous mount the runtime applies at construction. */
function mountAtPresentationRoot(
  weapon: WeaponModelPresentation,
  visualRoot: TransformNode,
): void {
  weapon.root.parent = visualRoot;
  weapon.root.position.set(0, 0.02, -0.22);
}

/** World position with a forced matrix refresh (cloned — Babylon returns the node's internal vector). */
function worldPos(node: TransformNode): Vector3 {
  node.computeWorldMatrix(true);
  return node.getAbsolutePosition().clone();
}

describe("live rig attachment — production mount flow", () => {
  it("re-parents the weapon from the fallback mount to the hand joint without leaks", async () => {
    makeScene();
    const model = await buildCharacter("lw-a");
    const weapon = WeaponModelPresentation.create(scene, "lwA");
    mountAtPresentationRoot(weapon, model.visualRoot);
    expect(weapon.root.parent).toBe(model.visualRoot);

    const meshesBefore = scene.meshes.length;
    const nodesBefore = scene.transformNodes.length;
    const materialsBefore = scene.materials.length;

    // The settle path: one attachment for the settled character instance.
    const attachment = CharacterWeaponAttachment.create(scene, "lw-a");
    expect(attachment.socketSource).toBe("joint");
    attachment.attach(weapon);

    expect(weapon.root.parent).toBe(attachment.socket);
    expect(attachment.attachedWeapon).toBe(weapon);
    // Pure re-parent: nothing was created or lost.
    expect(scene.meshes.length).toBe(meshesBefore);
    expect(scene.transformNodes.length).toBe(nodesBefore);
    expect(scene.materials.length).toBe(materialsBefore);
    // The legacy mount is gone from the weapon root (now under the joint;
    // the armature — and hence the joint — is itself a descendant of the
    // character's visualRoot, so descendant checks are meaningless here).
    expect(weapon.root.parent).not.toBe(model.visualRoot);
    weapon.dispose();
    attachment.dispose();
    model.dispose();
  });

  it("weapon follows body translation and yaw through setTransform", async () => {
    makeScene();
    const model = await buildCharacter("lw-b");
    const weapon = WeaponModelPresentation.create(scene, "lwB");
    const attachment = CharacterWeaponAttachment.create(scene, "lw-b");
    attachment.attach(weapon);

    const start = worldPos(weapon.root);
    // Translation only (same yaw): the weapon must move exactly with the
    // body (its local hold offset is constant in the body frame).
    const moved = { x: start.x + 2.5, y: start.y + 0.25, z: start.z - 1.5 };
    model.setTransform(moved, 0);
    const afterMove = worldPos(weapon.root);
    // The body-to-weapon offset must be unchanged by the move.
    expect(Vector3.Distance(afterMove, new Vector3(moved.x, moved.y, moved.z))).toBeCloseTo(
      Vector3.Distance(start, new Vector3(0, 0, 0)),
      5,
    );
    // Yaw: same position, new facing — the weapon orbits the body axis.
    model.setTransform(moved, 1.3);
    const afterYaw = worldPos(weapon.root);
    expect(Vector3.Distance(afterYaw, afterMove)).toBeGreaterThan(0.2);
    // The muzzle anchor (flash / tracer origin, presentation only) follows.
    const muzzle = new Vector3();
    weapon.getMuzzlePosition(muzzle);
    expect(Vector3.Distance(muzzle, afterYaw)).toBeLessThan(1.0);
    weapon.dispose();
    attachment.dispose();
    model.dispose();
  });

  it("weapon lowers with crouch about the planted feet", async () => {
    makeScene();
    // The live character crouches through an authored skeletal clip that is
    // advanced by scene animation frames (Batch 2C Task A), not by an
    // immediate visualRoot squash. Use a constant animation delta so
    // `scene.animate()` steps a fixed 16 ms of clip time per frame, then tick
    // enough render frames after `setCrouchBlend(1)` for the crouch clip to
    // settle before asserting the hand and weapon have lowered.
    scene.useConstantAnimationDeltaTime = true;
    const model = await buildCharacter("lw-c");
    const weapon = WeaponModelPresentation.create(scene, "lwC");
    const attachment = CharacterWeaponAttachment.create(scene, "lw-c");
    attachment.attach(weapon);
    const hand = attachment.socket; // the live right-hand joint the weapon rides

    // Advance scene animation frames the way a render loop does: feed the
    // model's animation observer, then step the scene's animation engine.
    // (A no-op for the legacy squash path, which applies crouch immediately.)
    const tick = (frames: number): void => {
      for (let i = 0; i < frames; i++) {
        scene.onBeforeAnimationsObservable.notifyObservers(scene);
        scene.animate();
      }
    };

    model.setTransform({ x: 0, y: 0, z: 0 }, 0);
    tick(40); // let the locomotion clip settle into its standing pose
    const standing = worldPos(weapon.root);
    const standingHand = worldPos(hand);

    model.setCrouchBlend(1);
    tick(40); // let the skeletal crouch clip lower the pelvis and hand
    const crouched = worldPos(weapon.root);
    const crouchedHand = worldPos(hand);

    // The crouch clip lowers the hand joint; the weapon, parented to it,
    // follows. Both drop clearly relative to the planted feet.
    expect(crouched.y).toBeLessThan(standing.y - 0.15);
    expect(crouchedHand.y).toBeLessThan(standingHand.y - 0.15);
    // The body root (gameplay mirror) did not move — crouch is a
    // presentation clip, not a movement of the feet.
    expect(model.root.position.y).toBe(0);
    // Standing again restores the hold height. Idle breathing stays well
    // below the crouch drop, so the weapon returns to the standing band.
    model.setCrouchBlend(0);
    tick(60);
    const standingAgain = worldPos(weapon.root);
    expect(Math.abs(standingAgain.y - standing.y)).toBeLessThan(0.03);
    weapon.dispose();
    attachment.dispose();
    model.dispose();
  });

  it("hiding the character hides the held weapon through the same chain", async () => {
    makeScene();
    const model = await buildCharacter("lw-d");
    const weapon = WeaponModelPresentation.create(scene, "lwD");
    const attachment = CharacterWeaponAttachment.create(scene, "lw-d");
    attachment.attach(weapon);

    expect(weapon.root.isEnabled()).toBe(true);
    model.setEnabled(false);
    expect(weapon.root.isEnabled()).toBe(false);
    model.setEnabled(true);
    expect(weapon.root.isEnabled()).toBe(true);
    weapon.dispose();
    attachment.dispose();
    model.dispose();
  });

  it("procedural fallback (no character) keeps the legacy visualRoot mount functional", () => {
    makeScene();
    // No rigged body at all (asset-failure case): the runtime's attach
    // path early-returns and the weapon stays on the presentation root.
    const visualRoot = new TransformNode("lwE-visual-root", scene);
    visualRoot.position.y = 0.9;
    const weapon = WeaponModelPresentation.create(scene, "lwE");
    mountAtPresentationRoot(weapon, visualRoot);
    expect(weapon.root.parent).toBe(visualRoot);
    expect(weapon.root.position.x).toBeCloseTo(0, 5);
    expect(weapon.root.position.y).toBeCloseTo(0.02, 5);
    expect(weapon.root.position.z).toBeCloseTo(-0.22, 5);
    // Still switchable and reporting its muzzle.
    weapon.setEquippedWeapon("shotgun");
    const muzzle = new Vector3();
    weapon.getMuzzlePosition(muzzle);
    expect(Number.isFinite(muzzle.y)).toBe(true);
    visualRoot.position.y += 1.2; // remote-style motion
    visualRoot.computeWorldMatrix(true);
    const moved = new Vector3();
    weapon.getMuzzlePosition(moved);
    expect(Math.abs(moved.y - muzzle.y)).toBeGreaterThan(1);
    weapon.dispose();
  });

  it("teardown order (attachment → character → weapon) is clean and leak-free", async () => {
    makeScene();
    const model = await buildCharacter("lw-f");
    const weapon = WeaponModelPresentation.create(scene, "lwF");
    const attachment = CharacterWeaponAttachment.create(scene, "lw-f");
    attachment.attach(weapon);

    const meshesBefore = scene.meshes.length;
    const weaponMeshCount = scene.meshes.filter((m) =>
      m.name.startsWith("lwF"),
    ).length;
    const characterMeshCount = meshesBefore - weaponMeshCount;

    // Runtime dispose order: attachment first, then the character (via the
    // controller), then the weapon.
    attachment.dispose();
    model.dispose();
    weapon.dispose();
    // Every mesh this test created is gone; the scene is back to empty.
    expect(scene.meshes.filter((m) => m.name.startsWith("lwF")).length).toBe(0);
    expect(scene.meshes.length).toBe(0);
    expect(characterMeshCount).toBeGreaterThan(0); // sanity: the body had meshes
    expect(scene.getTransformNodeByName("lwF-root")).toBeNull();
    // Idempotent repeats never throw.
    attachment.dispose();
    weapon.dispose();
  });

  it("keeps every weapon mesh non-pickable and collision-disabled after the hand attach", async () => {
    makeScene();
    const model = await buildCharacter("lw-g");
    const weapon = WeaponModelPresentation.create(scene, "lwG");
    const attachment = CharacterWeaponAttachment.create(scene, "lw-g");
    attachment.attach(weapon);

    const weaponMeshes = scene.meshes.filter(
      (m): m is Mesh => m.name.startsWith("lwG") && m instanceof Mesh,
    );
    expect(weaponMeshes.length).toBeGreaterThan(0);
    for (const mesh of weaponMeshes) {
      expect(mesh.isPickable).toBe(false);
      expect(mesh.checkCollisions).toBe(false);
    }
    weapon.dispose();
    attachment.dispose();
    model.dispose();
  });
});
