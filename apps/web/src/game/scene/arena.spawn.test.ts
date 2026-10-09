/**
 * Behavioral tests for the spawn-side presentation markers added by
 * `setupArenaDecorations` (via `createFoundationScene`). Uses Babylon's
 * NullEngine (headless, no WebGL) to verify:
 *   - The spawn pad is placed exactly under the shared PLAYER_SPAWN point
 *   - The start-line bar sits behind the pad on the spawn side
 *   - Both markers are flat, low, accent-glow, non-pickable, non-collidable
 *   - The spawn side does not obscure the open arena centre
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PLAYER_SPAWN } from "@buildshift/game-config";
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

describe("spawn-side presentation", () => {
  it("places the spawn pad directly under PLAYER_SPAWN", () => {
    const { engine, scene } = buildScene();

    const pad = scene.getMeshByName("arena-spawn-pad");
    expect(pad, "arena-spawn-pad not found").not.toBeNull();

    expect(pad!.position.x).toBeCloseTo(PLAYER_SPAWN.x, 5);
    expect(pad!.position.z).toBeCloseTo(PLAYER_SPAWN.z, 5);
    // The pad is a flat disc resting on the ground surface (y = 0).
    expect(pad!.position.y).toBeGreaterThanOrEqual(0);
    expect(pad!.position.y).toBeLessThan(0.2);

    const bb = pad!.getBoundingInfo().boundingBox;
    const size = bb.maximum.subtract(bb.minimum);
    // Round pad: equal footprint in X and Z, larger than a player radius.
    expect(size.x).toBeCloseTo(size.z, 3);
    expect(size.x).toBeGreaterThan(1.5);
    expect(size.y).toBeLessThan(0.1);

    scene.dispose();
    engine.dispose();
  });

  it("places the start-line bar behind the spawn pad", () => {
    const { engine, scene } = buildScene();

    const bar = scene.getMeshByName("arena-spawn-bar");
    expect(bar, "arena-spawn-bar not found").not.toBeNull();

    // Aligned with the spawn x and strictly behind the pad (further +Z).
    expect(bar!.position.x).toBeCloseTo(PLAYER_SPAWN.x, 5);
    expect(bar!.position.z).toBeGreaterThan(PLAYER_SPAWN.z);

    // A low bar — visible landmark, not a wall.
    const bb = bar!.getBoundingInfo().boundingBox;
    const size = bb.maximum.subtract(bb.minimum);
    expect(size.y).toBeLessThan(1);
    expect(size.z).toBeLessThan(0.3);

    scene.dispose();
    engine.dispose();
  });

  it("marks both spawn markers with the accent-glow material", () => {
    const { engine, scene } = buildScene();

    for (const name of ["arena-spawn-pad", "arena-spawn-bar"]) {
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

    scene.dispose();
    engine.dispose();
  });

  it("spawn markers are non-pickable and non-collidable", () => {
    const { engine, scene } = buildScene();

    for (const name of ["arena-spawn-pad", "arena-spawn-bar"]) {
      const mesh = scene.getMeshByName(name);
      expect(mesh, `${name} not found`).not.toBeNull();
      expect(mesh!.isPickable, `${name} should be non-pickable`).toBe(false);
      expect(mesh!.checkCollisions, `${name} should be non-collidable`).toBe(
        false,
      );
    }

    scene.dispose();
    engine.dispose();
  });

  it("spawn markers do not intrude into the arena centre", () => {
    const { engine, scene } = buildScene();

    for (const name of ["arena-spawn-pad", "arena-spawn-bar"]) {
      const mesh = scene.getMeshByName(name)!;
      // The centre box collider occupies |x|,|z| <= 1.25; markers must stay
      // well outside that open build centre.
      expect(Math.abs(mesh.position.z)).toBeGreaterThan(1.25);
    }

    scene.dispose();
    engine.dispose();
  });
});
