/**
 * Shotgun-spread helper for the 1v1 Energy Box Fight mode.
 *
 * A thin, pure, convenience wrapper over {@link computePelletDirections} that
 * takes the *shotgun weapon definition* (from `@buildshift/game-config`) and
 * the player's base aim direction, and returns the per-pellet aim directions
 * for a single trigger pull.
 *
 * Keeping this helper in the simulation package (alongside the canonical
 * `computePelletDirections` / `computePelletSpreadAngles`) means the
 * authoritative server and the client predict the *identical* spread from the
 * *same* shared weapon config (`ShotgunWeaponDefinition.pellets` +
 * `.spreadDegrees`), with no platform-specific code and no side effects.
 *
 * This module is strictly *additive*: it does not alter the existing
 * movement, energy, or building helpers, nor the existing pellet-spread
 * helpers — it only adds a new, self-documenting entry point that consumes a
 * shotgun weapon definition directly.
 */
import type { ShotgunWeaponDefinition } from "@buildshift/game-config";
import type { Vec3 } from "./hitscan.js";
import { computePelletDirections } from "./pelletSpread.js";

/**
 * The subset of the {@link ShotgunWeaponDefinition} a pellet-spread
 * calculation needs: the number of pellets fired per shot and the total
 * spread cone width (in degrees).
 *
 * Declared as a `Pick` so callers may pass either a full shared
 * `ShotgunWeaponDefinition` (e.g. `SHOTGUN_WEAPON`) or a structurally
 * compatible object without importing the whole config surface.
 */
export type ShotgunSpreadWeapon = Pick<
  ShotgunWeaponDefinition,
  "pellets" | "spreadDegrees"
>;

/**
 * Compute the per-pellet aim *directions* for a shotgun shot.
 *
 * Given the player's base aim direction and the shotgun weapon definition
 * (its `pellets` count and total `spreadDegrees` cone), returns
 * `weapon.pellets` direction vectors: the base direction rotated (around the
 * world +Y up axis) by each per-pellet offset from
 * {@link computePelletDirections}. A pure horizontal (yaw) spread — the
 * common shotgun model — so a shot keeps its pitch and only fans left/right.
 *
 * This delegates entirely to {@link computePelletDirections}, so it inherits
 * its boundary semantics (no pellets → `[]`, single pellet → the aim
 * centre, non-positive spread → all pellets down the aim centre) and its
 * yaw convention (0 faces −Z, positive rotates toward +X).
 *
 * @param baseDirection the player's aim direction; any magnitude.
 * @param weapon the shotgun weapon definition (or any object providing
 *   `pellets` and `spreadDegrees`).
 * @returns an array of `weapon.pellets` aim directions.
 */
export function computeShotgunPelletDirections(
  baseDirection: Readonly<Vec3>,
  weapon: ShotgunSpreadWeapon,
): Vec3[] {
  return computePelletDirections(baseDirection, weapon.pellets, weapon.spreadDegrees);
}
