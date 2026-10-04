/**
 * Unit tests for the shotgun pellet-spread helpers:
 *
 *  - {@link degreesToRadians}: degree → radian conversion;
 *  - {@link computePelletSpreadAngles}: per-pellet angular offsets (radians),
 *    symmetric about 0 across the total spread cone, plus boundary behaviour
 *    (no pellets, single pellet, zero spread, even vs odd pellet counts);
 *  - {@link computePelletDirections}: per-pellet aim directions (horizontal
 *    yaw rotation of the base aim direction), preserving direction length and
 *    the game's yaw convention (0 faces −Z, positive rotates toward +X).
 */
import { describe, expect, it } from "vitest";
import {
  computePelletDirections,
  computePelletSpreadAngles,
  degreesToRadians,
  type Vec3,
} from "../index.js";

describe("degreesToRadians", () => {
  it("converts 0° to 0 rad", () => {
    expect(degreesToRadians(0)).toBe(0);
  });
  it("converts 180° to π rad", () => {
    expect(degreesToRadians(180)).toBeCloseTo(Math.PI);
  });
  it("converts 90° to π/2 rad", () => {
    expect(degreesToRadians(90)).toBeCloseTo(Math.PI / 2);
  });
});

describe("computePelletSpreadAngles", () => {
  it("returns an empty array for zero / negative / non-integer pellet counts", () => {
    expect(computePelletSpreadAngles(0, 12)).toEqual([]);
    expect(computePelletSpreadAngles(-3, 12)).toEqual([]);
    expect(computePelletSpreadAngles(2.5, 12)).toEqual([]);
  });

  it("returns [0] for a single pellet (no fan)", () => {
    expect(computePelletSpreadAngles(1, 12)).toEqual([0]);
  });

  it("spans the full cone symmetrically about 0 for two pellets", () => {
    // 10° total cone → pellets at -5° and +5°.
    const angles = computePelletSpreadAngles(2, 10);
    expect(angles).toHaveLength(2);
    expect(angles[0]).toBeCloseTo(-degreesToRadians(5));
    expect(angles[1]).toBeCloseTo(degreesToRadians(5));
  });

  it("spans the full cone with the aim centre on a middle pellet (3 pellets)", () => {
    // 12° total cone → pellets at -6°, 0, +6°.
    const angles = computePelletSpreadAngles(3, 12);
    expect(angles).toHaveLength(3);
    expect(angles[0]).toBeCloseTo(-degreesToRadians(6));
    expect(angles[1]).toBeCloseTo(0);
    expect(angles[2]).toBeCloseTo(degreesToRadians(6));
  });

  it("is symmetric (first + last cancel) and monotonic for 4 pellets", () => {
    const angles = computePelletSpreadAngles(4, 30);
    expect(angles).toHaveLength(4);
    expect(angles[0] + angles[3]).toBeCloseTo(0);
    expect(angles[1] + angles[2]).toBeCloseTo(0);
    // Even spacing.
    const step = angles[1] - angles[0];
    for (let i = 2; i < angles.length; i += 1) {
      expect(angles[i] - angles[i - 1]).toBeCloseTo(step);
    }
    // The outermost pellets are exactly at ±half the cone.
    expect(angles[0]).toBeCloseTo(-degreesToRadians(15));
    expect(angles[3]).toBeCloseTo(degreesToRadians(15));
  });

  it("produces all-zero offsets when the spread angle is zero", () => {
    const angles = computePelletSpreadAngles(5, 0);
    expect(angles).toHaveLength(5);
    for (const a of angles) {
      expect(a).toBe(0);
    }
  });

  it("produces all-zero offsets for a negative spread angle (no fan)", () => {
    const angles = computePelletSpreadAngles(3, -5);
    expect(angles).toHaveLength(3);
    for (const a of angles) {
      expect(a).toBe(0);
    }
  });
});

describe("computePelletDirections", () => {
  /** A player aiming straight down -Z (yaw 0). */
  const aim: Readonly<Vec3> = { x: 0, y: 0, z: -1 };

  it("returns a single direction equal to the aim for one pellet", () => {
    const dirs = computePelletDirections(aim, 1, 12);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toEqual(aim);
  });

  it("returns the same count of directions as pellets", () => {
    expect(computePelletDirections(aim, 8, 12)).toHaveLength(8);
    expect(computePelletDirections(aim, 0, 12)).toHaveLength(0);
  });

  it("keeps the middle pellet on the aim centre and fans left/right symmetrically", () => {
    const dirs = computePelletDirections(aim, 3, 90);
    // Middle pellet fires straight down -Z.
    expect(dirs[1].x).toBeCloseTo(0);
    expect(dirs[1].z).toBeCloseTo(-1);
    // Outer pellets fan symmetrically in X (equal and opposite) and keep -Z.
    expect(dirs[0].x).toBeCloseTo(-dirs[2].x);
    expect(dirs[0].z).toBeCloseTo(dirs[2].z);
  });

  it("preserves the base direction's length for every pellet", () => {
    const baseLength = Math.hypot(aim.x, aim.y, aim.z);
    const dirs = computePelletDirections(aim, 7, 20);
    for (const d of dirs) {
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(baseLength);
    }
  });

  it("follows the game's yaw convention (positive offset rotates -Z toward +X)", () => {
    // 90° total cone, 2 pellets → offsets at ±45°. The +45° (last) pellet of a
    // -Z-facing aim should rotate toward +X.
    const dirs = computePelletDirections(aim, 2, 90);
    expect(dirs[1].x).toBeGreaterThan(0); // +X direction
    expect(dirs[0].x).toBeLessThan(0); // -X direction
    expect(dirs[1].z).toBeCloseTo(-Math.SQRT1_2);
    expect(dirs[0].z).toBeCloseTo(-Math.SQRT1_2);
  });

  it("keeps the vertical (y) component of the aim untouched (horizontal-only spread)", () => {
    const pitched: Readonly<Vec3> = { x: 0, y: 0.5, z: -0.866 };
    const dirs = computePelletDirections(pitched, 3, 30);
    for (const d of dirs) {
      expect(d.y).toBeCloseTo(0.5);
    }
  });
});
