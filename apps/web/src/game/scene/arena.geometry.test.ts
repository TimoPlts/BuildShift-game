/**
 * Behavioral tests for `setupArenaDecorations` — the independent decorative
 * arena geometry helper. Uses Babylon's NullEngine (headless, no WebGL) to
 * verify:
 *   - All decorative meshes exist with correct names
 *   - Wall materials use ARENA_PALETTE.wallColor with accent cap strips
 *   - Ring and border materials use ARENA_PALETTE.accentColor
 *   - Play-field plate is a thin inset slab centred on the arena
 *   - Wall positions and dimensions are derived from ARENA_COLLIDERS ground
 *   - All decorative meshes are non-pickable and non-collidable
 *   - Gameplay configuration (ARENA_COLLIDERS) is unchanged
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ARENA_COLLIDERS } from "@buildshift/game-config";
import { createFoundationScene } from "./createFoundationScene";
import { setupArenaDecorations } from "./arenaDecorations";
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
  setupArenaDecorations(scene);
  return { engine, scene };
}

/** Ground collider dimensions for assertions. */
const GROUND = ARENA_COLLIDERS.find((c) => c.id === "foundation-ground")!;
const [GX, , GZ] = GROUND.position;
const [HX, , HZ] = GROUND.halfExtents;

describe("setupArenaDecorations", () => {
  it("creates all decorative meshes with correct names", () => {
    const { engine, scene } = buildScene();

    const wallN = scene.getMeshByName("arena-wall-n");
    const wallS = scene.getMeshByName("arena-wall-s");
    const wallE = scene.getMeshByName("arena-wall-e");
    const wallW = scene.getMeshByName("arena-wall-w");
    const capN = scene.getMeshByName("arena-wall-cap-n");
    const ring = scene.getMeshByName("arena-center-ring");
    const plate = scene.getMeshByName("arena-playfield-plate");

    expect(wallN, "arena-wall-n not found").not.toBeNull();
    expect(wallS, "arena-wall-s not found").not.toBeNull();
    expect(wallE, "arena-wall-e not found").not.toBeNull();
    expect(wallW, "arena-wall-w not found").not.toBeNull();
    expect(capN, "arena-wall-cap-n not found").not.toBeNull();
    expect(ring, "arena-center-ring not found").not.toBeNull();
    expect(plate, "arena-playfield-plate not found").not.toBeNull();

    scene.dispose();
    engine.dispose();
  });

  it("wall materials use ARENA_PALETTE.wallColor with accent cap strips", () => {
    const { engine, scene } = buildScene();

    const wallN = scene.getMeshByName("arena-wall-n")!;
    const wallMaterial = wallN.material;
    expect(wallMaterial).toBeInstanceOf(StandardMaterial);

    const diffuse = (wallMaterial as StandardMaterial).diffuseColor;
    expect(colorClose(diffuse, ARENA_PALETTE.wallColor)).toBe(true);

    const capN = scene.getMeshByName("arena-wall-cap-n")!;
    const capMaterial = capN.material as StandardMaterial;
    const capDiffuse = capMaterial.diffuseColor;
    expect(colorClose(capDiffuse, ARENA_PALETTE.accentColor)).toBe(true);

    scene.dispose();
    engine.dispose();
  });

  it("play-field plate is a thin inset slab centred on the arena", () => {
    const { engine, scene } = buildScene();

    const plate = scene.getMeshByName("arena-playfield-plate")!;
    const bb = plate.getBoundingInfo().boundingBox;
    const size = bb.maximum.subtract(bb.minimum);

    // Centred on the arena, inset from the 30 m boundary.
    expect(plate.position.x).toBeCloseTo(GX, 3);
    expect(plate.position.z).toBeCloseTo(GZ, 3);
    expect(size.x).toBeGreaterThan(25);
    expect(size.x).toBeLessThan(HX * 2);
    expect(size.z).toBeGreaterThan(25);
    expect(size.z).toBeLessThan(HZ * 2);
    // Thin — a raised floor plate, not a block.
    expect(size.y).toBeLessThan(0.1);
    // Sits at ground level.
    expect(plate.position.y).toBeGreaterThanOrEqual(0);
    expect(plate.position.y).toBeLessThan(0.1);

    scene.dispose();
    engine.dispose();
  });

  it("center ring material uses ARENA_PALETTE.accentColor", () => {
    const { engine, scene } = buildScene();

    const ring = scene.getMeshByName("arena-center-ring")!;
    const material = ring.material;
    expect(material).toBeInstanceOf(StandardMaterial);

    const diffuse = (material as StandardMaterial).diffuseColor;
    expect(colorClose(diffuse, ARENA_PALETTE.accentColor)).toBe(true);

    scene.dispose();
    engine.dispose();
  });

  it("perimeter walls span the full arena boundary derived from ground collider", () => {
    const { engine, scene } = buildScene();

    const wallN = scene.getMeshByName("arena-wall-n")!;
    const wallS = scene.getMeshByName("arena-wall-s")!;
    const wallE = scene.getMeshByName("arena-wall-e")!;
    const wallW = scene.getMeshByName("arena-wall-w")!;

    // North wall: centered at z = GZ - HZ, spans full width (2*HX)
    expect(wallN.position.z).toBeCloseTo(GZ - HZ, 3);
    expect(wallN.position.x).toBeCloseTo(GX, 3);
    const bbN = wallN.getBoundingInfo().boundingBox;
    const sizeN = bbN.maximum.subtract(bbN.minimum);
    expect(sizeN.x).toBeCloseTo(HX * 2, 2);

    // South wall: centered at z = GZ + HZ
    expect(wallS.position.z).toBeCloseTo(GZ + HZ, 3);
    expect(wallS.position.x).toBeCloseTo(GX, 3);

    // East wall: centered at x = GX + HX
    expect(wallE.position.x).toBeCloseTo(GX + HX, 3);
    expect(wallE.position.z).toBeCloseTo(GZ, 3);
    const bbE = wallE.getBoundingInfo().boundingBox;
    const sizeE = bbE.maximum.subtract(bbE.minimum);
    expect(sizeE.z).toBeCloseTo(HZ * 2, 2);

    // West wall: centered at x = GX - HX
    expect(wallW.position.x).toBeCloseTo(GX - HX, 3);
    expect(wallW.position.z).toBeCloseTo(GZ, 3);

    scene.dispose();
    engine.dispose();
  });

  it("center ring is positioned at arena center", () => {
    const { engine, scene } = buildScene();

    const ring = scene.getMeshByName("arena-center-ring")!;
    expect(ring.position.x).toBeCloseTo(GX, 3);
    expect(ring.position.z).toBeCloseTo(GZ, 3);
    // Ring sits just above ground (y >= 0)
    expect(ring.position.y).toBeGreaterThanOrEqual(0);

    scene.dispose();
    engine.dispose();
  });

  it("all decorative meshes are non-pickable and non-collidable", () => {
    const { engine, scene } = buildScene();

    const names = [
      "arena-wall-n",
      "arena-wall-s",
      "arena-wall-e",
      "arena-wall-w",
      "arena-center-ring",
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
    const { engine, scene } = buildScene();

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
