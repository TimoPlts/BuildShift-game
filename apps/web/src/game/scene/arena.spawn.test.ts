/**
 * Behavioral tests for the mirrored 1v1 spawn-side presentation of the
 * clean Box Fight room: a single restrained brass inset panel mounted on
 * the end WALL behind each spawn (perimeter decoration). The old floor
 * pads, start-line bars, glow rings and lane strips are removed clutter
 * and must NOT exist. Headless via Babylon's NullEngine.
 *
 * Verifies:
 *   - Each wall mark is aligned with its spawn's X and mounted on the end
 *     wall behind that spawn (primary at shared PLAYER_SPAWN, mirror
 *     reflected across the arena centre)
 *   - The marks are mirrored across the arena centre
 *   - All marks are non-pickable and non-collidable, off the floor
 *   - No floor-level spawn clutter exists anywhere
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ARENA_COLLIDERS, PLAYER_SPAWN } from "@buildshift/game-config";
import { createFoundationScene } from "./createFoundationScene";
import { ARENA_PALETTE } from "./arena";

const EPSILON = 0.01;

function colorClose(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): boolean {
  return (
    Math.abs(a.r - b.r) < EPSILON &&
    Math.abs(a.g - b.g) < EPSILON &&
    Math.abs(a.b - b.b) < EPSILON
  );
}

function buildScene() {
  const engine = new NullEngine();
  const scene = createFoundationScene(engine);
  return { engine, scene };
}

const GROUND = ARENA_COLLIDERS.find((c) => c.id === "foundation-ground")!;
const GROUND_CX = GROUND.position[0];
const GROUND_CZ = GROUND.position[2];
const GROUND_HZ = GROUND.halfExtents[2];

/** The mirrored spawn: PLAYER_SPAWN reflected across the arena centre. */
const MIRROR_SPAWN = {
  x: GROUND_CX * 2 - PLAYER_SPAWN.x,
  z: GROUND_CZ * 2 - PLAYER_SPAWN.z,
};

const SPAWN_SIDES: Array<{ mark: string; x: number; z: number }> = [
  { mark: "arena-spawnzone-mark-primary", x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z },
  { mark: "arena-spawnzone-mark-mirror", x: MIRROR_SPAWN.x, z: MIRROR_SPAWN.z },
];

describe("spawn-side wall marks — clean room", () => {
  it("mounts one inset panel on the end wall behind each spawn", () => {
    const { engine, scene } = buildScene();

    for (const side of SPAWN_SIDES) {
      const mark = scene.getMeshByName(side.mark);
      expect(mark, `${side.mark} not found`).not.toBeNull();

      // Aligned with the spawn along X, on the end wall behind the spawn.
      expect(mark!.position.x).toBeCloseTo(side.x, 5);
      const behind = side.z >= GROUND_CZ ? 1 : -1;
      const wallCentreZ = GROUND_CZ + behind * GROUND_HZ;
      const bb = mark!.getBoundingInfo().boundingBox;
      const size = bb.maximum.subtract(bb.minimum);
      // Flush against the wall's inner face, standing proud into the room.
      const face = wallCentreZ - behind * 0.15;
      expect(mark!.position.z).toBeCloseTo(face - behind * size.z / 2, 2);
      // On the wall — strictly closer to the far wall than to the centre.
      expect(Math.abs(mark!.position.z)).toBeGreaterThan(
        Math.abs(GROUND_CZ),
      );
      // Off the floor: entirely above head height, never a floor marking.
      expect(mark!.position.y - size.y / 2).toBeGreaterThan(2);
    }

    scene.dispose();
    engine.dispose();
  });

  it("the two spawn sides are mirror images across the arena centre", () => {
    const { engine, scene } = buildScene();

    const primary = scene.getMeshByName("arena-spawnzone-mark-primary")!;
    const mirror = scene.getMeshByName("arena-spawnzone-mark-mirror")!;

    expect(primary.position.x + mirror.position.x).toBeCloseTo(GROUND_CX * 2, 5);
    expect(primary.position.z + mirror.position.z).toBeCloseTo(GROUND_CZ * 2, 5);
    expect(
      (primary.position.z - GROUND_CZ) * (mirror.position.z - GROUND_CZ),
    ).toBeLessThan(0);

    scene.dispose();
    engine.dispose();
  });

  it("marks use the muted brass trim material, not a glowing accent", () => {
    const { engine, scene } = buildScene();

    for (const side of SPAWN_SIDES) {
      const mesh = scene.getMeshByName(side.mark)!;
      const material = mesh.material as StandardMaterial;
      expect(material).toBeInstanceOf(StandardMaterial);

      expect(colorClose(material.diffuseColor, ARENA_PALETTE.trimColor)).toBe(
        true,
      );
      // No cyan anywhere in the clean palette.
      expect(material.diffuseColor.b).toBeLessThan(material.diffuseColor.r);
      // Muted sheen, not a glow: emissive strictly dimmer than diffuse.
      expect(material.emissiveColor.r).toBeLessThan(material.diffuseColor.r);
      expect(material.emissiveColor.g).toBeLessThan(material.diffuseColor.g);
      expect(material.emissiveColor.b).toBeLessThan(material.diffuseColor.b);
    }

    scene.dispose();
    engine.dispose();
  });

  it("spawn marks are non-pickable and non-collidable", () => {
    const { engine, scene } = buildScene();

    for (const side of SPAWN_SIDES) {
      const mesh = scene.getMeshByName(side.mark);
      expect(mesh, `${side.mark} not found`).not.toBeNull();
      expect(mesh!.isPickable, `${side.mark} should be non-pickable`).toBe(false);
      expect(mesh!.checkCollisions, `${side.mark} should be non-collidable`).toBe(
        false,
      );
    }

    scene.dispose();
    engine.dispose();
  });

  it("no floor-level spawn clutter exists (pads, bars, rings, strips)", () => {
    const { engine, scene } = buildScene();

    for (const name of [
      "arena-spawn-pad",
      "arena-spawn-pad-mirror",
      "arena-spawn-bar",
      "arena-spawn-bar-mirror",
      "arena-spawnzone-ring-primary",
      "arena-spawnzone-ring-mirror",
      "arena-spawnzone-strip-primary",
      "arena-spawnzone-strip-mirror",
    ]) {
      expect(
        scene.getMeshByName(name),
        `clutter mesh "${name}" should not exist`,
      ).toBeNull();
    }

    // Nothing spawn-related sits on the playable floor.
    const floorMeshes = scene.meshes.filter(
      (m) =>
        m.name.startsWith("arena-spawn") &&
        m.getBoundingInfo().boundingBox.minimum.y + m.position.y < 1,
    );
    expect(floorMeshes).toHaveLength(0);

    scene.dispose();
    engine.dispose();
  });
});
