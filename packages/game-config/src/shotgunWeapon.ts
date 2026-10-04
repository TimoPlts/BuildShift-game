/**
 * 1v1 Energy Box Fight weapon roster — authoritative shotgun + assault rifle.
 *
 * This module is an *additive* weapon vocabulary for the 1v1 Energy Box Fight
 * mode. It intentionally does NOT modify the legacy canonical
 * {@link SHOTGUN} / {@link ASSAULT_RIFLE} / `WEAPONS` definitions in
 * `weapons.ts` nor the pellet-shape {@link ENERGY_SHOTGUN} in
 * `energyWeapons.ts`; those stay untouched so existing consumers keep
 * compiling unchanged.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §7.5, the concrete *balance values* for
 * each weapon live in this package so the authoritative server and the client
 * read the exact same numbers. The shotgun is a pellet weapon: a single
 * trigger pull fires `pellets` independent hitscan rays fanned across
 * `spreadDegrees`, each dealing `perPelletDamage`. The magazine holds
 * `magazineSize` rounds, fires at `fireRatePerSec` shots per second, a full
 * reload takes `reloadTimeMs` milliseconds, and effective range is `range`
 * metres.
 *
 * Both weapons are exposed through a *discriminated union*
 * ({@link EnergyFightWeaponDefinition}) and a typed map
 * ({@link ENERGY_FIGHT_WEAPONS}) so either is accessible by string id
 * (`"shotgun"` / `"assault_rifle"`).
 */

// ───────────────────────────────── Weapon id vocabulary ─────────────────────────────────

/** Stable id of the Energy Box Fight shotgun. */
export const SHOTGUN_WEAPON_ID = "shotgun" as const;

/** Stable id of the Energy Box Fight assault rifle. */
export const ASSAULT_RIFLE_WEAPON_ID = "assault_rifle" as const;

/** A valid Energy Box Fight weapon id (string-id vocabulary). */
export type EnergyFightWeaponId =
  | typeof SHOTGUN_WEAPON_ID
  | typeof ASSAULT_RIFLE_WEAPON_ID;

/** All valid Energy Box Fight weapon ids as a frozen tuple. */
export const ENERGY_FIGHT_WEAPON_IDS = Object.freeze([
  SHOTGUN_WEAPON_ID,
  ASSAULT_RIFLE_WEAPON_ID,
] as const);

/** Type guard: `value` is a valid {@link EnergyFightWeaponId}. */
export function isEnergyFightWeaponId(value: unknown): value is EnergyFightWeaponId {
  return (
    typeof value === "string" &&
    (ENERGY_FIGHT_WEAPON_IDS as readonly string[]).includes(value)
  );
}

// ───────────────────────────────── Weapon config shape ─────────────────────────────────

/**
 * Fields shared by every Energy Box Fire weapon, regardless of weapon kind.
 *
 * These are the "fire + magazine + reload" economics that the authoritative
 * weapon-switch / reload state machine needs for *any* weapon the player
 * carries.
 */
export interface EnergyFightWeaponBase {
  /** Stable string id of the weapon. */
  id: EnergyFightWeaponId;
  /** Discriminant selecting the concrete weapon shape. */
  kind: EnergyFightWeaponId;
  /** Shots the weapon can fire per second (fire cadence). */
  fireRatePerSec: number;
  /** Number of rounds held in the weapon's magazine. */
  magazineSize: number;
  /** Duration of a full reload, in milliseconds. */
  reloadTimeMs: number;
  /** Maximum effective range, in metres. */
  range: number;
}

/**
 * The balance definition of the Energy Box Fight shotgun.
 *
 * A single trigger pull fires {@link pellets} independent hitscan rays fanned
 * across the total {@link spreadDegrees} cone, each dealing
 * {@link perPelletDamage}. Extends the shared {@link EnergyFightWeaponBase}
 * fire / magazine / reload economics.
 */
export interface ShotgunWeaponDefinition extends EnergyFightWeaponBase {
  readonly id: typeof SHOTGUN_WEAPON_ID;
  readonly kind: "shotgun";
  /** Number of pellets fired per trigger pull. */
  pellets: number;
  /** Damage dealt by each individual pellet, in health points. */
  perPelletDamage: number;
  /** Total angular width of the pellet spread, in degrees. */
  spreadDegrees: number;
}

/**
 * The balance definition of the Energy Box Fight assault rifle.
 *
 * A single trigger pull fires one hitscan ray dealing {@link perShotDamage}.
 * Extends the shared {@link EnergyFightWeaponBase} fire / magazine / reload
 * economics. This is a *new, parallel* definition; the legacy canonical
 * `ASSAULT_RIFLE` (`WeaponConfig`) in `weapons.ts` is left untouched.
 */
export interface AssaultRifleWeaponDefinition extends EnergyFightWeaponBase {
  readonly id: typeof ASSAULT_RIFLE_WEAPON_ID;
  readonly kind: "assault_rifle";
  /** Damage dealt per shot, in health points. */
  perShotDamage: number;
}

/**
 * Discriminated union of the Energy Box Fight weapons, keyed by `kind` (and
 * `id`). Both weapons are accessible by their string id via
 * {@link ENERGY_FIGHT_WEAPONS} / {@link getEnergyFightWeaponById}.
 */
export type EnergyFightWeaponDefinition =
  | ShotgunWeaponDefinition
  | AssaultRifleWeaponDefinition;

// ───────────────────────────────── Weapon roster ─────────────────────────────────

/**
 * The canonical Energy Box Fight shotgun.
 *
 * Balance: an 8-pellet spread at 12° of total cone, 12 damage per pellet
 * (≈ 96 maximum on a point-blank full hit), 2 shots/second, a 4-round
 * magazine, a 2.5 s reload, and 20 m of effective range.
 */
export const SHOTGUN_WEAPON: ShotgunWeaponDefinition = {
  id: SHOTGUN_WEAPON_ID,
  kind: "shotgun",
  pellets: 8,
  perPelletDamage: 12,
  spreadDegrees: 12,
  fireRatePerSec: 2,
  magazineSize: 4,
  reloadTimeMs: 2500,
  range: 20,
};

/**
 * The canonical Energy Box Fight assault rifle.
 *
 * Balance: a single 20-damage hitscan ray, 12.5 shots/second, a 30-round
 * magazine, a 1.8 s reload, and 60 m of effective range.
 */
export const ASSAULT_RIFLE_WEAPON: AssaultRifleWeaponDefinition = {
  id: ASSAULT_RIFLE_WEAPON_ID,
  kind: "assault_rifle",
  perShotDamage: 20,
  fireRatePerSec: 12.5,
  magazineSize: 30,
  reloadTimeMs: 1800,
  range: 60,
};

/**
 * The set of weapons available to players in the 1v1 Energy Box Fight mode,
 * keyed by stable string id.
 *
 * A typed map so each weapon is reachable directly by its id
 * (`ENERGY_FIGHT_WEAPONS["shotgun"]`) and so the keys are exhaustively
 * checked. Consumers that want a validated lookup (returning `undefined` for
 * unknown ids) should use {@link getEnergyFightWeaponById}.
 */
export const ENERGY_FIGHT_WEAPONS: Readonly<
  Record<EnergyFightWeaponId, EnergyFightWeaponDefinition>
> = {
  [SHOTGUN_WEAPON_ID]: SHOTGUN_WEAPON,
  [ASSAULT_RIFLE_WEAPON_ID]: ASSAULT_RIFLE_WEAPON,
};

/**
 * Look up an Energy Box Fight weapon definition by its stable string id.
 *
 * Returns `undefined` for unknown ids so callers can validate player intent
 * (e.g. the authoritative server rejecting a weapon switch to an unknown
 * weapon), mirroring the `getWeaponById` / `getEnergyWeaponById` contracts.
 */
export function getEnergyFightWeaponById(
  id: string,
): EnergyFightWeaponDefinition | undefined {
  if (id in ENERGY_FIGHT_WEAPONS) {
    return ENERGY_FIGHT_WEAPONS[id as EnergyFightWeaponId];
  }
  return undefined;
}
