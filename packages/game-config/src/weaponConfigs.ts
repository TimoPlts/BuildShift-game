/**
 * Canonical weapon balance configuration for the 1v1 Energy Box Fight mode.
 *
 * This is a *new, self-contained* balance roster keyed by the stable weapon
 * ids used across the canonical Energy Box Fight contract (`"assaultRifle"` /
 * `"shotgun"`). It is additive: it does NOT modify the legacy
 * {@link WEAPONS} / {@link WeaponConfig} in `weapons.ts`, the pellet-shaped
 * {@link ENERGY_SHOTGUN} in `energyWeapons.ts`, the roster in
 * `shotgunWeapon.ts`, or the balance map in `energyBoxFightConfig.ts`. Those
 * stay untouched so existing consumers keep compiling unchanged.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §7.5 these concrete balance values live in
 * this package so the authoritative server and the client reference the exact
 * same numbers. This module is *data only*: no engine imports, no
 * presentation, no side effects.
 *
 * Units: `damage` is health points; `range` is metres; `fireInterval` and
 * `reloadTime` are **milliseconds**; `ammoCapacity` is rounds; the shotgun-only
 * `pellets` is rounds-per-shot and `spreadAngle` is the total spread cone in
 * **radians**.
 */

// ─────────────────────────── Weapon id vocabulary ───────────────────────────

/**
 * A stable weapon id for the canonical Energy Box Fight weapon balance map.
 *
 * Declared locally so this package does not import the protocol package; the
 * string values are the shared vocabulary for the authoritative weapon system.
 */
export type WeaponConfigId = "assaultRifle" | "shotgun";

/** All valid weapon ids for the canonical roster, as a frozen tuple. */
export const WEAPON_CONFIG_IDS = Object.freeze([
  "assaultRifle",
  "shotgun",
] as const);

/** Type guard: `value` is a valid {@link WeaponConfigId}. */
export function isWeaponConfigId(value: unknown): value is WeaponConfigId {
  return (
    typeof value === "string" &&
    (WEAPON_CONFIG_IDS as readonly string[]).includes(value)
  );
}

// ─────────────────────────── Weapon config shape ───────────────────────────

/**
 * Balance definition shared by every canonical Energy Box Fight weapon.
 *
 * These are the "fire + magazine + reload" economics the authoritative
 * weapon-switch / fire / reload state machine needs for *any* weapon.
 */
export interface BaseWeaponConfig {
  /** Damage dealt per shot, in health points. */
  damage: number;
  /** Maximum effective range, in metres. */
  range: number;
  /** Minimum time between consecutive shots, in milliseconds. */
  fireInterval: number;
  /** Duration of a full reload, in milliseconds. */
  reloadTime: number;
  /** Number of rounds held in the magazine. */
  ammoCapacity: number;
}

/**
 * The assault-rifle balance definition.
 *
 * A single-shot hitscan weapon: one trigger pull fires one ray dealing
 * {@link BaseWeaponConfig.damage} to the first target reached within
 * {@link BaseWeaponConfig.range}.
 */
export interface AssaultRifleConfig extends BaseWeaponConfig {
  readonly weaponId: "assaultRifle";
}

/**
 * The shotgun balance definition.
 *
 * A pellet weapon: one trigger pull fires {@link pellets} independent hitscan
 * rays fanned across the total {@link spreadAngle} cone (in radians), each
 * dealing {@link BaseWeaponConfig.damage}.
 */
export interface ShotgunConfig extends BaseWeaponConfig {
  readonly weaponId: "shotgun";
  /** Number of pellets fired per trigger pull. */
  pellets: number;
  /** Total angular width of the pellet spread cone, in **radians**. */
  spreadAngle: number;
}

/**
 * Discriminated union of the canonical Energy Box Fight weapon configs, keyed
 * by the {@link weaponId} discriminant. Both weapons are also reachable by
 * their string id via {@link WEAPON_CONFIGS} / {@link getWeaponConfigById}.
 */
export type WeaponConfig = AssaultRifleConfig | ShotgunConfig;

// ─────────────────────────── Weapon roster ───────────────────────────

/**
 * The canonical Energy Box Fight weapon balance values, keyed by stable
 * weapon id.
 *
 * - `assaultRifle`: 25 damage, 40 m range, 120 ms between shots, 2000 ms
 *   reload, 30-round magazine.
 * - `shotgun`: 12 damage per pellet, 15 m range, 800 ms between shots,
 *   2500 ms reload, 6-round magazine, 8 pellets, 0.15 rad (~8.6°) spread.
 *
 * A typed map so each weapon is reachable directly by its id
 * (`WEAPON_CONFIGS["shotgun"]`) and so the keys are exhaustively checked.
 */
export const WEAPON_CONFIGS: Readonly<Record<WeaponConfigId, WeaponConfig>> =
  {
    assaultRifle: {
      weaponId: "assaultRifle",
      damage: 25,
      range: 40,
      fireInterval: 120,
      reloadTime: 2000,
      ammoCapacity: 30,
    },
    shotgun: {
      weaponId: "shotgun",
      damage: 12,
      range: 15,
      fireInterval: 800,
      reloadTime: 2500,
      ammoCapacity: 6,
      pellets: 8,
      spreadAngle: 0.15,
    },
  } as const;

/**
 * Look up a canonical Energy Box Fight weapon config by its stable id.
 *
 * Returns `undefined` for unknown ids so callers can validate player intent
 * (e.g. the authoritative server rejecting a fire / switch for an unknown
 * weapon), mirroring the `getWeaponById` / `getEnergyFightWeaponById`
 * contracts.
 */
export function getWeaponConfigById(
  id: string,
): WeaponConfig | undefined {
  if (isWeaponConfigId(id)) {
    return WEAPON_CONFIGS[id];
  }
  return undefined;
}
