/**
 * NullEngine tests for the Batch 2B character weapon-attachment foundation:
 *  - socket discovery finds the right-hand joint (`hand_r`) of the loaded
 *    Quaternius character instance
 *  - the weapon follows the attachment node (parent/child tracking)
 *  - switching weapons removes the previous attachment cleanly
 *  - no duplicate meshes or nodes across repeated attach/switch cycles
 *  - configurable local offset/rotation is applied on the weapon root
 *  - resilient fallback socket when no hand joint is recognisable
 *  - disposal: idempotent, detaches without disposing the weapon, releases
 *    the owned fallback socket; all methods are safe no-ops after dispose
 *  - the narrow WeaponModelPresentation.attachTo seam (reparent, detach,
 *    no-op after dispose) and preservation of the weapon's own behaviour
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
import {
  CharacterWeaponAttachment,
  DEFAULT_FALLBACK_SOCKET_POSITION,
  findCharacterHandSocket,
} from "./CharacterWeaponAttachment";
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

/** Loads the real asset from the public directory into a fresh scene. */
async function loadAsset(): Promise<CharacterAsset> {
  const bytes = readFileSync(GLB_PATH);
  const buffer = new Uint8Array(bytes).buffer;
  return CharacterAsset.fromBuffer(buffer, scene);
}

/** Builds a real rigged character instance under the given prefix. */
async function buildCharacter(prefix: string): Promise<CharacterModel> {
  const asset = await loadAsset();
  return CharacterModel.create(scene, asset, "local", prefix);
}

/** World-space distance between two nodes (forced matrix refresh). */
function nodeDistance(a: TransformNode, b: TransformNode): number {
  a.computeWorldMatrix(true);
  b.computeWorldMatrix(true);
  return Vector3.Distance(a.getAbsolutePosition(), b.getAbsolutePosition());
}

describe("CharacterWeaponAttachment — socket discovery", () => {
  it("discovers the right-hand joint on the loaded Quaternius character", async () => {
    makeScene();
    await buildCharacter("cw-find");
    const socket = findCharacterHandSocket(scene, "cw-find");
    expect(socket).not.toBeNull();
    expect(socket!.name).toBe("cw-find-hand_r");
    // The socket is part of the character's instanced joint hierarchy:
    // its parent chain reaches back into the armature.
    expect(socket!.parent?.name).toBe("cw-find-lowerarm_r");
  });

  it("returns null for a prefix with no recognisable hand joint", () => {
    makeScene();
    // No character created under this prefix at all.
    expect(findCharacterHandSocket(scene, "nobody")).toBeNull();
    // A character whose names do not match the prefix must not be picked up.
    const armature = new TransformNode("other-Armature", scene);
    const leftWrist = new TransformNode("other-arm_joint_L_3", scene);
    leftWrist.parent = armature;
    expect(findCharacterHandSocket(scene, "cw-miss")).toBeNull();
  });
});

describe("CharacterWeaponAttachment — attaching to the joint", () => {
  it("attaches the weapon root under the discovered wrist joint", async () => {
    makeScene();
    await buildCharacter("cw-a");
    const attachment = CharacterWeaponAttachment.create(scene, "cw-a");
    expect(attachment.socketSource).toBe("joint");

    const weapon = WeaponModelPresentation.create(scene, "wA");
    attachment.attach(weapon);
    expect(weapon.root.parent).toBe(attachment.socket);
    expect(attachment.attachedWeapon).toBe(weapon);
    // Configurable hold offset is applied on the weapon root.
    expect(weapon.root.position.z).toBeLessThan(0);
  });

  it("weapon follows the attachment node", async () => {
    makeScene();
    await buildCharacter("cw-b");
    const attachment = CharacterWeaponAttachment.create(scene, "cw-b");
    const weapon = WeaponModelPresentation.create(scene, "wB");
    attachment.attach(weapon);

    const before = weapon.root.getAbsolutePosition().clone();
    // Drive the socket as the animation engine would (joint transform moves).
    attachment.socket.position.x += 0.35;
    attachment.socket.rotation.y = 0.8;
    attachment.socket.computeWorldMatrix(true);
    weapon.root.computeWorldMatrix(true); // force the child recompute
    const after = weapon.root.getAbsolutePosition();
    expect(Vector3.Distance(before, after)).toBeGreaterThan(0.3);
    // The muzzle anchor (weapon-owned) follows too.
    const muzzle = new Vector3();
    weapon.getMuzzlePosition(muzzle);
    expect(
      Vector3.Distance(muzzle, weapon.root.getAbsolutePosition()),
    ).toBeLessThan(0.8);
  });

  it("applies configurable local offset and rotation", async () => {
    makeScene();
    await buildCharacter("cw-c");
    const offset = { x: 0.11, y: -0.05, z: -0.2 };
    const rotation = new Vector3(0.1, 0.2, 0.3);
    const attachment = CharacterWeaponAttachment.create(scene, "cw-c", {
      localOffset: offset,
      localRotation: rotation,
    });
    const weapon = WeaponModelPresentation.create(scene, "wC");
    attachment.attach(weapon);
    expect(weapon.root.position.x).toBeCloseTo(0.11, 5);
    expect(weapon.root.position.y).toBeCloseTo(-0.05, 5);
    expect(weapon.root.position.z).toBeCloseTo(-0.2, 5);
    expect(weapon.root.rotation.x).toBeCloseTo(0.1, 5);
    expect(weapon.root.rotation.y).toBeCloseTo(0.2, 5);
    expect(weapon.root.rotation.z).toBeCloseTo(0.3, 5);

    // Per-weapon override is respected on re-attach.
    const other = WeaponModelPresentation.create(scene, "wC2");
    attachment.attach(other, { localOffset: { x: 0, y: 0, z: -0.3 } });
    expect(other.root.position.z).toBeCloseTo(-0.3, 5);
  });
});

describe("CharacterWeaponAttachment — switching weapons", () => {
  it("switching detaches the previous attachment cleanly", async () => {
    makeScene();
    await buildCharacter("cw-s");
    const attachment = CharacterWeaponAttachment.create(scene, "cw-s");
    const rifle = WeaponModelPresentation.create(scene, "wS1");
    const shotgun = WeaponModelPresentation.create(scene, "wS2");

    attachment.attach(rifle);
    expect(rifle.root.parent).toBe(attachment.socket);
    attachment.attach(shotgun);
    expect(shotgun.root.parent).toBe(attachment.socket);
    expect(rifle.root.parent).toBeNull();
    expect(attachment.attachedWeapon).toBe(shotgun);

    // Switch back: the shotgun is removed, the rifle re-attached.
    attachment.attach(rifle);
    expect(rifle.root.parent).toBe(attachment.socket);
    expect(shotgun.root.parent).toBeNull();
    expect(attachment.attachedWeapon).toBe(rifle);
  });

  it("creates no duplicate meshes or nodes across switch cycles", async () => {
    makeScene();
    await buildCharacter("cw-d");
    const attachment = CharacterWeaponAttachment.create(scene, "cw-d");
    const rifle = WeaponModelPresentation.create(scene, "wD1");
    const shotgun = WeaponModelPresentation.create(scene, "wD2");

    // Both weapons pre-build their silhouettes at construction; attachment
    // must never add (or clone) any mesh or node from then on.
    const meshCount = scene.meshes.length;
    const nodeCount = scene.transformNodes.length;
    attachment.attach(rifle);
    attachment.attach(shotgun);
    // Several switch/re-attach cycles: counts stay flat, no duplicates.
    for (let i = 0; i < 4; i++) {
      attachment.attach(rifle);
      attachment.attach(shotgun);
      attachment.attach(rifle);
    }
    expect(scene.meshes.length).toBe(meshCount);
    expect(scene.transformNodes.length).toBe(nodeCount);
    const weaponRoots = scene.transformNodes.filter(
      (t) => t.name === "wD1-root" || t.name === "wD2-root",
    );
    expect(weaponRoots.length).toBe(2);
    // Exactly one weapon is attached at a time.
    expect(
      [rifle.root.parent, shotgun.root.parent].filter(
        (p) => p === attachment.socket,
      ),
    ).toHaveLength(1);
  });

  it("re-attaching the same weapon is idempotent (no allocation, same parent)", async () => {
    makeScene();
    await buildCharacter("cw-e");
    const attachment = CharacterWeaponAttachment.create(scene, "cw-e");
    const weapon = WeaponModelPresentation.create(scene, "wE");
    attachment.attach(weapon);
    const meshCount = scene.meshes.length;
    const nodeCount = scene.transformNodes.length;
    attachment.attach(weapon);
    expect(scene.meshes.length).toBe(meshCount);
    expect(scene.transformNodes.length).toBe(nodeCount);
    expect(weapon.root.parent).toBe(attachment.socket);
    expect(attachment.attachedWeapon).toBe(weapon);
  });

  it("applies the configured uniform local scale and restores it on detach", async () => {
    makeScene();
    await buildCharacter("cw-scale");
    const attachment = CharacterWeaponAttachment.create(scene, "cw-scale", {
      localScale: 0.5,
    });
    const weapon = WeaponModelPresentation.create(scene, "wScale");
    attachment.attach(weapon);
    expect(weapon.root.scaling.x).toBeCloseTo(0.5, 5);
    expect(weapon.root.scaling.y).toBeCloseTo(0.5, 5);
    expect(weapon.root.scaling.z).toBeCloseTo(0.5, 5);

    // Per-call override wins over the configured default.
    attachment.attach(weapon, { localScale: 1.25 });
    expect(weapon.root.scaling.x).toBeCloseTo(1.25, 5);

    // Detach restores the identity transform (ready for a fresh mount).
    attachment.detach();
    expect(weapon.root.scaling.x).toBeCloseTo(1, 5);
    expect(weapon.root.position.x).toBeCloseTo(0, 5);
    weapon.dispose();
    attachment.dispose();
  });

  it("reparents a weapon that was already parented elsewhere (single parent)", async () => {
    makeScene();
    await buildCharacter("cw-f");
    const attachment = CharacterWeaponAttachment.create(scene, "cw-f");
    const weapon = WeaponModelPresentation.create(scene, "wF");
    const foreign = new TransformNode("foreign-anchor", scene);
    weapon.root.parent = foreign; // e.g. the legacy presentation-root attach
    attachment.attach(weapon);
    expect(weapon.root.parent).toBe(attachment.socket);
    expect(foreign.getChildren().length).toBe(0);
  });

  it("preserves weapon behaviour (switch + muzzle) after attachment", async () => {
    makeScene();
    await buildCharacter("cw-g");
    const attachment = CharacterWeaponAttachment.create(scene, "cw-g");
    const weapon = WeaponModelPresentation.create(scene, "wG");
    attachment.attach(weapon);

    // Attachment does not disable the weapon: its own enabled state matches
    // the socket's (same visibility chain).
    expect(weapon.root.isEnabled()).toBe(attachment.socket.isEnabled());

    // Visibility switch still works under the socket: the equipped weapon's
    // meshes are the only ones kept enabled relative to the chain baseline.
    const rifleMeshes = scene.meshes.filter(
      (m): m is Mesh => m.name.startsWith("wG-rifle-") && m instanceof Mesh,
    );
    const shotgunMeshes = scene.meshes.filter(
      (m): m is Mesh => m.name.startsWith("wG-shotgun-") && m instanceof Mesh,
    );
    const muzzleBefore = new Vector3();
    weapon.getMuzzlePosition(muzzleBefore);
    weapon.setEquippedWeapon("shotgun");
    const muzzleAfter = new Vector3();
    weapon.getMuzzlePosition(muzzleAfter);
    // The muzzle anchor moved from the rifle tip to the (shorter) shotgun tip.
    expect(Vector3.Distance(muzzleBefore, muzzleAfter)).toBeGreaterThan(0.05);
    expect(Number.isFinite(muzzleAfter.x)).toBe(true);
    expect(
      nodeDistance(weapon.root, attachment.socket) < 1.5,
    ).toBe(true);
    // Both weapon silhouettes are still present (nothing was dropped).
    expect(rifleMeshes.length).toBe(6);
    expect(shotgunMeshes.length).toBe(7);
  });
});

describe("CharacterWeaponAttachment — resilient fallback socket", () => {
  it("creates an owned fallback socket under the model-scale node when no joint matches", () => {
    makeScene();
    // Synthetic character node set (no instanced joints present).
    const modelScale = new TransformNode("fx-model-scale", scene);
    const attachment = CharacterWeaponAttachment.create(scene, "fx");
    expect(attachment.socketSource).toBe("fallback");
    expect(attachment.socket.parent).toBe(modelScale);
    expect(attachment.socket.position.x).toBeCloseTo(
      DEFAULT_FALLBACK_SOCKET_POSITION.x,
      5,
    );

    const weapon = WeaponModelPresentation.create(scene, "wFX");
    attachment.attach(weapon);
    expect(weapon.root.parent).toBe(attachment.socket);

    // Custom fallback position is honoured.
    const attachment2 = CharacterWeaponAttachment.create(scene, "fx", {
      fallbackSocketPosition: { x: -0.447, y: 0.882, z: 0.065 },
    });
    // Same prefix, still no joint: a second attachment gets its own owned
    // socket at the custom position.
    expect(attachment2.socketSource).toBe("fallback");
    expect(attachment2.socket.position.x).toBeCloseTo(-0.447, 5);
    attachment2.dispose();
    attachment.dispose();
  });

  it("attaches under a real character even when the prefix misses its joints", async () => {
    makeScene();
    await buildCharacter("cw-real");
    // Prefix mismatch: no joint lookup hit, no model nodes under the prefix
    // → the owned socket falls back to the scene, still a valid attach point.
    const attachment = CharacterWeaponAttachment.create(scene, "cw-ghost");
    expect(attachment.socketSource).toBe("fallback");
    const weapon = WeaponModelPresentation.create(scene, "wGhost");
    attachment.attach(weapon);
    expect(weapon.root.parent).toBe(attachment.socket);
    attachment.dispose();
    expect(weapon.root.parent).toBeNull();
  });
});

describe("CharacterWeaponAttachment — disposal", () => {
  it("dispose detaches the weapon without disposing it; idempotent", async () => {
    makeScene();
    await buildCharacter("cw-x");
    const attachment = CharacterWeaponAttachment.create(scene, "cw-x");
    const weapon = WeaponModelPresentation.create(scene, "wX");
    attachment.attach(weapon);

    attachment.dispose();
    expect(weapon.root.parent).toBeNull();
    expect(weapon.isDisposed).toBe(false);
    const meshCount = scene.meshes.length;
    // Methods are safe no-ops after dispose.
    attachment.dispose();
    attachment.attach(weapon);
    attachment.detach();
    expect(weapon.root.parent).toBeNull();
    expect(scene.meshes.length).toBe(meshCount);
    // The weapon still works standalone.
    weapon.setEquippedWeapon("shotgun");
    weapon.dispose();
    expect(weapon.isDisposed).toBe(true);
  });

  it("releases the owned fallback socket on dispose (joint socket never disposed)", async () => {
    makeScene();
    await buildCharacter("cw-y");
    const jointAttachment = CharacterWeaponAttachment.create(scene, "cw-y");
    const weapon = WeaponModelPresentation.create(scene, "wY");
    jointAttachment.attach(weapon);
    jointAttachment.dispose();
    // The discovered joint node must survive (it belongs to the character).
    expect(scene.getTransformNodeByName("cw-y-hand_r")).not.toBeNull();

    const fallbackAttachment = CharacterWeaponAttachment.create(scene, "cw-none");
    const socketName = fallbackAttachment.socket.name;
    fallbackAttachment.dispose();
    expect(scene.getTransformNodeByName(socketName)).toBeNull();
    weapon.dispose();
  });

  it("attach is a no-op for a disposed weapon and detach is safe", async () => {
    makeScene();
    await buildCharacter("cw-z");
    const attachment = CharacterWeaponAttachment.create(scene, "cw-z");
    const weapon = WeaponModelPresentation.create(scene, "wZ");
    weapon.dispose();
    attachment.attach(weapon);
    expect(attachment.attachedWeapon).toBeNull();
    attachment.detach();
    attachment.dispose();
  });
});

describe("WeaponModelPresentation.attachTo — narrow presentation seam", () => {
  it("reparents the weapon root with the given offset/rotation/scale", () => {
    makeScene();
    const weapon = WeaponModelPresentation.create(scene, "wSeam1");
    const socket = new TransformNode("seam-socket", scene);
    weapon.attachTo(socket, { x: 0.1, y: 0.2, z: -0.3 }, { x: 0.05, y: 0, z: 0 }, 0.75);
    expect(weapon.root.parent).toBe(socket);
    expect(weapon.root.position.x).toBeCloseTo(0.1, 5);
    expect(weapon.root.position.y).toBeCloseTo(0.2, 5);
    expect(weapon.root.position.z).toBeCloseTo(-0.3, 5);
    expect(weapon.root.rotation.x).toBeCloseTo(0.05, 5);
    expect(weapon.root.scaling.x).toBeCloseTo(0.75, 5);
    expect(weapon.root.scaling.y).toBeCloseTo(0.75, 5);
    expect(weapon.root.scaling.z).toBeCloseTo(0.75, 5);
    // The default scale is 1 (legacy two/three-argument callers unaffected).
    const legacy = WeaponModelPresentation.create(scene, "wSeam1b");
    legacy.attachTo(socket, { x: 0, y: 0, z: -0.1 });
    expect(legacy.root.scaling.x).toBeCloseTo(1, 5);
    expect(legacy.root.scaling.y).toBeCloseTo(1, 5);
    expect(legacy.root.scaling.z).toBeCloseTo(1, 5);
    legacy.dispose();
  });

  it("attachTo(null) detaches without disposing or allocating", () => {
    makeScene();
    const weapon = WeaponModelPresentation.create(scene, "wSeam2");
    const socket = new TransformNode("seam-socket2", scene);
    weapon.attachTo(socket, { x: 0, y: 0, z: -0.1 });
    const meshCount = scene.meshes.length;
    const nodeCount = scene.transformNodes.length;
    weapon.attachTo(null, { x: 0, y: 0, z: 0 });
    expect(weapon.root.parent).toBeNull();
    expect(weapon.isDisposed).toBe(false);
    expect(scene.meshes.length).toBe(meshCount);
    expect(scene.transformNodes.length).toBe(nodeCount);
  });

  it("is a safe no-op after dispose", () => {
    makeScene();
    const weapon = WeaponModelPresentation.create(scene, "wSeam3");
    weapon.dispose();
    const socket = new TransformNode("seam-socket3", scene);
    expect(() =>
      weapon.attachTo(socket, { x: 0, y: 0, z: -0.1 }),
    ).not.toThrow();
    expect(weapon.root.parent).toBeNull();
  });
});
