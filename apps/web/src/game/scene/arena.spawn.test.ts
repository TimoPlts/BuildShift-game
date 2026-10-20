/**
 * Behavioral tests for the mirrored 1v1 spawn-side presentation markers added
 * by `setupArenaDecorations` (via `createFoundationScene`). Uses Babylon's
 * NullEngine (headless, no WebGL) to verify:
 *   - The primary spawn pad is placed exactly under the shared PLAYER_SPAWN
 *     point; the mirrored pad is its reflection across the arena centre
 *   - Each start-line bar sits behind its pad, away from the arena centre
 *   - All markers are flat/low, accent-glow, non-pickable, non-collidable
 *   - The spawn sides do not obscure the open arena centre
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

/** The mirrored spawn: PLAYER_SPAWN reflected across the arena centre. */
const MIRROR_SPAWN = {
  x: GROUND_CX * 2 - PLAYER_SPAWN.x,
  z: GROUND_CZ * 2 - PLAYER_SPAWN.z,
};

const SPAWN_SIDES: Array<{
  pad: string;
  bar: string;
  x: number;
  z: number;
}> = [
  { pad: "arena-spawn-pad", bar: "arena-spawn-bar", x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z },
  { pad: "arena-spawn-pad-mirror", bar: "arena-spawn-bar-mirror", x: MIRROR_SPAWN.x, z: MIRROR_SPAWN.z },
];

describe("mirrored 1v1 spawn-side presentation", () => {
  it("places each spawn pad directly under its spawn point", () => {
    const { engine, scene } = buildScene();

    for (const side of SPAWN_SIDES) {
      const pad = scene.getMeshByName(side.pad);
      expect(pad, `${side.pad} not found`).not.toBeNull();

      expect(pad!.position.x).toBeCloseTo(side.x, 5);
      expect(pad!.position.z).toBeCloseTo(side.z, 5);
      // The pad is a flat disc resting on the play-field plate (y >= 0).
      expect(pad!.position.y).toBeGreaterThanOrEqual(0);
      expect(pad!.position.y).toBeLessThan(0.2);

      const bb = pad!.getBoundingInfo().boundingBox;
      const size = bb.maximum.subtract(bb.minimum);
      // Round pad: equal footprint in X and Z, larger than a player radius.
      expect(size.x).toBeCloseTo(size.z, 3);
      expect(size.x).toBeGreaterThan(1.5);
      expect(size.y).toBeLessThan(0.1);
    }

    scene.dispose();
    engine.dispose();
  });

  it("places each start-line bar behind its pad, away from the arena centre", () => {
    const { engine, scene } = buildScene();

    for (const side of SPAWN_SIDES) {
      const bar = scene.getMeshByName(side.bar);
      expect(bar, `${side.bar} not found`).not.toBeNull();

      // Aligned with the spawn x and strictly further from the centre than
      // the pad (the bar marks the back edge of the spawn side).
      expect(bar!.position.x).toBeCloseTo(side.x, 5);
      const awayFromCentre = side.z >= GROUND_CZ ? 1 : -1;
      expect(
        Math.abs(bar!.position.z - GROUND_CZ),
      ).toBeGreaterThan(Math.abs(side.z - GROUND_CZ));
      expect(
        Math.sign(bar!.position.z - GROUND_CZ),
      ).toBe(awayFromCentre);

      // A low bar — visible landmark, not a wall.
      const bb = bar!.getBoundingInfo().boundingBox;
      const size = bb.maximum.subtract(bb.minimum);
      expect(size.y).toBeLessThan(1);
      expect(size.z).toBeLessThan(0.3);
    }

    scene.dispose();
    engine.dispose();
  });

  it("the two spawn sides are mirror images across the arena centre", () => {
    const { engine, scene } = buildScene();

    const primary = scene.getMeshByName("arena-spawn-pad")!;
    const mirror = scene.getMeshByName("arena-spawn-pad-mirror")!;

    // The pads are symmetric about the arena centre on X and Z.
    expect(primary.position.x + mirror.position.x).toBeCloseTo(GROUND_CX * 2, 5);
    expect(primary.position.z + mirror.position.z).toBeCloseTo(GROUND_CZ * 2, 5);
    // And they are on opposite sides of the centre.
    expect(
      (primary.position.z - GROUND_CZ) * (mirror.position.z - GROUND_CZ),
    ).toBeLessThan(0);

    scene.dispose();
    engine.dispose();
  });

  it("marks every spawn marker with the accent-glow material", () => {
    const { engine, scene } = buildScene();

    for (const side of SPAWN_SIDES) {
      for (const name of [side.pad, side.bar]) {
        const mesh = scene.getMeshByName(name)!;
        const material = mesh.material as StandardMaterial;
        expect(material).toBeInstanceOf(StandardMaterial);

        // Diffuse matches the accent palette color.
        expect(colorClose(material.diffuseColor, ARENA_PALETTE.accentColor)).toBe(
          true,
        );
        // Emissive is present and non-zero — the marker glows in the dark.
        const e = material.emissiveColor;
        expect(e.r).toBeGreaterThan(0);
        expect(e.g).toBeGreaterThan(0);
        expect(e.b).toBeGreaterThan(0);
      }
    }

    scene.dispose();
    engine.dispose();
  });

  it("spawn markers are non-pickable and non-collidable", () => {
    const { engine, scene } = buildScene();

    for (const side of SPAWN_SIDES) {
      for (const name of [side.pad, side.bar]) {
        const mesh = scene.getMeshByName(name);
        expect(mesh, `${name} not found`).not.toBeNull();
        expect(mesh!.isPickable, `${name} should be non-pickable`).toBe(false);
        expect(mesh!.checkCollisions, `${name} should be non-collidable`).toBe(
          false,
        );
      }
    }

    scene.dispose();
    engine.dispose();
  });

  it("spawn markers do not intrude into the arena centre", () => {
    const { engine, scene } = buildScene();

    for (const side of SPAWN_SIDES) {
      for (const name of [side.pad, side.bar]) {
        const mesh = scene.getMeshByName(name)!;
        // The centre box collider occupies |x|,|z| <= 1.25; markers must stay
        // well outside that open build centre.
        expect(Math.abs(mesh.position.z)).toBeGreaterThan(1.25);
      }
    }

    scene.dispose();
    engine.dispose();
  });
});
