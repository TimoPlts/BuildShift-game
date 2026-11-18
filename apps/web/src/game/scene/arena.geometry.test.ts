/**
 * Behavioral tests for `setupArenaDecorations` — the clean Box Fight room
 * shell. Uses Babylon's NullEngine (headless, no WebGL) to verify:
 *   - Four shell walls + brass caps + one enclosed ceiling exist
 *   - Shell walls use ARENA_PALETTE.wallPanelColor with brass cap trim
 *   - The ceiling sits above the maximum legal build height (camera margin)
 *   - Shell positions and dimensions are derived from ARENA_COLLIDERS ground
 *   - The floor is CLEAN: no plate, no grid lines, no spawn pads/bars
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
  PLAYER_PHYSICS,
} from "@buildshift/game-config";
import { THIRD_PERSON_CAMERA } from "../camera/cameraConfig";
import { AIM_EYE_HEIGHT_STANDING } from "../aim/authoritativeAim";
import { createFoundationScene } from "./createFoundationScene";
import { ARENA_PALETTE } from "./arena";
import {
  ceilingHeight,
  jumpApexHeight,
  maxBuildHeight,
  shellWallHeight,
} from "./arenaDecorations";

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

/** The highest reachable build surface (top of the top build layer). */
const MAX_BUILD_HEIGHT =
  (BUILD_BOUNDS.maxLayer - BUILD_BOUNDS.minLayer + 1) * BUILD_GRID.layerHeight;

describe("setupArenaDecorations — clean room shell", () => {
  it("creates the shell walls, brass caps, and ceiling", () => {
    const { engine, scene } = buildScene();

    for (const name of [
      "arena-shell-n",
      "arena-shell-s",
      "arena-shell-e",
      "arena-shell-w",
      "arena-shell-cap-n",
      "arena-shell-cap-s",
      "arena-shell-cap-e",
      "arena-shell-cap-w",
      "arena-ceiling",
    ]) {
      expect(scene.getMeshByName(name), `${name} not found`).not.toBeNull();
    }

    scene.dispose();
    engine.dispose();
  });

  it("shell walls use ARENA_PALETTE.wallPanelColor with brass cap trim", () => {
    const { engine, scene } = buildScene();

    const shellN = scene.getMeshByName("arena-shell-n")!;
    const shellMaterial = shellN.material;
    expect(shellMaterial).toBeInstanceOf(StandardMaterial);

    const diffuse = (shellMaterial as StandardMaterial).diffuseColor;
    expect(colorClose(diffuse, ARENA_PALETTE.wallPanelColor)).toBe(true);

    const capN = scene.getMeshByName("arena-shell-cap-n")!;
    const capMaterial = capN.material as StandardMaterial;
    expect(colorClose(capMaterial.diffuseColor, ARENA_PALETTE.trimColor)).toBe(
      true,
    );
    // The trim is muted brass, NOT a glowing accent: the emissive sheen is
    // a small fraction of the diffuse (the old cyan overglow is gone).
    expect(capMaterial.emissiveColor.r).toBeLessThan(capMaterial.diffuseColor.r);
    expect(capMaterial.emissiveColor.g).toBeLessThan(capMaterial.diffuseColor.g);
    expect(capMaterial.emissiveColor.b).toBeLessThan(capMaterial.diffuseColor.b);

    scene.dispose();
    engine.dispose();
  });

  it("ceiling encloses the room above the maximum build height", () => {
    const { engine, scene } = buildScene();

    const ceiling = scene.getMeshByName("arena-ceiling")!;
    const bb = ceiling.getBoundingInfo().boundingBox;
    const size = bb.maximum.subtract(bb.minimum);

    expect(ceiling.position.x).toBeCloseTo(GX, 3);
    expect(ceiling.position.z).toBeCloseTo(GZ, 3);
    // Spans the full room footprint.
    expect(size.x).toBeCloseTo(HX * 2, 2);
    expect(size.z).toBeCloseTo(HZ * 2, 2);

    // The underside clears the maximum legal build height with the derived
    // third-person camera clearance — building is NOT capped, the room is
    // just enclosed.
    const underside = ceiling.position.y - size.y / 2;
    expect(underside).toBeGreaterThan(MAX_BUILD_HEIGHT + 1);
    expect(underside).toBeCloseTo(ceilingHeight(), 3);
    // The clearance is derived from the real camera + shared jump physics,
    // not a flat guess: along-line distance + standing eye height + jump apex
    // + safety.
    expect(ceilingHeight() - maxBuildHeight()).toBeGreaterThanOrEqual(
      THIRD_PERSON_CAMERA.distance +
        AIM_EYE_HEIGHT_STANDING +
        jumpApexHeight() +
        0.5,
    );

    scene.dispose();
    engine.dispose();
  });

  it("room encloses from inside: shell wall tops meet the ceiling underside", () => {
    const { engine, scene } = buildScene();

    const ceiling = scene.getMeshByName("arena-ceiling")!;
    const ceilingSize = ceiling
      .getBoundingInfo()
      .boundingBox.maximum.subtract(ceiling.getBoundingInfo().boundingBox.minimum);
    const ceilingUnderside = ceiling.position.y - ceilingSize.y / 2;

    // Walls must rise exactly to the ceiling underside — no horizontal gap.
    expect(shellWallHeight()).toBeCloseTo(ceilingUnderside, 3);
    for (const name of [
      "arena-shell-n",
      "arena-shell-s",
      "arena-shell-e",
      "arena-shell-w",
    ]) {
      const wall = scene.getMeshByName(name)!;
      const size = wall
        .getBoundingInfo()
        .boundingBox.maximum.subtract(
          wall.getBoundingInfo().boundingBox.minimum,
        );
      const wallTop = wall.position.y + size.y / 2;
      expect(wallTop, `${name} top`).toBeCloseTo(ceilingUnderside, 3);
    }

    scene.dispose();
    engine.dispose();
  });

  it("worst-case third-person camera on the highest legal build stays under the ceiling", () => {
    // Derivation mirrors ThirdPersonCameraController.update() (centred-aim
    // line-sharing camera): cameraY = eyeY − t·sin(pitch), eyeY = feet +
    // standing eye height, t ≤ distance along the line. Conservative bound:
    // the camera can never rise more than the FULL tracking distance above
    // the eye (max at the −60° pitch clamp is distance·sin 60°; the full
    // distance absorbs the along-line bob/kickback projection too). Worst
    // case: standing (not crouched) on the top legal build layer, at the
    // shared jump apex, looking straight down.
    const jumpApex =
      (PLAYER_PHYSICS.jumpSpeed * PLAYER_PHYSICS.jumpSpeed) /
      (2 * Math.abs(PLAYER_PHYSICS.gravity));
    // The apex formula must match the shared physics the sim integrates.
    expect(jumpApexHeight()).toBeCloseTo(jumpApex, 6);

    const worstCaseCameraY =
      MAX_BUILD_HEIGHT +
      AIM_EYE_HEIGHT_STANDING +
      THIRD_PERSON_CAMERA.distance +
      jumpApex;

    expect(ceilingHeight()).toBeGreaterThan(worstCaseCameraY);
    // And there is a real safety margin left over, not a hair's width.
    expect(ceilingHeight() - worstCaseCameraY).toBeGreaterThanOrEqual(0.5);

    // The pitch clamp confirms the orbit rise is bounded by `distance`.
    expect(Math.abs(Math.sin(THIRD_PERSON_CAMERA.minimumPitch))).toBeLessThan(
      1,
    );
  });

  it("floor is clean — no plate, no grid lines, no spawn pads or bars", () => {
    const { engine, scene } = buildScene();

    expect(scene.getMeshByName("arena-playfield-plate")).toBeNull();
    expect(scene.getMeshByName("arena-spawn-pad")).toBeNull();
    expect(scene.getMeshByName("arena-spawn-pad-mirror")).toBeNull();
    expect(scene.getMeshByName("arena-spawn-bar")).toBeNull();
    expect(scene.getMeshByName("arena-spawn-bar-mirror")).toBeNull();

    // Zero floor grid lines: nothing may form squares or a lattice on the
    // ground. Any floor-level decoration mesh would also be a violation —
    // no floor-mounted decoration meshes exist at all in the clean room.
    expect(
      scene.meshes.filter((m) => m.name.startsWith("arena-grid-line-")),
    ).toHaveLength(0);

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
    const { engine, scene } = buildScene();

    const names = [
      "arena-shell-n",
      "arena-shell-s",
      "arena-shell-e",
      "arena-shell-w",
      "arena-shell-cap-n",
      "arena-ceiling",
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
    // Snapshot at import time so the assertion is about scene creation not
    // mutating the shared table, independent of how many colliders the
    // current production table contains.
    const snapshot = ARENA_COLLIDERS.map((c) => ({
      id: c.id,
      position: [...c.position],
      halfExtents: [...c.halfExtents],
    }));

    const { engine, scene } = buildScene();

    expect(ARENA_COLLIDERS).toHaveLength(snapshot.length);
    snapshot.forEach((c, i) => {
      expect(ARENA_COLLIDERS[i].id).toBe(c.id);
      expect(ARENA_COLLIDERS[i].position).toEqual(c.position);
      expect(ARENA_COLLIDERS[i].halfExtents).toEqual(c.halfExtents);
    });

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
