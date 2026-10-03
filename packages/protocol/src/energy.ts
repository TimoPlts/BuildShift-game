/**
 * Shared Energy economy and structure-durability protocol contract.
 *
 * This module defines the transport-neutral, server-authoritative contract for:
 *
 *  - **Energy** — the regenerating resource that gates structure placement.
 *    Every player has a bounded energy pool that regenerates deterministically
 *    over simulation ticks. Placing a structure costs energy equal to the
 *    structure's `StructureConfig.cost` (see `@buildshift/game-config`).
 *
 *  - **Structure durability** — each placed structure carries a durability
 *    value that weapons can reduce. When durability reaches 0 the structure is
 *    destroyed and removed for every client.
 *
 * The protocol package owns the *shapes* (interfaces, event identifiers,
 * payloads, and pure deterministic helpers); `@buildshift/game-config` owns
 * the concrete *balance values* (max energy, regen rate, per-structure
 * durability).
 *
 * All rules here are deterministic: given the same inputs, the same outputs
 * are produced on both the authoritative server and the predicting client.
 * No behavior is enforced here — this is a contract definition only.
 */

import type { WeaponId } from "./weapons.js";

// ────────────────────────────────────────────────────────────────────────────
// Energy limits (protocol invariants)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Protocol-level invariants for player energy values.
 *
 * `min` is the floor: energy can never go below 0 (a player cannot be in
 * "negative energy"). `max` is the protocol upper bound that no concrete game
 * configuration should exceed — it acts as a safety ceiling for validation
 * (e.g. rejecting a server broadcast with energy above this value).
 *
 * The actual game balance `maxEnergy` (how much energy a player can have in
 * play) is a smaller value defined in `@buildshift/game-config` (`ENERGY.maxEnergy`);
 * this protocol `max` is wider so the wire format stays stable across balance
 * changes.
 */
export const ENERGY_LIMITS = {
  /** Lowest valid energy value (energy can never go below this). */
  min: 0,
  /** Highest valid energy value on the wire (protocol safety ceiling). */
  max: 10_000,
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Energy state
// ────────────────────────────────────────────────────────────────────────────

/**
 * The authoritative energy state of a single player.
 *
 * Mirrors the `energy` field on `PlayerStateSchema`. The server is the sole
 * writer; clients read this value for HUD display and local build-affordability
 * prediction.
 */
export interface EnergyState {
  /**
   * Current energy available to the player (>= 0, <= the game-config
   * `maxEnergy`). The server initialises this to the game-config
   * `startingEnergy` on player join and manages it thereafter.
   */
  energy: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Structure durability
// ────────────────────────────────────────────────────────────────────────────

/**
 * The durability (health) state of a single placed structure.
 *
 * Each structure starts at `maxDurability` (determined by its build type from
 * `@buildshift/game-config` `STRUCTURE_DURABILITY`) and is reduced by weapon
 * hits. When `currentDurability` reaches 0 the structure is destroyed and
 * removed for all clients.
 */
export interface StructureDurabilityState {
  /** Maximum durability for this structure (determined by build type). */
  maxDurability: number;
  /**
   * Current remaining durability. Starts at `maxDurability` on placement;
   * decreases by the weapon's `damage` on each confirmed hit. A value of `0`
   * means the structure is destroyed.
   */
  currentDurability: number;
}

/**
 * Protocol-level bounds for structure durability values (wire safety).
 */
export const STRUCTURE_DURABILITY_LIMITS = {
  /** Lowest valid durability (a destroyed structure). */
  min: 0,
  /** Highest valid durability on the wire (protocol safety ceiling). */
  max: 1_000_000,
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Energy and structure events
// ────────────────────────────────────────────────────────────────────────────

/**
 * Energy and structure-durability network event identifiers.
 *
 * Follows the same `namespace:action` convention as `EVENTS` and
 * `BUILD_EVENTS`.
 */
export const ENERGY_EVENTS = {
  /**
   * Server → all: a player's energy changed (regeneration tick, placement
   * cost applied, or any other authoritative energy modification).
   */
  ENERGY_UPDATE: "energy:update",
  /**
   * Server → all: an authoritative structure was damaged by a weapon hit but
   * was not destroyed.
   */
  STRUCTURE_DAMAGED: "build:structure_damaged",
  /**
   * Server → all: an authoritative structure was destroyed (durability
   * reached 0). The structure is removed from `BuildingState` for every
   * client.
   */
  STRUCTURE_DESTROYED: "build:structure_destroyed",
} as const;

/** A valid energy / structure-durability event identifier. */
export type EnergyEventName = (typeof ENERGY_EVENTS)[keyof typeof ENERGY_EVENTS];

// ────────────────────────────────────────────────────────────────────────────
// Event payloads
// ────────────────────────────────────────────────────────────────────────────

/**
 * Canonical payload for {@link ENERGY_EVENTS.ENERGY_UPDATE}.
 *
 * Broadcast after any authoritative energy change so every client's HUD can
 * reflect the exact authoritative energy without relying solely on
 * state-diff latency.
 */
export interface EnergyUpdateEvent {
  /** Colyseus `sessionId` of the affected player. */
  playerId: string;
  /** Authoritative energy after the change (>= 0). */
  energy: number;
}

/**
 * Canonical payload for {@link ENERGY_EVENTS.STRUCTURE_DAMAGED}.
 *
 * Broadcast when a weapon hit reduces a structure's durability but does not
 * destroy it. Lets clients show durability feedback (e.g. cracks, HP bar).
 */
export interface StructureDamageEvent {
  /** The `structureId` of the damaged structure. */
  structureId: string;
  /** Damage applied by this hit, in durability points (positive). */
  damage: number;
  /** Remaining durability after this hit (>= 0, > 0 for non-destruction). */
  remainingDurability: number;
  /** Colyseus `sessionId` of the player who dealt the damage. */
  sourcePlayerId: string;
  /** The weapon that dealt the damage. */
  sourceWeaponId: WeaponId;
}

/**
 * Canonical payload for {@link ENERGY_EVENTS.STRUCTURE_DESTROYED}.
 *
 * Broadcast when a structure's durability reaches 0 and the structure is
 * authoritatively removed from `BuildingState`. The structureId identifies
 * which entry to remove; the `destroyedByPlayerId` identifies who destroyed
 * it (for UI / kill-feed presentation).
 */
export interface StructureDestroyedEvent {
  /** The `structureId` of the destroyed structure. */
  structureId: string;
  /** Colyseus `sessionId` of the player whose hit destroyed the structure. */
  destroyedByPlayerId: string;
  /** The weapon that delivered the destroying hit. */
  destroyedByWeaponId: WeaponId;
}

// ────────────────────────────────────────────────────────────────────────────
// Per-build energy cost contract
// ────────────────────────────────────────────────────────────────────────────

/**
 * The energy cost to place a single structure, keyed by build type.
 *
 * This is the *contract shape* that `@buildshift/game-config`'s
 * `StructureConfig.cost` field fulfils. The server checks the player's
 * current energy against this cost before authoritatively accepting a
 * placement; the client uses it for its local affordability prediction.
 *
 * The concrete values live in `@buildshift/game-config` (`STRUCTURES[buildType].cost`);
 * this interface documents that the `cost` field *is* the energy cost.
 */
export interface BuildEnergyCost {
  /** The build type this cost applies to. */
  buildType: string;
  /** Energy points consumed to place one instance of this structure. */
  energyCost: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Deterministic helpers (pure functions, shared by client and server)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compute a player's energy after `ticksElapsed` ticks of regeneration.
 *
 * Pure and deterministic: given the same arguments, always produces the same
 * result. The result is clamped to `[0, maxEnergy]`.
 *
 * @param currentEnergy - The player's energy before regeneration (>= 0).
 * @param maxEnergy     - The game-config maximum energy (the ceiling).
 * @param ticksElapsed  - Number of simulation ticks that have elapsed since
 *                        the last energy snapshot (>= 0).
 * @param regenPerTick  - Energy points regenerated per simulation tick
 *                        (the game-config `ENERGY.regenPerTick`).
 * @returns The energy value after regeneration, clamped to `[0, maxEnergy]`.
 */
export function computeEnergyAfterRegeneration(
  currentEnergy: number,
  maxEnergy: number,
  ticksElapsed: number,
  regenPerTick: number,
): number {
  if (ticksElapsed <= 0 || regenPerTick <= 0) {
    return clampEnergy(currentEnergy, maxEnergy);
  }
  const regenerated = currentEnergy + ticksElapsed * regenPerTick;
  return clampEnergy(regenerated, maxEnergy);
}

/**
 * Check whether a player has enough energy to afford a structure placement.
 *
 * Pure and deterministic.
 *
 * @param currentEnergy - The player's current energy (>= 0).
 * @param cost          - The energy cost of the structure being placed
 *                        (`StructureConfig.cost`).
 * @returns `true` when the player can afford the placement.
 */
export function canAffordBuild(
  currentEnergy: number,
  cost: number,
): boolean {
  return currentEnergy >= cost && cost >= 0;
}

/**
 * Compute the player's energy remaining after a build placement is accepted.
 *
 * Pure and deterministic. Returns the energy clamped to `[0, maxEnergy]`.
 *
 * @param currentEnergy - The player's energy before the placement.
 * @param cost          - The energy cost of the placed structure.
 * @param maxEnergy     - The game-config maximum energy.
 * @returns The energy value after the cost is deducted.
 */
export function computeEnergyAfterBuild(
  currentEnergy: number,
  cost: number,
  maxEnergy: number,
): number {
  const after = currentEnergy - cost;
  return clampEnergy(after, maxEnergy);
}

/**
 * Compute a structure's remaining durability after a weapon hit.
 *
 * Pure and deterministic. If the resulting durability would be negative,
 * it is clamped to 0 (structure destroyed).
 *
 * @param currentDurability - The structure's durability before the hit (>= 0).
 * @param damage            - Damage dealt by the hit (positive durability
 *                            points).
 * @returns The durability after the hit, clamped to `[0, ∞)`.
 */
export function applyStructureDamage(
  currentDurability: number,
  damage: number,
): number {
  if (damage <= 0) {
    return Math.max(0, currentDurability);
  }
  return Math.max(0, currentDurability - damage);
}

/**
 * Check whether a structure is destroyed (durability has reached 0).
 *
 * @param currentDurability - The structure's current durability.
 * @returns `true` when the structure should be removed.
 */
export function isStructureDestroyed(
  currentDurability: number,
): boolean {
  return currentDurability <= 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

function clampEnergy(value: number, maxEnergy: number): number {
  if (!Number.isFinite(value)) return ENERGY_LIMITS.min;
  return Math.min(Math.max(value, ENERGY_LIMITS.min), maxEnergy);
}
