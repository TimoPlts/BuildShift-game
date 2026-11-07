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
