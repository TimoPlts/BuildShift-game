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
  it("integrates the environment and spawn-zone layers", () => {
    const { engine, scene } = makeScene();

    // Containment architecture + boundary framing + backdrop + banners.
    for (const suffix of [
      "pylon-n", "pylon-s", "pylon-e", "pylon-w",
      "pylon-cap-n", "pylon-cap-s", "pylon-cap-e", "pylon-cap-w",
      "inlay-n", "inlay-s", "inlay-e", "inlay-w",
      "center-ring-n", "center-ring-s", "center-ring-e", "center-ring-w",
      "banner-n", "banner-s", "banner-e", "banner-w",
    ]) {
      expect(
        scene.getMeshByName(`arena-env-${suffix}`),
        `missing arena-env-${suffix}`,
      ).not.toBeNull();
    }
    for (let i = 0; i < 8; i += 1) {
      expect(scene.getMeshByName(`arena-env-monolith-${i}`)).not.toBeNull();
    }
    // Spawn-zone treatment.
    for (const name of [
      "arena-spawnzone-ring-primary",
      "arena-spawnzone-ring-mirror",
      "arena-spawnzone-strip-primary",
      "arena-spawnzone-strip-mirror",
    ]) {
      expect(scene.getMeshByName(name), `missing ${name}`).not.toBeNull();
    }

    scene.dispose();
    engine.dispose();
  });

  it("all V2 meshes are non-pickable and non-collidable", () => {
    const { engine, scene } = makeScene();

    const v2 = scene.meshes.filter(
      (m) =>
        m.name.startsWith("arena-env-") || m.name.startsWith("arena-spawnzone-"),
    );
    expect(v2.length).toBe(32);
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
