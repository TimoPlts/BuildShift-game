/**
 * Shared weapon and player combat configuration.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §7.5, combat balance values (weapon
 * damage, range, fire rate, and player health) live in this package so the
 * authoritative server and the client predict/validate against the exact same
 * numbers. The first combat milestone (two-player hitscan) ships a single
 * weapon: the `blaster`.
 */

/** The class of damage a weapon deals. Only hitscan is supported for now. */
export type WeaponKind = "hitscan";

/** A single weapon definition shared by client and server. */
export interface WeaponConfig {
  /** Stable weapon identifier (e.g. `"blaster"`). */
  id: string;
  /** Damage class for this weapon. */
  kind: WeaponKind;
  /** Damage dealt per hit, in health points. */
  damage: number;
  /** Maximum effective range in metres (hitscan stop distance). */
  range: number;
  /** Minimum time between consecutive shots, in milliseconds. */
  fireCooldownMs: number;
}

/**
 * The set of weapons available to players.
 *
 * The first combat milestone exposes a single hitscan weapon. Additional
 * weapons can be appended to this array in later stages without changing the
 * consumer contract (consumers look a weapon up by {@link WeaponConfig.id}).
 */
export const WEAPONS: readonly WeaponConfig[] = [
  {
    id: "blaster",
    kind: "hitscan",
    damage: 20,
    range: 50,
    fireCooldownMs: 333,
  },
] as const;

/**
 * Look up a weapon definition by its stable id.
 *
 * Returns `undefined` for unknown ids so callers can validate player intent
 * (e.g. the authoritative server rejecting a shot with an unknown weapon).
 */
export function getWeaponById(id: string): WeaponConfig | undefined {
  return WEAPONS.find((w) => w.id === id);
}

/**
 * Shared player combat tuning.
 *
 * `maxHealth` is the starting (and maximum) health of a player. The
 * authoritative server initialises every player to this value on join and the
 * client uses it for its health bar / local prediction.
 */
export const PLAYER = {
  /** Starting and maximum health of a player. */
  maxHealth: 100,
} as const;
