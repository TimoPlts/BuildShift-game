/**
 * Shared Energy economy and structure-durability configuration.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §7.5, energy and durability balance
 * values live in this package so the authoritative server (`apps/game-server`)
 * and the client (`apps/web`) reference the exact same numbers.
 *
 * The protocol package (`@buildshift/protocol` → `energy.ts`) owns the
 * *shapes* of the energy contract (`EnergyState`, `StructureDurabilityState`,
 * event payloads, pure deterministic helpers); this package owns the
 * concrete *balance values* those shapes are driven by:
 *
 *  - {@link ENERGY} — the player's energy pool limits and regeneration rate,
 *  - {@link STRUCTURE_DURABILITY} — per-build-type maximum durability,
 *  - {@link getStructureDurability} — look up a structure's max durability
 *    by its build type.
 *
 * The per-build energy cost is already defined in {@link STRUCTURES}
 * (`StructureConfig.cost`); those values *are* the energy cost in points.
 * This module does not restate them to avoid a second source of truth.
 */

// ────────────────────────────────────────────────────────────────────────────
// Player energy configuration
// ────────────────────────────────────────────────────────────────────────────

/**
 * Player energy pool tuning.
 *
 * Every player has a regenerating energy pool. Placing a structure costs
 * energy (see `StructureConfig.cost` in `building.ts`). The pool regenerates
 * deterministically at `regenPerTick` points per simulation tick, up to
 * `maxEnergy`.
 *
 * Expressed in simulation ticks (matching the tick-based cadence convention
 * used by weapon `fireIntervalTicks` and `BUILD_RATE.minTicksBetweenPlacements`)
 * so the regeneration is deterministic on both the predicting client and the
 * authoritative server.
 */
export const ENERGY = {
  /**
   * Maximum energy a player can hold. The pool cannot exceed this value.
   *
   * Balance: with `regenPerTick: 1` at 30 ticks/s, a player regenerates
   * 30 energy per second. At `maxEnergy: 100`, a player from 0 energy can
   * place a wall (cost 10) after ~0.33 s, or a floor (cost 5) after ~0.17 s.
   */
  maxEnergy: 100,
  /**
   * Energy a player starts with on join (and after a round reset).
   *
   * Starting at full means the first placement of any structure is always
   * affordable without waiting for regeneration.
   */
  startingEnergy: 100,
  /**
   * Energy points regenerated per simulation tick.
   *
   * At 30 ticks/s this is 30 energy/s. Combined with `maxEnergy: 100`,
   * a fully depleted pool refills in ~3.33 s.
   */
  regenPerTick: 1,
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Structure durability configuration
// ────────────────────────────────────────────────────────────────────────────

/**
 * The build-type keys the structure durability is keyed by.
 *
 * These are the *same* stable ids the protocol's `BuildType` uses and the
 * `BUILD_STRUCTURE_KEYS` in `building.ts`; they are declared locally so this
 * module stays self-contained while remaining structurally aligned.
 */
export const STRUCTURE_DURABILITY_KEYS = ["wall", "floor", "ramp", "cone"] as const;

/** A build-type key used by the structure durability configuration. */
export type StructureDurabilityKey = (typeof STRUCTURE_DURABILITY_KEYS)[number];

/**
 * Per-build-type maximum durability values.
 *
 * A structure's `currentDurability` starts at its `maxDurability` from this
 * table when placed. Weapons reduce it by their `damage` value per hit.
 * When it reaches 0 the structure is destroyed and removed.
 *
 * Balance:
 *  - **wall** (200) — the toughest structure; absorbs 25 assault-rifle hits
 *    (damage 20) or 2.5 shotgun blasts (damage 80). A primary defensive pick.
 *  - **floor** (100) — moderate; absorbs 5 assault-rifle hits or 1.25 shotgun
 *    blasts. Cheap to place (cost 5), quick to destroy.
 *  - **ramp** (150) — between wall and floor; absorbs 7.5 assault-rifle hits
 *    or 1.875 shotgun blasts.
 *  - **cone** (80) — the most fragile; absorbs 4 assault-rifle hits or 1
 *    shotgun blast. Used for utility (point/fixture), not defense.
 */
export const STRUCTURE_DURABILITY: Record<StructureDurabilityKey, number> = {
  wall: 200,
  floor: 100,
  ramp: 150,
  cone: 80,
};

/**
 * Look up a structure's maximum durability by its build type.
 *
 * Returns `undefined` for unknown ids so callers can validate before use
 * (mirroring the `getStructureConfig` and `getWeaponById` contracts).
 */
export function getStructureDurability(buildType: string): number | undefined {
  return (STRUCTURE_DURABILITY as Record<string, number>)[buildType];
}
