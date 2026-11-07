/**
 * Focused tests for the spawn-zone visual treatment module
 * (`arena/spawnZones.ts`) — geometry invariants, material reuse, lifecycle
 * and disposal. Headless via Babylon's NullEngine.
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Scene } from "@babylonjs/core/scene";
import { setupArenaSpawnZones } from "./spawnZones";
import { ARENA_COLLIDERS, PLAYER_SPAWN } from "@buildshift/game-config";

const GROUND_ID = "foundation-ground";

function makeScene(): { engine: NullEngine; scene: Scene } {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  return { engine, scene };
}

function groundCentre(): { gx: number; gz: number; hz: number } {
  const ground = ARENA_COLLIDERS.find((c) => c.id === GROUND_ID)!;
  return {
    gx: ground.position[0],
    gz: ground.position[2],
    hz: ground.halfExtents[2],
  };
}

/**
 * World-space X/Z extents of a root-level mesh from position + local size
 * (NullEngine does not refresh world bounding boxes without a render tick).
 */
function worldXZ(mesh: AbstractMesh) {
  const bb = mesh.getBoundingInfo().boundingBox;
  const size = bb.maximum.subtract(bb.minimum);
  return {
    minX: mesh.position.x - size.x / 2,
    maxX: mesh.position.x + size.x / 2,
    minZ: mesh.position.z - size.z / 2,
    maxZ: mesh.position.z + size.z / 2,
  };
}

describe("setupArenaSpawnZones — geometry invariants", () => {
  it("creates exactly the 4 spawn-zone meshes (2 rings + 2 strips)", () => {
    const { engine, scene } = makeScene();
    setupArenaSpawnZones(scene);

    const meshes = scene.meshes.filter((m) =>
      m.name.startsWith("arena-spawnzone-"),
    );
    expect(meshes.length).toBe(4);
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

  it("every spawn-zone mesh is non-pickable and non-collidable", () => {
    const { engine, scene } = makeScene();
    setupArenaSpawnZones(scene);

    for (const mesh of scene.meshes.filter((m) =>
      m.name.startsWith("arena-spawnzone-"),
    )) {
      expect(mesh.isPickable, `${mesh.name} isPickable`).toBe(false);
      expect(mesh.checkCollisions, `${mesh.name} checkCollisions`).toBe(false);
    }

    scene.dispose();
    engine.dispose();
  });

  it("rings are centred on the shared spawn and its mirror", () => {
    const { engine, scene } = makeScene();
    setupArenaSpawnZones(scene);

    const { gx, gz } = groundCentre();

    const primary = scene.getMeshByName("arena-spawnzone-ring-primary")!;
    expect(primary.position.x).toBeCloseTo(PLAYER_SPAWN.x, 5);
    expect(primary.position.z).toBeCloseTo(PLAYER_SPAWN.z, 5);

    const mirror = scene.getMeshByName("arena-spawnzone-ring-mirror")!;
    expect(mirror.position.x).toBeCloseTo(gx * 2 - PLAYER_SPAWN.x, 5);
    expect(mirror.position.z).toBeCloseTo(gz * 2 - PLAYER_SPAWN.z, 5);

    // Laid flat: the ring bounding box is wide in x/z and thin in y.
    const bb = primary.getBoundingInfo().boundingBox;
    const size = bb.maximum.subtract(bb.minimum);
    expect(size.y).toBeLessThan(0.5);
    expect(size.x).toBeGreaterThan(3.0);

    scene.dispose();
    engine.dispose();
  });

  it("lane strips run from past the pad out to the boundary, inside the slab", () => {
    const { engine, scene } = makeScene();
    setupArenaSpawnZones(scene);

    const { hz } = groundCentre();

    const primary = scene.getMeshByName("arena-spawnzone-strip-primary")!;
    const pw = worldXZ(primary);
    // Primary spawn is at z = +6: the strip should occupy roughly
    // [7.4, 14.6] in z (past the start-line bar, short of the inlay).
    expect(pw.minZ).toBeGreaterThanOrEqual(7.0);
    expect(pw.maxZ).toBeLessThanOrEqual(hz - 0.3);

    const mirror = scene.getMeshByName("arena-spawnzone-strip-mirror")!;
    const mw = worldXZ(mirror);
    expect(mw.maxZ).toBeLessThanOrEqual(-7.0);
    expect(mw.minZ).toBeGreaterThanOrEqual(-(hz - 0.3));

    // Both strips stay inside the playable slab.
    for (const w of [pw, mw]) {
      expect(Math.abs(w.minZ)).toBeLessThanOrEqual(hz);
      expect(Math.abs(w.maxZ)).toBeLessThanOrEqual(hz);
    }

    scene.dispose();
    engine.dispose();
  });

  it("reuses the single shared accent-glow material (created on demand)", () => {
    const { engine, scene } = makeScene();
    setupArenaSpawnZones(scene);

    // Bare scene: exactly one material, the accent glow, shared by all 4.
    expect(scene.materials.length).toBe(1);
    const accent = scene.materials[0];
    expect(accent.name).toBe("arena-accent-glow-material");
    for (const mesh of scene.meshes.filter((m) =>
      m.name.startsWith("arena-spawnzone-"),
    )) {
      expect(mesh.material, `${mesh.name} material`).toBe(accent);
    }

    scene.dispose();
    engine.dispose();
  });

  it("scene and engine dispose cleanly", () => {
    const { engine, scene } = makeScene();
    setupArenaSpawnZones(scene);

    expect(() => scene.dispose()).not.toThrow();
    expect(() => engine.dispose()).not.toThrow();
  });

  it("does not mutate the shared spawn", () => {
    const before = { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y, z: PLAYER_SPAWN.z };
    const { engine, scene } = makeScene();
    setupArenaSpawnZones(scene);
    scene.dispose();
    engine.dispose();

    expect(PLAYER_SPAWN.x).toBe(before.x);
    expect(PLAYER_SPAWN.y).toBe(before.y);
    expect(PLAYER_SPAWN.z).toBe(before.z);
  });
});
