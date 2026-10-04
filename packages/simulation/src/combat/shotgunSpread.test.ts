/**
 * Unit tests for the 1v1 Energy Box Fight shotgun-spread helper
 * (`computeShotgunPelletDirections`).
 *
 * Verifies that the helper consumes a shared `ShotgunWeaponDefinition`
 * (via its `pellets` + `spreadDegrees`) and delegates to
 * {@link computePelletDirections}, producing `pellets` directions that match
 * the canonical pellet-spread math (count, length preservation, and yaw
 * convention).
 */
import { SHOTGUN_WEAPON } from "@buildshift/game-config";
import { describe, expect, it } from "vitest";
import {
  computePelletDirections,
  computeShotgunPelletDirections,
  type Vec3,
} from "../index.js";

/** A player aiming straight down -Z (yaw 0). */
const aim: Readonly<Vec3> = { x: 0, y: 0, z: -1 };

describe("computeShotgunPelletDirections", () => {
  it("returns one direction per pellet for the shared SHOTGUN_WEAPON config", () => {
    const dirs = computeShotgunPelletDirections(aim, SHOTGUN_WEAPON);
    expect(dirs).toHaveLength(SHOTGUN_WEAPON.pellets);
    expect(dirs).toHaveLength(8);
  });

  it("delegates to computePelletDirections (identical result)", () => {
    const viaHelper = computeShotgunPelletDirections(aim, SHOTGUN_WEAPON);
    const viaCanonical = computePelletDirections(
      aim,
      SHOTGUN_WEAPON.pellets,
      SHOTGUN_WEAPON.spreadDegrees,
    );
    expect(viaHelper).toEqual(viaCanonical);
  });

  it("fans pellets symmetrically with the middle on the aim centre (odd count)", () => {
    const weapon = { pellets: 3, spreadDegrees: 90 };
    const dirs = computeShotgunPelletDirections(aim, weapon);
    // Middle pellet fires straight down -Z.
    expect(dirs[1].x).toBeCloseTo(0);
    expect(dirs[1].z).toBeCloseTo(-1);
    // Outer pellets fan symmetrically in X (equal and opposite).
    expect(dirs[0].x).toBeCloseTo(-dirs[2].x);
    expect(dirs[0].z).toBeCloseTo(dirs[2].z);
  });

  it("preserves the base direction's length for every pellet", () => {
    const baseLength = Math.hypot(aim.x, aim.y, aim.z);
    const dirs = computeShotgunPelletDirections(aim, SHOTGUN_WEAPON);
    for (const d of dirs) {
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(baseLength);
    }
  });

  it("keeps the vertical (y) component untouched (horizontal-only spread)", () => {
    const pitched: Readonly<Vec3> = { x: 0, y: 0.5, z: -0.866 };
    const dirs = computeShotgunPelletDirections(pitched, SHOTGUN_WEAPON);
    for (const d of dirs) {
      expect(d.y).toBeCloseTo(0.5);
    }
  });

  it("returns an empty array for a zero-pellet weapon (boundary)", () => {
    const dirs = computeShotgunPelletDirections(aim, { pellets: 0, spreadDegrees: 12 });
    expect(dirs).toEqual([]);
  });

  it("returns the aim centre for a single-pellet weapon (no fan)", () => {
    const dirs = computeShotgunPelletDirections(aim, { pellets: 1, spreadDegrees: 12 });
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toEqual(aim);
  });
});
