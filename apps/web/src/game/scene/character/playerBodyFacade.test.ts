/**
 * NullEngine tests for PlayerBodyFacade — the production player-body seam
 * (Batch 2B, Task A):
 *  - starts with the procedural body (synchronous gameplay mirror, no load
 *    dependency) and forwards the shared transform/crouch/state contract
 *  - on a successful rigged GLB load: exactly one body, feet-root aligned,
 *    yaw/crouch/visibility carried over, external mounts re-parented with
 *    their world transform preserved, provisional body disposed
 *  - on a genuine asset failure: the procedural body stays (explicit
 *    fallback) with the reason recorded
 *  - disposal during and after the load never orphans scene objects;
 *    load starts at most once per facade
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import {
  PLAYER_COLLIDER_TOTAL_HEIGHT,
} from "@buildshift/game-config";
import { PlayerBodyFacade } from "./playerBodyFacade";
import { PlayerPresentation } from "../PlayerPresentation";

const GLB_PATH = fileURLToPath(
  new URL("../../../../public/assets/character/BuildShiftBaseCharacter.glb", import.meta.url),
);
const STUB_URL = "http://unit.local/assets/character/BuildShiftBaseCharacter.glb";

let engine: NullEngine;
let scene: Scene;

function makeScene(): void {
  engine = new NullEngine();
  scene = new Scene(engine);
}

afterEach(() => {
  globalThis.fetch = realFetch;
  scene?.dispose();
  engine?.dispose();
});

const realFetch = globalThis.fetch;

/** Serves the real GLB bytes through the same fetch path the browser uses. */
function stubGlbFetch(): () => number {
  let calls = 0;
  const bytes = new Uint8Array(readFileSync(GLB_PATH));
  globalThis.fetch = (async (input: unknown) => {
    if (String(input).includes("BuildShiftBaseCharacter.glb")) {
      calls++;
      return new Response(bytes, { status: 200, statusText: "OK" });
    }
    return realFetch(input as RequestInfo | URL);
  }) as typeof fetch;
  return () => calls;
}

/** World Y extent [min, max] of every mesh owned by the given name prefix. */
function worldYRange(prefix: string): [number, number] {
  const meshes = scene.meshes.filter(
    (m) => m instanceof Mesh && m.name.startsWith(prefix),
  );
  expect(meshes.length, `owned meshes for ${prefix}`).toBeGreaterThan(0);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    minY = Math.min(minY, box.minimumWorld.y);
    maxY = Math.max(maxY, box.maximumWorld.y);
  }
  return [minY, maxY];
}

describe("PlayerBodyFacade (local/remote production body seam)", () => {
  it("starts with the procedural body and forwards the shared transform contract", () => {
    makeScene();
    const facade = new PlayerBodyFacade(scene, "local", "fac-test");
    expect(facade.isCharacterLoaded).toBe(false);
    expect(facade.currentBody).toBeInstanceOf(PlayerPresentation);

    const predicted = { x: 2, y: 1, z: -1 };
    facade.setTransform(predicted, Math.PI / 4);
    // Gameplay mirror: root position IS the predicted position, rotation.y
    // is the negated shared yaw.
    expect(facade.root.position.x).toBeCloseTo(predicted.x, 12);
    expect(facade.root.position.y).toBeCloseTo(predicted.y, 12);
    expect(facade.root.position.z).toBeCloseTo(predicted.z, 12);
    expect(facade.root.rotation.y).toBeCloseTo(-Math.PI / 4, 12);
    // Feet-root alignment: the procedural body's soles land exactly on the
    // predicted position, with the body inside the collider envelope.
    const [minY, maxY] = worldYRange("fac-test-");
    expect(minY).toBeCloseTo(predicted.y, 5);
    expect(maxY).toBeLessThan(predicted.y + PLAYER_COLLIDER_TOTAL_HEIGHT);
    expect(maxY).toBeGreaterThan(predicted.y);
    facade.dispose();
  });

  it("adopts the rigged GLB body on load success with seamless state handover", async () => {
    makeScene();
    const facade = new PlayerBodyFacade(scene, "local", "fac-test");
    facade.setTransform({ x: 2, y: 1, z: -1 }, Math.PI / 4);
    facade.setCrouchBlend(0.5);
    facade.setEnabled(false);

    // An external mount (the weapon model's contract) on the provisional
    // body's visualRoot.
    const mount = new TransformNode("fac-test-weapon-mount", scene);
    mount.parent = facade.visualRoot;
    mount.position.set(0, 0.02, -0.22);
    const mountedChild = new TransformNode("fac-test-weapon-child", scene);
    mountedChild.parent = mount;
    mountedChild.position.set(0.1, 0.2, 0.3);
    mountedChild.computeWorldMatrix(true);
    const childWorldBefore = mountedChild.getAbsolutePosition().clone();
    const mountWorldBefore = mount.getAbsolutePosition().clone();

    stubGlbFetch();
    facade.startCharacterLoad({ assetUrl: STUB_URL });
    // The load must not have settled synchronously — the gameplay mirror is
    // already usable before the asset arrives.
    expect(facade.isCharacterLoaded).toBe(false);

    await facade.whenCharacterSettled();
    expect(facade.isCharacterLoaded).toBe(true);
    expect(facade.characterModel).not.toBeNull();

    // Async swap preserves the gameplay transform and forwards crouch, but
    // the rig now crouches through skeletal clips, never double-squashing
    // the normalisation/lift node. Before the first animation frame the
    // mesh is still in its full-height bind pose.
    const [minY, maxY] = worldYRange("fac-test-");
    expect(minY).toBeCloseTo(1, 5);
    expect(maxY - minY).toBeCloseTo(PLAYER_COLLIDER_TOTAL_HEIGHT, 4);
    expect(facade.visualRoot.scaling.y).toBe(1);
    // Yaw carried over (shared convention, Babylon sign flip).
    expect(facade.root.rotation.y).toBeCloseTo(-Math.PI / 4, 12);
    // Visibility carried over: the model is hidden.
    for (const mesh of scene.meshes.filter(
      (m) => m instanceof Mesh && m.name.startsWith("fac-test-"),
    )) {
      expect(mesh.isEnabled()).toBe(false);
    }
    // The external mount re-parented onto the new visualRoot with its world
    // transform preserved.
    expect(mount.parent).toBe(facade.visualRoot);
    const mountWorldAfter = mount.getAbsolutePosition();
    expect(mountWorldAfter.subtract(mountWorldBefore).length()).toBeLessThan(1e-6);
    // Only direct mounts move: never flatten a weapon's own hierarchy.
    expect(mountedChild.parent).toBe(mount);
    mountedChild.computeWorldMatrix(true);
    expect(mountedChild.getAbsolutePosition().subtract(childWorldBefore).length()).toBeLessThan(1e-6);

    // The facade's gameplay root remains the live body root. The GLB may
    // legitimately contain a rig joint named `root`, so don't confuse an
    // imported skeleton node with the facade's gameplay-mirror transform.
    expect(facade.root.name).toBe("fac-test-root");
    expect(facade.root.isDisposed()).toBe(false);
    // The provisional procedural body is gone (its render observer with it).
    expect(facade.currentBody).toBe(facade.characterModel);
    facade.dispose();
  });

  it("keeps the procedural body with a recorded reason on genuine asset failure", async () => {
    makeScene();
    const facade = new PlayerBodyFacade(scene, "remote", "fac-test");
    facade.startCharacterLoad({ assetUrl: "http://127.0.0.1:9/missing.glb" });
    await facade.whenCharacterSettled();
    expect(facade.isCharacterLoaded).toBe(false);
    expect(facade.characterModel).toBeNull();
    expect(facade.fallbackReason?.length).toBeGreaterThan(0);
    // The fallback is drivable through the same contract.
    facade.setTransform({ x: -3, y: 0.5, z: 2 }, Math.PI);
    expect(facade.root.position.x).toBeCloseTo(-3, 12);
    expect(facade.root.rotation.y).toBeCloseTo(-Math.PI, 12);
    expect(facade.applyState(false, 2)).toBe(1);
    // Exactly one body (the factory's fallback replaced the provisional,
    // which was disposed) — no duplicate meshes.
    expect(
      scene.transformNodes.filter((t) => t.name === "fac-test-root").length,
    ).toBe(1);
    facade.dispose();
    expect(scene.meshes.filter((m) => m.name.startsWith("fac-test-")).length).toBe(0);
  });

  it("dispose before the load settles disposes the loaded product (no orphans)", async () => {
    makeScene();
    const facade = new PlayerBodyFacade(scene, "local", "fac-test");
    facade.setTransform({ x: 0, y: 0, z: 0 }, 0);
    expect(
      scene.meshes.filter((m) => m.name.startsWith("fac-test-")).length,
    ).toBeGreaterThan(0);
    stubGlbFetch();
    facade.startCharacterLoad({ assetUrl: STUB_URL });
    // Tear the runtime down before the GLB load has settled.
    facade.dispose();
    await facade.whenCharacterSettled();
    expect(facade.isCharacterLoaded).toBe(false);
    // The provisional body is disposed and nothing the load produced
    // (model meshes, cloned materials, asset source hierarchy) survives.
    expect(
      scene.meshes.filter((m) => m.name.startsWith("fac-test-")).length,
    ).toBe(0);
    expect(
      scene.transformNodes.filter((t) => t.name === "fac-test-root").length,
    ).toBe(0);
    expect(
      scene.materials.filter((m) => m.name.startsWith("fac-test-")).length,
    ).toBe(0);
  });

  it("dispose after the swap releases the rigged body and the asset", async () => {
    makeScene();
    const facade = new PlayerBodyFacade(scene, "remote", "fac-test");
    stubGlbFetch();
    facade.startCharacterLoad({ assetUrl: STUB_URL });
    await facade.whenCharacterSettled();
    expect(facade.isCharacterLoaded).toBe(true);
    const before = scene.meshes.filter((m) => m.name.startsWith("fac-test-"));
    expect(before.length).toBeGreaterThan(0);
    facade.dispose();
    facade.dispose(); // idempotent
    // Safe no-ops after dispose.
    facade.setTransform({ x: 1, y: 1, z: 1 }, 1);
    facade.setCrouchBlend(1);
    facade.setEnabled(true);
    expect(facade.applyState(false, 2)).toBe(2);
    expect(scene.meshes.filter((m) => m.name.startsWith("fac-test-")).length).toBe(0);
    expect(
      scene.transformNodes.filter((t) => t.name === "fac-test-root").length,
    ).toBe(0);
    expect(
      scene.materials.filter((m) => m.name.startsWith("fac-test-")).length,
    ).toBe(0);
  });

  it("starts the character load at most once per facade", async () => {
    makeScene();
    const facade = new PlayerBodyFacade(scene, "local", "fac-test");
    const fetchCalls = stubGlbFetch();
    facade.startCharacterLoad({ assetUrl: STUB_URL });
    facade.startCharacterLoad({ assetUrl: STUB_URL }); // ignored
    await facade.whenCharacterSettled();
    expect(facade.isCharacterLoaded).toBe(true);
    expect(fetchCalls()).toBe(1);
    facade.dispose();
  });
});

/**
 * IMPLEMENTATION B — `setLocalViewOffset(x, z = 0)`: VISUAL-ONLY root-local
 * framing offset for the LOCAL avatar (crosshair stays at exact viewport
 * centre; the local body is drawn aside). It must never touch the
 * gameplay-mirror root pose, must default to 0 (remote avatars stay
 * centred), must persist across the async GLB adoption, must not disturb
 * the body-owned feet/crouch lift, and must carry visual mounts with it.
 */
const OFFSET = 0.8;

function makeFacade(prefix: string, variant: "local" | "remote") {
  const facade = new PlayerBodyFacade(scene, variant, prefix);
  rig.push(facade);
  return facade;
}

const rig: PlayerBodyFacade[] = [];
afterEach(() => {
  while (rig.length) rig.pop()!.dispose();
});

/** World-space visual shift of a facade: visualRoot world pos − root pos. */
function visualShift(facade: PlayerBodyFacade): Vector3 {
  facade.root.computeWorldMatrix(true);
  facade.visualRoot.computeWorldMatrix(true);
  return facade.visualRoot.getAbsolutePosition().subtract(facade.root.position);
}

describe("PlayerBodyFacade.setLocalViewOffset (visual-only local framing)", () => {
  it("defaults to 0 for every facade and is per-facade (remote never inherits it)", () => {
    makeScene();
    const local = makeFacade("vo-local", "local");
    const remote = makeFacade("vo-remote", "remote");
    // API default: everyone starts centred.
    expect(local.localViewOffset).toEqual({ x: 0, z: 0 });
    expect(remote.localViewOffset).toEqual({ x: 0, z: 0 });
    expect(remote.visualRoot.position.x).toBe(0);
    expect(remote.visualRoot.position.z).toBe(0);
    // Offsetting ONE facade never shifts the other.
    local.setLocalViewOffset(OFFSET);
    expect(local.visualRoot.position.x).toBe(OFFSET);
    expect(remote.visualRoot.position.x).toBe(0);
    expect(remote.visualRoot.position.z).toBe(0);
    // z defaults to 0 when omitted; repeated equal calls are idempotent.
    local.setLocalViewOffset(OFFSET);
    local.setLocalViewOffset(OFFSET, 0);
    expect(local.visualRoot.position.x).toBe(OFFSET);
    expect(local.visualRoot.position.z).toBe(0);
    // Non-finite inputs clamp to 0 (stable setter).
    local.setLocalViewOffset(Number.NaN, Number.POSITIVE_INFINITY);
    expect(local.localViewOffset).toEqual({ x: 0, z: 0 });
    expect(local.visualRoot.position.x).toBe(0);
  });

  it("leaves the gameplay root pose byte-identical (position, yaw, world matrix)", () => {
    makeScene();
    const shifted = makeFacade("vo-shift", "local");
    const plain = makeFacade("vo-plain", "local");
    const predicted = { x: 2, y: 1, z: -1 };
    const yaw = Math.PI / 3;
    shifted.setTransform(predicted, yaw);
    plain.setTransform(predicted, yaw);
    shifted.setLocalViewOffset(OFFSET, -0.25);
    for (const facade of [shifted, plain]) facade.setTransform(predicted, yaw);

    // Byte-identical (strict, not closeTo): the offset never leaks into
    // the gameplay mirror, not even as float rounding.
    for (const [k, v] of Object.entries(predicted)) {
      expect(Object.is(shifted.root.position[k as "x" | "y" | "z"], v)).toBe(
        true,
      );
    }
    expect(Object.is(shifted.root.position.x, plain.root.position.x)).toBe(true);
    expect(Object.is(shifted.root.position.y, plain.root.position.y)).toBe(true);
    expect(Object.is(shifted.root.position.z, plain.root.position.z)).toBe(true);
    expect(Object.is(shifted.root.rotation.y, plain.root.rotation.y)).toBe(true);
    const mA = shifted.root.getWorldMatrix().m;
    const mB = plain.root.getWorldMatrix().m;
    for (let i = 0; i < 16; i++) expect(Object.is(mA[i], mB[i])).toBe(true);
    // ...while the VISUAL child really did shift (root-local x/z of visualRoot).
    expect(shifted.visualRoot.position.x).toBe(OFFSET);
    expect(shifted.visualRoot.position.z).toBe(-0.25);
    expect(plain.visualRoot.position.x).toBe(0);
  });

  it("root-local +X projects consistently screen-left for a centre-aligned -Z-forward camera (cardinal proof)", () => {
    makeScene();
    const facade = makeFacade("vo-cardinal", "local");
    facade.setLocalViewOffset(OFFSET);
    // Babylon left-handed check: a camera looking +Z with up +Y shows +X on
    // screen-right, so screen-right = cross(up, cameraForward). The local
    // camera looks along the character's forward (shared yaw 0 = -Z).
    const up = Vector3.Up();
    // Cardinal + diagonal facings: the shift must stay perpendicular to
    // facing and land on the SAME (left) screen side at every yaw.
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4]) {
      facade.setTransform({ x: 0, y: 0, z: 0 }, yaw);
      facade.root.computeWorldMatrix(true);
      // Shared convention: yaw 0 faces -Z, positive toward +X.
      const facing = Vector3.TransformNormal(
        new Vector3(0, 0, -1),
        facade.root.getWorldMatrix(),
      );
      const expectedFacing = new Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
      expect(Vector3.Dot(facing, expectedFacing)).toBeCloseTo(1, 6);
      const screenRight = Vector3.Cross(up, facing);
      const shift = visualShift(facade);
      // Pure side shift: never moves the body along or against facing
      // (the standing feet lift on visualRoot.position.y is the body's
      // own alignment and is verified separately).
      expect(Vector3.Dot(shift, facing)).toBeCloseTo(0, 6);
      // Positive root-local X lands NEGATIVE on screen-right ⇒ screen-LEFT,
      // at every yaw (no side flip when the character turns).
      expect(Vector3.Dot(shift, screenRight)).toBeCloseTo(-OFFSET, 6);
    }
  });

  it("does not disturb the body-owned feet alignment / crouch lift (visualRoot.position.y)", () => {
    makeScene();
    const shifted = makeFacade("vo-crouch-s", "local");
    const plain = makeFacade("vo-crouch-p", "local");
    shifted.setTransform({ x: 0, y: 0, z: 0 }, 0);
    plain.setTransform({ x: 0, y: 0, z: 0 }, 0);
    shifted.setLocalViewOffset(OFFSET);
    for (const blend of [0, 0.5, 1, 0]) {
      shifted.setCrouchBlend(blend);
      plain.setCrouchBlend(blend);
      // Feet-anchored lift is computed identically on both bodies.
      expect(shifted.visualRoot.position.y).toBe(plain.visualRoot.position.y);
      // ...and the per-frame crouch write never clobbers the x/z offset.
      expect(shifted.visualRoot.position.x).toBe(OFFSET);
      expect(shifted.visualRoot.position.z).toBe(0);
      expect(shifted.visualRoot.scaling.y).toBe(plain.visualRoot.scaling.y);
    }
  });

  it("retains the local offset across the async GLB adoption and carries mounts with it", async () => {
    makeScene();
    const facade = makeFacade("vo-swap", "local");
    const predicted = { x: 0, y: 0, z: 0 };
    facade.setTransform(predicted, 0);
    facade.setLocalViewOffset(OFFSET);

    const mount = new TransformNode("vo-swap-weapon-mount", scene);
    mount.parent = facade.visualRoot;
    mount.position.set(0, 0.02, -0.22);
    mount.computeWorldMatrix(true);
    const mountWorldBefore = mount.getAbsolutePosition().clone();
    // The mount already sits in the shifted visual frame: at yaw 0 the
    // world axes coincide with root-local, so its world offset from the
    // root carries the full 0.8 (+X) visual shift plus its own local pose.
    {
      const toMount = mount
        .getAbsolutePosition()
        .subtract(new Vector3(predicted.x, predicted.y, predicted.z));
      expect(toMount.x).toBeCloseTo(OFFSET + mount.position.x, 6);
      expect(toMount.y).toBeCloseTo(
        facade.visualRoot.position.y + mount.position.y,
        6,
      );
      expect(toMount.z).toBeCloseTo(mount.position.z, 6);
    }

    // Turn the character before the swap so the handover re-checks the
    // full shared-yaw transform contract too.
    const finalPose = { x: 2, y: 1, z: -1 };
    facade.setTransform(finalPose, Math.PI / 4);
    mount.computeWorldMatrix(true);
    mountWorldBefore.copyFrom(mount.getAbsolutePosition());

    stubGlbFetch();
    facade.startCharacterLoad({ assetUrl: STUB_URL });
    await facade.whenCharacterSettled();
    expect(facade.isCharacterLoaded).toBe(true);

    // The NEW (rigged) visualRoot adopted the stored local offset...
    expect(facade.visualRoot.position.x).toBe(OFFSET);
    expect(facade.visualRoot.position.z).toBe(0);
    // ...the gameplay mirror is still exactly the predicted pose...
    expect(facade.root.position.x).toBe(finalPose.x);
    expect(facade.root.position.y).toBe(finalPose.y);
    expect(facade.root.position.z).toBe(finalPose.z);
    expect(facade.root.rotation.y).toBe(-Math.PI / 4);
    // ...the mount re-parented with its world transform (shift included)
    // preserved — the weapon travels with the visually shifted body.
    expect(mount.parent).toBe(facade.visualRoot);
    mount.computeWorldMatrix(true);
    expect(
      mount.getAbsolutePosition().subtract(mountWorldBefore).length(),
    ).toBeLessThan(1e-6);

    // Setting the offset AFTER the swap settled also lands on the live body.
    facade.setLocalViewOffset(0.5, 0.25);
    expect(facade.visualRoot.position.x).toBe(0.5);
    expect(facade.visualRoot.position.z).toBe(0.25);
  });

  it("is a safe no-op after dispose", () => {
    makeScene();
    const facade = makeFacade("vo-dead", "local");
    facade.setLocalViewOffset(OFFSET);
    facade.dispose();
    expect(() => facade.setLocalViewOffset(1, 1)).not.toThrow();
  });
});
