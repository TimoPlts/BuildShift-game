/**
 * Unit tests for {@link rayIntersectsCapsule} — the shared hitscan geometry
 * used by the authoritative server (and later client prediction).
 *
 * The milestone models a target as a sphere at `targetPosition` with
 * `targetRadius`. These tests pin the four behaviours the combat milestone
 * relies on:
 *   1. a hit when the ray points at the sphere centre,
 *   2. a miss when the ray passes beside the sphere,
 *   3. a range clamp (intersection beyond `maxRange` does not count), and
 *   4. the origin-inside-sphere edge case.
 * Plus a few extra guards (behind-the-ray miss, exact-range boundary,
 * non-axis-aligned ray, non-unit direction magnitude).
 */
import { describe, expect, it } from "vitest";
import { rayIntersectsCapsule, type Vec3 } from "./hitscan.js";

/** Origin at the world origin, firing along +X (unit direction). */
const originX: Vec3 = { x: 0, y: 0, z: 0 };
const dirX: Vec3 = { x: 1, y: 0, z: 0 };

describe("rayIntersectsCapsule", () => {
  it("hits when the ray points at the sphere centre", () => {
    // Sphere centre at (10, 0, 0), radius 1. The ray enters the near surface
    // at x = 9, so the reported distance is 9.
    const result = rayIntersectsCapsule(originX, dirX, { x: 10, y: 0, z: 0 }, 1, 50);

    expect(result.hit).toBe(true);
    expect(result.distance).toBeCloseTo(9, 10);
  });

  it("misses when the ray passes beside the sphere", () => {
    // Sphere centre at (10, 5, 0) — 5m above the ray path; radius 1 means the
    // ray (along y = 0) never reaches it.
    const result = rayIntersectsCapsule(originX, dirX, { x: 10, y: 5, z: 0 }, 1, 50);

    expect(result.hit).toBe(false);
    expect(result.distance).toBe(0);
  });

  it("clamps a hit beyond maxRange to a miss", () => {
    // Sphere centre at (60, 0, 0), radius 1 → intersection at distance 59.
    // maxRange 50 is exceeded, so this must NOT register as a hit.
    const result = rayIntersectsCapsule(originX, dirX, { x: 60, y: 0, z: 0 }, 1, 50);

    expect(result.hit).toBe(false);
    expect(result.distance).toBe(0);
  });

  it("hits when the ray origin is inside the sphere", () => {
    // Origin (0,0,0) is inside a sphere centred at (2,0,0) with radius 5
    // (distance to centre = 2 < 5). The ray exits the far surface at x = 7,
    // so the reported distance is 7 — and it still counts as a hit.
    const result = rayIntersectsCapsule(originX, dirX, { x: 2, y: 0, z: 0 }, 5, 100);

    expect(result.hit).toBe(true);
    expect(result.distance).toBeCloseTo(7, 10);
  });

  it("misses when the sphere is entirely behind the ray", () => {
    // Sphere at (-10, 0, 0) with the ray firing along +X: the intersection is
    // behind the origin, so both roots are negative → miss.
    const result = rayIntersectsCapsule(originX, dirX, { x: -10, y: 0, z: 0 }, 1, 50);

    expect(result.hit).toBe(false);
    expect(result.distance).toBe(0);
  });

  it("treats an intersection exactly at maxRange as a hit", () => {
    // Sphere centre at (51, 0, 0), radius 1 → near surface at x = 50.
    // distance == maxRange (50) is not "beyond", so it is a hit.
    const result = rayIntersectsCapsule(originX, dirX, { x: 51, y: 0, z: 0 }, 1, 50);

    expect(result.hit).toBe(true);
    expect(result.distance).toBeCloseTo(50, 10);
  });

  it("reports the correct distance for a non-axis-aligned ray", () => {
    // Fire along the diagonal (1,0,1) at a sphere centred on that line at
    // (10,0,10), radius 2. The ray passes through the centre; the near
    // surface is |dir_param| * |dir| minus the radius = 10*sqrt(2) - 2.
    const dirDiag: Vec3 = { x: 1, y: 0, z: 1 };
    const expected = 10 * Math.sqrt(2) - 2;

    const result = rayIntersectsCapsule(originX, dirDiag, { x: 10, y: 0, z: 10 }, 2, 100);

    expect(result.hit).toBe(true);
    expect(result.distance).toBeCloseTo(expected, 6);
  });

  it("handles a non-unit direction magnitude", () => {
    // Same geometry as the axis-aligned hit but with a 2x direction. The true
    // Euclidean distance to the near surface is still 9 (metres), independent
    // of the direction's magnitude.
    const dirScaled: Vec3 = { x: 2, y: 0, z: 0 };
    const result = rayIntersectsCapsule(originX, dirScaled, { x: 10, y: 0, z: 0 }, 1, 50);

    expect(result.hit).toBe(true);
    expect(result.distance).toBeCloseTo(9, 10);
  });
});
