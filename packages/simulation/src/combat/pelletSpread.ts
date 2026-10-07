/**
 * Pellet-spread helpers for the 1v1 Energy Box Fight shotgun.
 *
 * A shotgun shot is modelled as `pelletCount` independent hitscan rays fanned
 * across a total `spreadAngleDeg` cone around the aim direction. This module
 * owns the *pure* math that turns a weapon's pellet count + spread angle into
 * the per-pellet angular offsets and aim directions, so the authoritative
 * server (which fires the real pellets through `hitscan`) and the client (which
 * predicts the spread for prediction / VFX) use the identical calculation.
 *
 * No platform-specific code, no side effects — pure, deterministic, and
 * trivially unit-testable. It depends only on the shared `Vec3` type from
 * {@link ./hitscan.js} (type-only import, so there is no runtime coupling).
 */

import type { Vec3 } from "./hitscan.js";

/**
 * Convert an angle from degrees to radians.
 *
 * @param degrees the angle in degrees.
 * @returns the angle in radians.
 */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Compute the per-pellet angular offsets for a shotgun-style spread.
 *
 * Evenly distributes `pelletCount` angular offsets (in **radians**)
 * symmetrically about `0` across the *total* `spreadAngleDeg` cone — i.e. the
 * pellets fan from `-spreadAngleDeg / 2` to `+spreadAngleDeg / 2`. The first
 * and last elements are the two edges of the cone and the middle is `0` (the
 * aim centre), so the pattern is centred on the player's aim.
 *
 * Boundary semantics:
 *  - **`pelletCount <= 0`** or non-integer → `[]` (no pellets).
 *  - **`pelletCount === 1`** → `[0]` (a single, non-spread ray down the aim
 *    centre).
 *  - **`spreadAngleDeg <= 0`** → `pelletCount` copies of `0` (no fan).
 *  - otherwise → `pelletCount` evenly spaced offsets spanning the full cone.
 *
 * @param pelletCount the number of pellets in the shot (must be a positive
 *   safe integer for a real pattern).
 * @param spreadAngleDeg the total cone width of the spread, in degrees.
 * @returns an array of `pelletCount` angle offsets in radians (centered at 0).
 */
export function computePelletSpreadAngles(
  pelletCount: number,
  spreadAngleDeg: number,
): number[] {
  if (!Number.isInteger(pelletCount) || pelletCount <= 0) {
    return [];
  }
  if (pelletCount === 1) {
    return [0];
  }

  // A non-positive spread cone produces no fan — every pellet fires down the
  // aim centre (offset 0).
  const totalSpread = degreesToRadians(spreadAngleDeg);
  if (!(totalSpread > 0)) {
    return new Array<number>(pelletCount).fill(0);
  }

  const half = totalSpread / 2;
  const step = totalSpread / (pelletCount - 1);
  const angles: number[] = [];
  for (let i = 0; i < pelletCount; i += 1) {
    angles.push(-half + i * step);
  }
  return angles;
}

/**
 * Compute the per-pellet aim *directions* for a shotgun shot.
 *
 * Given the player's base aim direction and the weapon's pellet count + spread
 * angle, returns `pelletCount` direction vectors: the base direction rotated
 * (around the world **+Y** up axis) by each offset from
 * {@link computePelletSpreadAngles}. This is a *horizontal* (yaw) spread — the
 * common shotgun model — so a shot fired while looking up / down keeps its
 * pitch and only fans left/right.
 *
 * Rotation convention (matches the game's yaw: 0 faces −Z, positive rotates
 * toward +X, see `movementInputToWorld`):
 *   - `x' =  x·cosθ − z·sinθ`
 *   - `z' =  x·sinθ + z·cosθ`
 *   - `y' =  y`
 *
 * A pure rotation, so each output vector has the same length as
 * {@link baseDirection} (no normalisation is applied or required).
 *
 * @param baseDirection the player's aim direction; any magnitude.
 * @param pelletCount the number of pellets in the shot.
 * @param spreadAngleDeg the total cone width of the spread, in degrees.
 * @returns an array of `pelletCount` aim directions (same order as
 *   {@link computePelletSpreadAngles}).
 */
export function computePelletDirections(
  baseDirection: Readonly<Vec3>,
  pelletCount: number,
  spreadAngleDeg: number,
): Vec3[] {
  const offsets = computePelletSpreadAngles(pelletCount, spreadAngleDeg);
  const directions: Vec3[] = new Array<Vec3>(offsets.length);
  for (let i = 0; i < offsets.length; i += 1) {
    const theta = offsets[i];
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    directions[i] = {
      x: baseDirection.x * cos - baseDirection.z * sin,
      y: baseDirection.y,
      z: baseDirection.x * sin + baseDirection.z * cos,
    };
  }
  return directions;
}
