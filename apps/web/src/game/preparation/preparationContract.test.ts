/**
 * Client-side tests for the preparation CONTRACT.md seam.
 *
 * These lock the derivations to the SHARED constants (never to literals a
 * visual pass could drift) and match the server's landed
 * `boxFightPreparation.ts` behaviour exactly:
 *  - zones are the outermost BUILD_BOUNDS X rows, one full cell wide, with
 *    the FULL playable-arena Z;
 *  - spawn = row centre on the ground;
 *  - clamp = capsule-radius inset inside the strip, copy-on-clamp;
 *  - grid allowance = anchor grid X equals the assigned row; unknown/empty
 *    side denies.
 */
import { describe, expect, it } from "vitest";
import {
  BUILD_BOUNDS,
  BUILD_GRID,
  PLAYABLE_ARENA_BOUNDS,
  VERTICAL_MOVEMENT,
} from "@buildshift/game-config";
import {
  BOX_FIGHT_PREPARATION,
  clampToPreparationZone,
  getPreparationZone,
  isGridAllowedDuringPreparation,
} from "./preparationContract";

describe("BOX_FIGHT_PREPARATION", () => {
  it("is 8 seconds (the agreed reference assumption)", () => {
    expect(BOX_FIGHT_PREPARATION.durationSeconds).toBe(8);
  });
});

describe("getPreparationZone", () => {
  it("negative side = outermost minX build row, one cell wide, full playable Z", () => {
    const zone = getPreparationZone("negative");
    const centre = BUILD_BOUNDS.minX * BUILD_GRID.cellSize;
    expect(zone.gridX).toBe(BUILD_BOUNDS.minX);
    expect(zone.minX).toBeCloseTo(centre - BUILD_GRID.cellSize / 2, 12);
    expect(zone.maxX).toBeCloseTo(centre + BUILD_GRID.cellSize / 2, 12);
    expect(zone.minZ).toBe(PLAYABLE_ARENA_BOUNDS.minZ);
    expect(zone.maxZ).toBe(PLAYABLE_ARENA_BOUNDS.maxZ);
    expect(zone.spawn).toEqual({ x: centre, y: VERTICAL_MOVEMENT.groundY, z: 0 });
  });

  it("positive side = outermost maxX build row (mirrored)", () => {
    const zone = getPreparationZone("positive");
    const centre = BUILD_BOUNDS.maxX * BUILD_GRID.cellSize;
    expect(zone.gridX).toBe(BUILD_BOUNDS.maxX);
    expect(zone.minX).toBeCloseTo(centre - BUILD_GRID.cellSize / 2, 12);
    expect(zone.maxX).toBeCloseTo(centre + BUILD_GRID.cellSize / 2, 12);
    expect(zone.minZ).toBe(PLAYABLE_ARENA_BOUNDS.minZ);
    expect(zone.maxZ).toBe(PLAYABLE_ARENA_BOUNDS.maxZ);
    expect(zone.spawn).toEqual({ x: centre, y: VERTICAL_MOVEMENT.groundY, z: 0 });
  });

  it("the two zones are disjoint strips at opposite ends", () => {
    const neg = getPreparationZone("negative");
    const pos = getPreparationZone("positive");
    expect(neg.maxX).toBeLessThan(pos.minX);
  });
});

describe("clampToPreparationZone", () => {
  const R = 0.4;

  it("confines a pose (capsule radius respected) to the strip", () => {
    const zone = getPreparationZone("negative");
    const clamped = clampToPreparationZone({ x: 0, z: 0 }, R, "negative");
    expect(clamped.x).toBeCloseTo(zone.maxX - R, 12);
    expect(clamped.z).toBe(0); // already inside the full-Z range
    const outside = clampToPreparationZone({ x: -999, z: 999 }, R, "negative");
    expect(outside.x).toBeCloseTo(zone.minX + R, 12);
    expect(outside.z).toBeCloseTo(zone.maxZ - R, 12);
  });

  it("copy-on-clamp: an inside pose is returned unchanged (same reference)", () => {
    const zone = getPreparationZone("positive");
    const inside = { x: (zone.minX + zone.maxX) / 2, z: 3 };
    expect(clampToPreparationZone(inside, R, "positive")).toBe(inside);
  });

  it("result is idempotent under a second clamp", () => {
    const once = clampToPreparationZone({ x: 40, z: -40 }, R, "positive");
    const twice = clampToPreparationZone(once, R, "positive");
    expect(twice).toBe(once);
  });
});

describe("isGridAllowedDuringPreparation", () => {
  it("allows any in-bounds cell anchored on the assigned row", () => {
    expect(
      isGridAllowedDuringPreparation({ x: BUILD_BOUNDS.minX, y: 0, z: BUILD_BOUNDS.minZ }, "negative"),
    ).toBe(true);
    expect(
      isGridAllowedDuringPreparation({ x: BUILD_BOUNDS.maxX, y: 2, z: BUILD_BOUNDS.maxZ }, "positive"),
    ).toBe(true);
  });

  it("denies centre rows, the enemy row, and empty/unknown sides", () => {
    expect(isGridAllowedDuringPreparation({ x: 0, y: 0, z: 0 }, "negative")).toBe(false);
    expect(isGridAllowedDuringPreparation({ x: BUILD_BOUNDS.maxX, y: 0, z: 0 }, "negative")).toBe(false);
    expect(isGridAllowedDuringPreparation({ x: BUILD_BOUNDS.minX, y: 0, z: 0 }, "positive")).toBe(false);
    expect(isGridAllowedDuringPreparation({ x: BUILD_BOUNDS.minX, y: 0, z: 0 }, "")).toBe(false);
    expect(
      isGridAllowedDuringPreparation({ x: BUILD_BOUNDS.minX, y: 0, z: 0 }, "sideways" as "negative"),
    ).toBe(false);
  });
});
