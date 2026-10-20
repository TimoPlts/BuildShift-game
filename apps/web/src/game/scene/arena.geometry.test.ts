/**
 * Behavioral tests for `setupArenaDecorations` — the decorative 1v1 arena
 * geometry helper. Uses Babylon's NullEngine (headless, no WebGL) to verify:
 *   - All decorative meshes exist with correct names
 *   - Shell walls use ARENA_PALETTE.wallColor with accent cap strips
 *   - The play-field plate is a thin slab exactly the build-volume span
 *   - Floor grid lines mark the real build-cell boundaries
 *   - Shell positions and dimensions are derived from ARENA_COLLIDERS ground
 *   - All decorative meshes are non-pickable and non-collidable
 *   - Gameplay configuration (ARENA_COLLIDERS) is unchanged
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import {
  ARENA_COLLIDERS,
  BUILD_BOUNDS,
  BUILD_GRID,
} from "@buildshift/game-config";
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
  // createFoundationScene already runs setupArenaDecorations once.
  const scene = createFoundationScene(engine);
  return { engine, scene };
}

/** Ground collider dimensions for assertions. */
const GROUND = ARENA_COLLIDERS.find((c) => c.id === "foundation-ground")!;
const [GX, , GZ] = GROUND.position;
const [HX, , HZ] = GROUND.halfExtents;

/** Build-volume world span per axis (5 cells × 5.12 m = 25.6 m). */
const BUILD_SPAN_X =
  (BUILD_BOUNDS.maxX - BUILD_BOUNDS.minX + 1) * BUILD_GRID.cellSize;
const BUILD_SPAN_Z =
  (BUILD_BOUNDS.maxZ - BUILD_BOUNDS.minZ + 1) * BUILD_GRID.cellSize;

/**
 * Cell-boundary line positions for one axis, clipped to the arena interior —
 * the same derivation `setupArenaDecorations` uses.
 */
function gridLinePositions(min: number, max: number, halfExtent: number): number[] {
  const positions: number[] = [];
  for (let i = min; i <= max + 1; i += 1) {
    const p = i * BUILD_GRID.cellSize;
    if (Math.abs(p) < halfExtent) {
      positions.push(p);
    }
  }
  return positions;
}

describe("setupArenaDecorations", () => {
  it("creates the shell, caps, plate, grid, and mirrored spawn meshes", () => {
    const { engine, scene } = buildScene();

    for (const name of [
      "arena-shell-n",
      "arena-shell-s",
      "arena-shell-e",
      "arena-shell-w",
      "arena-shell-cap-n",
      "arena-playfield-plate",
      "arena-spawn-pad",
      "arena-spawn-pad-mirror",
      "arena-spawn-bar",
      "arena-spawn-bar-mirror",
    ]) {
      expect(scene.getMeshByName(name), `${name} not found`).not.toBeNull();
    }

    scene.dispose();
    engine.dispose();
  });

  it("shell walls use ARENA_PALETTE.wallColor with accent cap strips", () => {
    const { engine, scene } = buildScene();

    const shellN = scene.getMeshByName("arena-shell-n")!;
    const shellMaterial = shellN.material;
    expect(shellMaterial).toBeInstanceOf(StandardMaterial);

    const diffuse = (shellMaterial as StandardMaterial).diffuseColor;
    expect(colorClose(diffuse, ARENA_PALETTE.wallColor)).toBe(true);

    const capN = scene.getMeshByName("arena-shell-cap-n")!;
    const capMaterial = capN.material as StandardMaterial;
    const capDiffuse = capMaterial.diffuseColor;
    expect(colorClose(capDiffuse, ARENA_PALETTE.accentColor)).toBe(true);

    scene.dispose();
    engine.dispose();
  });

  it("play-field plate is a thin slab exactly the build-volume span", () => {
    const { engine, scene } = buildScene();

    const plate = scene.getMeshByName("arena-playfield-plate")!;
    const bb = plate.getBoundingInfo().boundingBox;
    const size = bb.maximum.subtract(bb.minimum);

    // Centred on the arena, exactly the build-volume span on both axes.
    expect(plate.position.x).toBeCloseTo(GX, 3);
    expect(plate.position.z).toBeCloseTo(GZ, 3);
    expect(size.x).toBeCloseTo(BUILD_SPAN_X, 3);
    expect(size.z).toBeCloseTo(BUILD_SPAN_Z, 3);
    // Inside the 30 m ground slab.
    expect(size.x).toBeLessThan(HX * 2);
    expect(size.z).toBeLessThan(HZ * 2);
    // Thin — a raised floor plate, not a block.
    expect(size.y).toBeLessThan(0.1);
    // Sits at ground level.
    expect(plate.position.y).toBeGreaterThanOrEqual(0);
    expect(plate.position.y).toBeLessThan(0.1);

    scene.dispose();
    engine.dispose();
  });

  it("floor grid lines mark the real build-cell boundaries", () => {
    const { engine, scene } = buildScene();

    const xPositions = gridLinePositions(BUILD_BOUNDS.minX, BUILD_BOUNDS.maxX, HX);
    const zPositions = gridLinePositions(BUILD_BOUNDS.minZ, BUILD_BOUNDS.maxZ, HZ);

    xPositions.forEach((p, i) => {
      const line = scene.getMeshByName(`arena-grid-line-x-${i}`);
      expect(line, `arena-grid-line-x-${i} not found`).not.toBeNull();
      // Z position sits exactly on a cell boundary; X is arena-centred.
      expect(line!.position.z).toBeCloseTo(GZ + p, 5);
      expect(line!.position.x).toBeCloseTo(GX, 3);
    });

    zPositions.forEach((p, i) => {
      const line = scene.getMeshByName(`arena-grid-line-z-${i}`);
      expect(line, `arena-grid-line-z-${i} not found`).not.toBeNull();
      expect(line!.position.x).toBeCloseTo(GX + p, 5);
      expect(line!.position.z).toBeCloseTo(GZ, 3);
    });

    // No extra grid lines beyond the expected count.
    const gridMeshes = scene.meshes.filter((m) => m.name.startsWith("arena-grid-line-"));
    expect(gridMeshes).toHaveLength(xPositions.length + zPositions.length);

    scene.dispose();
    engine.dispose();
  });

  it("shell walls span the full arena boundary derived from the ground collider", () => {
    const { engine, scene } = buildScene();

    const shellN = scene.getMeshByName("arena-shell-n")!;
    const shellS = scene.getMeshByName("arena-shell-s")!;
    const shellE = scene.getMeshByName("arena-shell-e")!;
    const shellW = scene.getMeshByName("arena-shell-w")!;

    // North wall: centered at z = GZ - HZ, spans full width (2*HX)
    expect(shellN.position.z).toBeCloseTo(GZ - HZ, 3);
    expect(shellN.position.x).toBeCloseTo(GX, 3);
    const bbN = shellN.getBoundingInfo().boundingBox;
    const sizeN = bbN.maximum.subtract(bbN.minimum);
    expect(sizeN.x).toBeCloseTo(HX * 2, 2);

    // South wall: centered at z = GZ + HZ
    expect(shellS.position.z).toBeCloseTo(GZ + HZ, 3);
    expect(shellS.position.x).toBeCloseTo(GX, 3);

    // East wall: centered at x = GX + HX
    expect(shellE.position.x).toBeCloseTo(GX + HX, 3);
    expect(shellE.position.z).toBeCloseTo(GZ, 3);
    const bbE = shellE.getBoundingInfo().boundingBox;
    const sizeE = bbE.maximum.subtract(bbE.minimum);
    expect(sizeE.z).toBeCloseTo(HZ * 2, 2);

    // West wall: centered at x = GX - HX
    expect(shellW.position.x).toBeCloseTo(GX - HX, 3);
    expect(shellW.position.z).toBeCloseTo(GZ, 3);

    scene.dispose();
    engine.dispose();
  });

  it("all decorative meshes are non-pickable and non-collidable", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    const names = [
      "arena-shell-n",
      "arena-shell-s",
      "arena-shell-e",
      "arena-shell-w",
      "arena-playfield-plate",
      "arena-spawn-pad",
      "arena-spawn-pad-mirror",
    ];

    for (const name of names) {
      const mesh = scene.getMeshByName(name);
      expect(mesh, `${name} not found`).not.toBeNull();
      expect(mesh!.isPickable, `${name} should be non-pickable`).toBe(false);
      expect(mesh!.checkCollisions, `${name} should be non-collidable`).toBe(false);
    }

    scene.dispose();
    engine.dispose();
  });

  it("does not modify ARENA_COLLIDERS gameplay configuration", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    // Verify the shared colliders table is unchanged
    expect(ARENA_COLLIDERS).toHaveLength(8);

    const ground = ARENA_COLLIDERS.find((c) => c.id === "foundation-ground");
    expect(ground).toBeDefined();
    expect(ground!.position).toEqual([0, -0.25, 0]);
    expect(ground!.halfExtents).toEqual([15, 0.25, 15]);

    // Verify the original ground mesh in the scene is unchanged
    const groundMesh = scene.getMeshByName("foundation-ground");
    expect(groundMesh).not.toBeNull();
    const bb = groundMesh!.getBoundingInfo().boundingBox;
    const size = bb.maximum.subtract(bb.minimum);
    expect(size.x).toBeCloseTo(30, 3);
    expect(size.z).toBeCloseTo(30, 3);

    scene.dispose();
    engine.dispose();
  });
});
