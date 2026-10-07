/**
 * Behavioral test: the arena scene's ground mesh material must use the
 * ground color defined in ARENA_PALETTE.
 *
 * Uses Babylon's NullEngine (headless, no WebGL required) to instantiate the
 * real foundation scene, locate the ground mesh by its stable collider id,
 * and assert its material diffuseColor matches the palette.
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { createFoundationScene } from "./createFoundationScene";
import { ARENA_PALETTE } from "./arena";

const EPSILON = 0.01;

function colorClose(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): boolean {
  return (
    Math.abs(a.r - b.r) < EPSILON &&
    Math.abs(a.g - b.g) < EPSILON &&
    Math.abs(a.b - b.b) < EPSILON
  );
}

describe("ARENA_PALETTE ground material wiring", () => {
  it("defines all required palette entries as Color3", () => {
    expect(ARENA_PALETTE.skyColor).toBeDefined();
    expect(ARENA_PALETTE.groundColor).toBeDefined();
    expect(ARENA_PALETTE.accentColor).toBeDefined();
    expect(ARENA_PALETTE.ambientColor).toBeDefined();
    // Each should have r, g, b properties
    for (const key of ["skyColor", "groundColor", "accentColor", "ambientColor"] as const) {
      const c = ARENA_PALETTE[key];
      expect(typeof c.r).toBe("number");
      expect(typeof c.g).toBe("number");
      expect(typeof c.b).toBe("number");
    }
  });

  it("ground mesh material diffuseColor equals ARENA_PALETTE.groundColor", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    // Locate the ground mesh by its stable collider id
    const groundMesh = scene.getMeshByName("foundation-ground");
    expect(groundMesh, "ground mesh 'foundation-ground' not found").not.toBeNull();

    const material = groundMesh!.material;
    expect(material, "ground mesh has no material").not.toBeNull();
    expect(material).toBeInstanceOf(StandardMaterial);

    const diffuse = (material as StandardMaterial).diffuseColor;
    expect(diffuse, "diffuseColor not set").toBeDefined();
    expect(colorClose(diffuse, ARENA_PALETTE.groundColor)).toBe(true);

    engine.dispose();
  });

  it("does not alter ground dimensions or position", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    const groundMesh = scene.getMeshByName("foundation-ground");
    expect(groundMesh).not.toBeNull();

    // Original collider: position [0, -0.25, 0], halfExtents [15, 0.25, 15]
    // Box dimensions: width=30, height=0.5, depth=30
    expect(groundMesh!.position.x).toBeCloseTo(0, 5);
    expect(groundMesh!.position.y).toBeCloseTo(-0.25, 5);
    expect(groundMesh!.position.z).toBeCloseTo(0, 5);

    // Verify bounding box reflects 30 x 0.5 x 30
    const bb = groundMesh!.getBoundingInfo().boundingBox;
    const size = bb.maximum.subtract(bb.minimum);
    expect(size.x).toBeCloseTo(30, 3);
    expect(size.y).toBeCloseTo(0.5, 3);
    expect(size.z).toBeCloseTo(30, 3);

    engine.dispose();
  });
});
