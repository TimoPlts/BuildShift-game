/**
 * Visual wiring tests for the foundation scene factory.
 *
 * Verifies that the canonical `createFoundationScene` factory correctly
 * integrates the independent visual modules (lighting, sky, decorations)
 * and uses the shared `ARENA_PALETTE` for material colors — without
 * altering gameplay geometry invariants.
 *
 * Uses Babylon's NullEngine (headless, no WebGL required).
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { createFoundationScene } from "./createFoundationScene";
import { ARENA_PALETTE } from "./arena";
import { ARENA_COLLIDERS } from "@buildshift/game-config";

function makeScene() {
  const engine = new NullEngine();
  const scene = createFoundationScene(engine);
  return { engine, scene };
}

describe("createFoundationScene — visual wiring", () => {
  it("uses palette ground color for the ground material", () => {
    const { engine, scene } = makeScene();

    const groundMat = scene.getMaterialByName("ground-material");
    expect(groundMat).toBeInstanceOf(StandardMaterial);
    const diffuse = (groundMat as StandardMaterial).diffuseColor;
    expect(diffuse!.r).toBeCloseTo(ARENA_PALETTE.groundColor.r, 5);
    expect(diffuse!.g).toBeCloseTo(ARENA_PALETTE.groundColor.g, 5);
    expect(diffuse!.b).toBeCloseTo(ARENA_PALETTE.groundColor.b, 5);

    scene.dispose();
    engine.dispose();
  });

  it("uses palette accent color for the accent material", () => {
    const { engine, scene } = makeScene();

    const accentMat = scene.getMaterialByName("accent-material");
    expect(accentMat).toBeInstanceOf(StandardMaterial);
    const diffuse = (accentMat as StandardMaterial).diffuseColor;
    expect(diffuse!.r).toBeCloseTo(ARENA_PALETTE.accentColor.r, 5);
    expect(diffuse!.g).toBeCloseTo(ARENA_PALETTE.accentColor.g, 5);
    expect(diffuse!.b).toBeCloseTo(ARENA_PALETTE.accentColor.b, 5);

    scene.dispose();
    engine.dispose();
  });

  it("has exactly two lights (hemisphere + directional)", () => {
    const { engine, scene } = makeScene();

    expect(scene.lights.length).toBe(2);

    const names = scene.lights.map((l) => l.name).sort();
    expect(names).toContain("arena-hemisphere");
    expect(names).toContain("arena-directional");

    scene.dispose();
    engine.dispose();
  });

  it("sets scene background from palette sky color", () => {
    const { engine, scene } = makeScene();

    const clr = scene.clearColor;
    expect(clr.r).toBeCloseTo(ARENA_PALETTE.skyColor.r, 5);
    expect(clr.g).toBeCloseTo(ARENA_PALETTE.skyColor.g, 5);
    expect(clr.b).toBeCloseTo(ARENA_PALETTE.skyColor.b, 5);
    expect(clr.a).toBeCloseTo(1, 5);

    scene.dispose();
    engine.dispose();
  });

  it("creates the arena-skybox dome mesh", () => {
    const { engine, scene } = makeScene();

    const skybox = scene.getMeshByName("arena-skybox");
    expect(skybox).not.toBeNull();
    expect(skybox!.isPickable).toBe(false);

    scene.dispose();
    engine.dispose();
  });

  it("creates all four perimeter wall decoration meshes", () => {
    const { engine, scene } = makeScene();

    for (const name of [
      "arena-wall-n",
      "arena-wall-s",
      "arena-wall-e",
      "arena-wall-w",
    ]) {
      const wall = scene.getMeshByName(name);
      expect(wall, `wall "${name}" not found`).not.toBeNull();
      expect(wall!.isPickable).toBe(false);
    }

    scene.dispose();
    engine.dispose();
  });

  it("creates the center ring decoration mesh", () => {
    const { engine, scene } = makeScene();

    const ring = scene.getMeshByName("arena-center-ring");
    expect(ring).not.toBeNull();
    expect(ring!.isPickable).toBe(false);

    scene.dispose();
    engine.dispose();
  });

  it("collider meshes have stable positions matching ARENA_COLLIDERS", () => {
    const { engine, scene } = makeScene();

    for (const collider of ARENA_COLLIDERS) {
      const mesh = scene.getMeshByName(collider.id);
      expect(mesh, `mesh "${collider.id}" not found`).not.toBeNull();

      const [cx, cy, cz] = collider.position;
      expect(mesh!.position.x).toBeCloseTo(cx, 5);
      expect(mesh!.position.y).toBeCloseTo(cy, 5);
      expect(mesh!.position.z).toBeCloseTo(cz, 5);
    }

    scene.dispose();
    engine.dispose();
  });

  it("collider meshes have 2*halfExtents dimensions", () => {
    const { engine, scene } = makeScene();

    for (const collider of ARENA_COLLIDERS) {
      const mesh = scene.getMeshByName(collider.id);
      expect(mesh, `mesh "${collider.id}" not found`).not.toBeNull();

      const bb = mesh!.getBoundingInfo().boundingBox;
      const size = bb.maximum.subtract(bb.minimum);
      const [hx, hy, hz] = collider.halfExtents;

      expect(size.x).toBeCloseTo(hx * 2, 3);
      expect(size.y).toBeCloseTo(hy * 2, 3);
      expect(size.z).toBeCloseTo(hz * 2, 3);
    }

    scene.dispose();
    engine.dispose();
  });

  it("scene and engine dispose cleanly", () => {
    const { engine, scene } = makeScene();

    expect(() => {
      scene.dispose();
    }).not.toThrow();
    expect(() => {
      engine.dispose();
    }).not.toThrow();
  });
});
