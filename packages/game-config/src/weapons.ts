/**
 * Shared weapon and player combat configuration.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §7.5, combat balance values (weapon
 * damage, fire cadence, ammo, and player health/shield) live in this package
 * so the authoritative server and the client predict/validate against the
 * exact same numbers.
 *
 * The canonical hitscan combat contract ships two weapons — the
 * {@link SHOTGUN} and the {@link ASSAULT_RIFLE} — plus the shared
 * {@link MAX_HEALTH} / {@link MAX_SHIELD} player combat defaults.
 *
 * The legacy `blaster` entry (and the time-based `fireCooldownMs` /
 * `PLAYER.maxHealth` accessors) are retained so the first-combat-milestone
 * room keeps compiling during the Stage 2D consolidation; they are superseded
 * by the tick-based `fireIntervalTicks` gate and the `MAX_HEALTH` /
 * `MAX_SHIELD` constants.
 */

/** The class of damage a weapon deals. Only hitscan is supported for now. */
export type WeaponKind = "hitscan";

/** A single weapon definition shared by client and server. */
export interface WeaponConfig {
  /** Stable weapon identifier (e.g. `"shotgun"`). */
  id: string;
  /** Damage class for this weapon. */
  kind: WeaponKind;
  /** Damage dealt per hit, in health points. */
  damage: number;
  /** Maximum effective range in metres (hitscan stop distance). */
  range: number;
  /**
   * Minimum time between consecutive shots, in milliseconds.
   *
   * @deprecated Legacy time-based cooldown gate from the first combat
   * milestone. The canonical contract gates fire on
   * {@link WeaponConfig.fireIntervalTicks} (ticks) instead, which is what the
   * shared `canFire` helper uses. Kept so the legacy room keeps compiling.
   */
  fireCooldownMs: number;
  /**
   * Minimum number of simulation ticks between consecutive shots — the
   * canonical tick-based cooldown gate used by `canFire` on both the client
   * (local fire prediction) and the server (validation).
   */
  fireIntervalTicks: number;
  /** Maximum rounds held in the magazine. */
  maxAmmo: number;
  /** Maximum rounds available to reload the magazine. */
  maxReserve: number;
  /** Number of simulation ticks a full reload takes. */
  reloadTicks: number;
}

/**
 * The canonical hitscan weapons available to players.
 *
 * Both weapons are hitscan: they deal `damage` to the first target the aim ray
 * reaches within `range`, and fire at most once every `fireIntervalTicks`
 * simulation ticks. Additional weapons can be appended to {@link WEAPONS} in
 * later stages without changing the consumer contract (consumers look a
 * weapon up by {@link WeaponConfig.id}).
 */
export const SHOTGUN: WeaponConfig = {
  id: "shotgun",
  kind: "hitscan",
  damage: 80,
  range: 15,
  fireCooldownMs: 1155, // ≈ 35 ticks × 33 ms (legacy time-based gate)
  fireIntervalTicks: 35,
  maxAmmo: 5,
  maxReserve: 20,
  reloadTicks: 45,
};

export const ASSAULT_RIFLE: WeaponConfig = {
  id: "assault_rifle",
  kind: "hitscan",
  damage: 20,
  range: 60,
  fireCooldownMs: 264, // ≈ 8 ticks × 33 ms (legacy time-based gate)
  fireIntervalTicks: 8,
  maxAmmo: 30,
  maxReserve: 60,
  reloadTicks: 60,
};

/**
 * Legacy blaster from the first combat milestone.
 *
 * Retained only so the pre-consolidation combat room (which looks the weapon
 * up by id `"blaster"` and reads `fireCooldownMs`) keeps compiling. It uses
 * the same tick-based fields as the canonical weapons so it satisfies the
 * shared {@link WeaponConfig} contract.
 */
export const BLASTER: WeaponConfig = {
  id: "blaster",
  kind: "hitscan",
  damage: 20,
  range: 50,
  fireCooldownMs: 333,
  fireIntervalTicks: 10,
  maxAmmo: 10,
  maxReserve: 30,
  reloadTicks: 30,
};

/**
 * The set of weapons available to players.
 *
 * The canonical hitscan weapons ({@link SHOTGUN} and {@link ASSAULT_RIFLE})
 * plus the legacy {@link BLASTER}. Consumers look a weapon up by
 * {@link WeaponConfig.id} via {@link getWeaponById}.
 */
export const WEAPONS: readonly WeaponConfig[] = [
  SHOTGUN,
  ASSAULT_RIFLE,
  BLASTER,
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

/** Starting and maximum health of a player (canonical combat default). */
export const MAX_HEALTH = 100;

/** Maximum shield of a player (canonical combat default). */
export const MAX_SHIELD = 50;

/**
 * Shared player combat tuning.
 *
 * `maxHealth` / `maxShield` are the starting (and maximum) health and shield
 * of a player. The authoritative server initialises every player to these
 * values on join and the client uses them for its HUD / local prediction.
 *
 * @deprecated Prefer the flat {@link MAX_HEALTH} / {@link MAX_SHIELD}
 * constants; this nested object is retained so the first-combat-milestone
 * room (which reads `PLAYER.maxHealth`) keeps compiling.
 */
export const PLAYER = {
  /** Starting and maximum health of a player. */
  maxHealth: MAX_HEALTH,
  /** Starting and maximum shield of a player. */
  maxShield: MAX_SHIELD,
} as const;
