/**
 * Behavioral tests for `setupArenaSky` — the enclosed-room background
 * helper. Uses Babylon's NullEngine (headless, no WebGL) to verify:
 *   - scene clearColor matches ARENA_PALETTE.skyColor (deep enclosed navy)
 *   - fog is DISABLED (crisp clean room, no outdoor haze)
 *   - a dark fallback dome exists with a tinted emissive-unlit material
 *   - the dome is fog-exempt, non-pickable, and non-collidable
 *   - cleanup via scene.dispose() works without errors
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { createFoundationScene } from "./createFoundationScene";
import { setupArenaSky } from "./arenaSky";
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
  setupArenaSky(scene);
  return { engine, scene };
}

describe("setupArenaSky", () => {
  it("sets scene clearColor to ARENA_PALETTE.skyColor", () => {
    const { engine, scene } = buildScene();

    const cc = scene.clearColor;
    expect(colorClose({ r: cc.r, g: cc.g, b: cc.b }, ARENA_PALETTE.skyColor)).toBe(
      true,
    );
    expect(cc.a).toBe(1);
    // The clean room background is dark — never a bright outdoor sky.
    expect(cc.r).toBeLessThan(0.3);
    expect(cc.g).toBeLessThan(0.3);
    expect(cc.b).toBeLessThan(0.3);

    scene.dispose();
    engine.dispose();
  });

  it("disables fog — the enclosed room renders crisp, no haze", () => {
    const { engine, scene } = buildScene();

    expect(scene.fogMode).toBe(Scene.FOGMODE_NONE);

    scene.dispose();
    engine.dispose();
  });

  it("creates a tinted emissive-unlit fallback dome named 'arena-skybox'", () => {
    const { engine, scene } = buildScene();

    const skybox = scene.getMeshByName("arena-skybox");
    expect(skybox, "skybox mesh 'arena-skybox' not found").not.toBeNull();

    const material = skybox!.material;
    expect(material).toBeInstanceOf(StandardMaterial);

    const mat = material as StandardMaterial;

    // Must be unlit (disableLighting) with only emissive contributing
    expect(mat.disableLighting).toBe(true);

    // Must render interior faces
    expect(mat.sideOrientation).toBe(Mesh.BACKSIDE);

    // Emissive should be subtly darker than the palette background color
    const emissive = mat.emissiveColor;
    expect(emissive).toBeDefined();
    expect(emissive.r).toBeLessThanOrEqual(ARENA_PALETTE.skyColor.r + EPSILON);
    expect(emissive.g).toBeLessThanOrEqual(ARENA_PALETTE.skyColor.g + EPSILON);
    expect(emissive.b).toBeLessThanOrEqual(ARENA_PALETTE.skyColor.b + EPSILON);

    // Verify the tint factor is applied correctly (0.85 × skyColor)
    const expectedR = ARENA_PALETTE.skyColor.r * 0.85;
    const expectedG = ARENA_PALETTE.skyColor.g * 0.85;
    const expectedB = ARENA_PALETTE.skyColor.b * 0.85;
    expect(Math.abs(emissive.r - expectedR)).toBeLessThan(EPSILON);
    expect(Math.abs(emissive.g - expectedG)).toBeLessThan(EPSILON);
    expect(Math.abs(emissive.b - expectedB)).toBeLessThan(EPSILON);

    scene.dispose();
    engine.dispose();
  });

  it("skybox material is fog-exempt", () => {
    const { engine, scene } = buildScene();

    const skybox = scene.getMeshByName("arena-skybox")!;
    const mat = skybox.material as StandardMaterial;
    expect(mat.fogEnabled).toBe(false);

    scene.dispose();
    engine.dispose();
  });

  it("skybox is non-pickable and non-collidable", () => {
    const { engine, scene } = buildScene();

    const skybox = scene.getMeshByName("arena-skybox")!;
    expect(skybox.isPickable).toBe(false);
    expect(skybox.checkCollisions).toBe(false);

    scene.dispose();
    engine.dispose();
  });

  it("scene can be disposed cleanly after setupArenaSky", () => {
    const { engine, scene } = buildScene();

    // Verify skybox exists before dispose
    const skybox = scene.getMeshByName("arena-skybox");
    expect(skybox).not.toBeNull();

    // Dispose should not throw
    expect(() => scene.dispose()).not.toThrow();
    expect(() => engine.dispose()).not.toThrow();
    expect(scene.isDisposed).toBe(true);
  });
});
