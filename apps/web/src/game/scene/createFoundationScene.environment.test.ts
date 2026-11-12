/**
 * Scene wiring tests for the arena environment V2 layer (Batch 2D A):
 * the canonical `createFoundationScene` factory integrates the
 * `arena/environment` and `arena/spawnZones` modules without disturbing
 * the canonical collider meshes. Headless via Babylon's NullEngine.
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { createFoundationScene } from "./createFoundationScene";
import { ARENA_COLLIDERS } from "@buildshift/game-config";

function makeScene() {
  const engine = new NullEngine();
  const scene = createFoundationScene(engine);
  return { engine, scene };
}

describe("createFoundationScene — arena environment V2 wiring", () => {
  it("integrates the perimeter-architecture and spawn-mark layers", () => {
    const { engine, scene } = makeScene();

    // Perimeter architecture: bands, pilasters, crown lines, ceiling beams.
    for (const suffix of [
      "band-n", "band-s", "band-e", "band-w",
      "crown-n", "crown-s", "crown-e", "crown-w",
      "pilaster-n-0", "pilaster-n-1", "pilaster-s-0", "pilaster-s-1",
      "pilaster-e-0", "pilaster-e-1", "pilaster-w-0", "pilaster-w-1",
    ]) {
      expect(
        scene.getMeshByName(`arena-env-${suffix}`),
        `missing arena-env-${suffix}`,
      ).not.toBeNull();
    }
    for (let i = 0; i < 4; i += 1) {
      expect(scene.getMeshByName(`arena-env-beam-${i}`)).not.toBeNull();
    }
    // Spawn-side wall marks.
    for (const name of [
      "arena-spawnzone-mark-primary",
      "arena-spawnzone-mark-mirror",
    ]) {
      expect(scene.getMeshByName(name), `missing ${name}`).not.toBeNull();
    }
    // The old outdoor backdrop clutter is gone.
    for (const name of [
      "arena-env-pylon-n",
      "arena-env-monolith-0",
      "arena-env-inlay-n",
      "arena-env-center-ring-n",
      "arena-env-banner-n",
    ]) {
      expect(scene.getMeshByName(name), `obsolete ${name}`).toBeNull();
    }

    scene.dispose();
    engine.dispose();
  });

  it("all new-layer meshes are non-pickable and non-collidable", () => {
    const { engine, scene } = makeScene();

    const v2 = scene.meshes.filter(
      (m) =>
        m.name.startsWith("arena-env-") || m.name.startsWith("arena-spawnzone-"),
    );
    expect(v2.length).toBe(22);
    for (const mesh of v2) {
      expect(mesh.isPickable, `${mesh.name} isPickable`).toBe(false);
      expect(mesh.checkCollisions, `${mesh.name} checkCollisions`).toBe(false);
    }

    scene.dispose();
    engine.dispose();
  });

  it("canonical collider meshes keep their positions", () => {
    const { engine, scene } = makeScene();

    for (const collider of ARENA_COLLIDERS) {
      const mesh = scene.getMeshByName(collider.id);
      expect(mesh, `mesh for collider "${collider.id}"`).not.toBeNull();
      const [cx, cy, cz] = collider.position;
      expect(mesh!.position.x, `${collider.id}: x`).toBeCloseTo(cx, 5);
      expect(mesh!.position.y, `${collider.id}: y`).toBeCloseTo(cy, 5);
      expect(mesh!.position.z, `${collider.id}: z`).toBeCloseTo(cz, 5);
    }

    scene.dispose();
    engine.dispose();
  });

  it("scene and engine dispose cleanly", () => {
    const { engine, scene } = makeScene();

    expect(() => scene.dispose()).not.toThrow();
    expect(() => engine.dispose()).not.toThrow();
  });
});
