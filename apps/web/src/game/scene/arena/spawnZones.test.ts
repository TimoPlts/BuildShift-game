/**
 * Focused tests for the spawn-side wall-mark module
 * (`arena/spawnZones.ts`) in the clean Box Fight room — geometry
 * invariants, material reuse, lifecycle and disposal. The former floor
 * rings and lane strips are removed clutter. Headless via Babylon's
 * NullEngine.
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
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

describe("setupArenaSpawnZones — wall-mounted spawn-side marks", () => {
  it("creates exactly the 2 spawn-side wall marks", () => {
    const { engine, scene } = makeScene();
    setupArenaSpawnZones(scene);

    const meshes = scene.meshes.filter((m) =>
      m.name.startsWith("arena-spawnzone-"),
    );
    expect(meshes.length).toBe(2);
    for (const name of [
      "arena-spawnzone-mark-primary",
      "arena-spawnzone-mark-mirror",
    ]) {
      expect(scene.getMeshByName(name), `missing ${name}`).not.toBeNull();
    }
    // Obsolete floor clutter stays removed.
    for (const name of [
      "arena-spawnzone-ring-primary",
      "arena-spawnzone-strip-primary",
    ]) {
      expect(scene.getMeshByName(name), `obsolete ${name}`).toBeNull();
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

  it("marks sit on the end walls behind the shared spawn and its mirror", () => {
    const { engine, scene } = makeScene();
    setupArenaSpawnZones(scene);

    const { gx, gz, hz } = groundCentre();

    const primary = scene.getMeshByName("arena-spawnzone-mark-primary")!;
    expect(primary.position.x).toBeCloseTo(PLAYER_SPAWN.x, 5);
    // Primary spawn is at z = +6 → mark on the +z end wall, proud of the
    // wall's inner face into the room.
    expect(primary.position.z).toBeCloseTo(gz + hz - 0.15 - 0.04, 3);

    const mirror = scene.getMeshByName("arena-spawnzone-mark-mirror")!;
    expect(mirror.position.x).toBeCloseTo(gx * 2 - PLAYER_SPAWN.x, 5);
    expect(mirror.position.z).toBeCloseTo(gz - hz + 0.15 + 0.04, 3);

    // Mirrored across the arena centre.
    expect(primary.position.z + mirror.position.z).toBeCloseTo(gz * 2, 5);

    // Wall-mounted, well off the floor: entirely above head height.
    const bb = primary.getBoundingInfo().boundingBox;
    expect(primary.position.y + bb.minimum.y).toBeGreaterThan(2);

    scene.dispose();
    engine.dispose();
  });

  it("reuses the single shared brass trim material (created on demand)", () => {
    const { engine, scene } = makeScene();
    setupArenaSpawnZones(scene);

    // Bare scene: exactly one material, the shared trim, used by both.
    expect(scene.materials.length).toBe(1);
    const trim = scene.materials[0];
    expect(trim.name).toBe("arena-trim-material");
    for (const mesh of scene.meshes.filter((m) =>
      m.name.startsWith("arena-spawnzone-"),
    )) {
      expect(mesh.material, `${mesh.name} material`).toBe(trim);
    }
    // Muted brass, not a glow: emissive strictly dimmer than diffuse.
    const trimMat = trim as StandardMaterial;
    expect(trimMat.emissiveColor.r).toBeLessThan(trimMat.diffuseColor.r);

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
