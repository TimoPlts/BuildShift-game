/**
 * Unit tests for the shared hitscan geometry:
 *
 *  - {@link rayIntersectsCapsule}: the single-target ray–sphere intersection
 *    (hit, miss, range clamp, origin-inside-sphere, behind-the-ray, exact-range
 *    boundary, non-axis-aligned ray, non-unit direction magnitude);
 *  - {@link hitscan}: the authoritative multi-target resolver the room invokes
 *    on an approved fire intent (first-hit wins, damage/range/penetration
 *    report, miss when nothing is in range).
 *
 * The milestone models a target as a sphere at `targetPosition` with
 * `targetRadius`.
 */
import { describe, expect, it } from "vitest";
import {
  rayIntersectsCapsule,
  hitscan,
  type Vec3,
} from "./hitscan.js";

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

describe("hitscan (multi-target resolver)", () => {
  const weapon = { damage: 20, range: 60, targetRadius: 1 };

  it("returns a single hit for the nearest target when several are in the ray", () => {
    // Two targets on the +X ray at distance ~9 (x=10, r=1) and ~19 (x=20, r=1).
    // The ray must stop at the NEAREST (x=10) — first-hit wins.
    const hits = hitscan(originX, dirX, weapon, [
      { id: "far", position: { x: 20, y: 0, z: 0 } },
      { id: "near", position: { x: 10, y: 0, z: 0 } },
    ]);

    expect(hits).toHaveLength(1);
    expect(hits[0].targetId).toBe("near");
    expect(hits[0].damage).toBe(20);
    expect(hits[0].distance).toBeCloseTo(9, 6);
    expect(hits[0].penetrates).toBe(false);
    // The hit point is on the ray at distance 9 from the origin (x=9, y=0, z=0).
    expect(hits[0].hitPoint).toEqual({ x: 9, y: 0, z: 0 });
  });

  it("returns an empty array when no target is in range", () => {
    // Sphere centred at (10, 5, 0) is 5m off the ray — a miss.
    const hits = hitscan(originX, dirX, weapon, [
      { id: "off", position: { x: 10, y: 5, z: 0 } },
    ]);
    expect(hits).toEqual([]);
  });

  it("respects the weapon range (a hit beyond range is a miss)", () => {
    // Sphere centred at (60, 0, 0), radius 1 → near surface at distance 59,
    // but the weapon range is 50, so it is beyond range → no hit.
    const shortWeapon = { damage: 20, range: 50, targetRadius: 1 };
    const hits = hitscan(originX, dirX, shortWeapon, [
      { id: "beyond", position: { x: 60, y: 0, z: 0 } },
    ]);
    expect(hits).toEqual([]);
  });

  it("ignores targets that are behind the ray", () => {
    // Sphere at (-10, 0, 0) with a +X ray: the intersection is behind the
    // origin, so it is a miss even though it is within range.
    const hits = hitscan(originX, dirX, weapon, [
      { id: "behind", position: { x: -10, y: 0, z: 0 } },
    ]);
    expect(hits).toEqual([]);
  });

  it("reports a correct hit point for a non-unit direction magnitude", () => {
    // Fire along a 2x-scaled +X direction at a sphere centred at (10, 0, 0),
    // radius 1. The true distance is still 9 metres and the hit point is x=9.
    const dirScaled: Vec3 = { x: 2, y: 0, z: 0 };
    const hits = hitscan(originX, dirScaled, weapon, [
      { id: "t", position: { x: 10, y: 0, z: 0 } },
    ]);

    expect(hits).toHaveLength(1);
    expect(hits[0].distance).toBeCloseTo(9, 6);
    expect(hits[0].hitPoint.x).toBeCloseTo(9, 6);
    expect(hits[0].hitPoint.y).toBeCloseTo(0, 6);
    expect(hits[0].hitPoint.z).toBeCloseTo(0, 6);
  });

  it("reports the weapon damage and a false penetration flag on a hit", () => {
    const hits = hitscan(originX, dirX, { damage: 42, range: 60, targetRadius: 1 }, [
      { id: "t", position: { x: 10, y: 0, z: 0 } },
    ]);

    expect(hits).toHaveLength(1);
    expect(hits[0].damage).toBe(42);
    expect(hits[0].penetrates).toBe(false);
  });

  it("uses the default target radius when the weapon omits one", () => {
    // With the default target radius (0.4), a sphere centre at (10, 0, 0)
    // gives a near surface at distance 9.6.
    const hits = hitscan(originX, dirX, { damage: 20, range: 60 }, [
      { id: "t", position: { x: 10, y: 0, z: 0 } },
    ]);

    expect(hits).toHaveLength(1);
    expect(hits[0].distance).toBeCloseTo(9.6, 6);
  });
});
