/**
 * Weapon configuration for the 1v1 Energy Box Fight mode.
 *
 * This is a *separate, additive* weapon roster from the legacy
 * {@link WeaponConfig} / `WEAPONS` in `weapons.ts` (the canonical hitscan
 * combat milestone). The Energy Box Fight shotgun is a *pellet* weapon: a
 * single shot fires `pelletCount` independent hitscan pellets fanned across a
 * `spreadAngleDeg` cone, each pellet dealing `perPelletDamage` that falls off
 * with range between `rangeFalloffStart` and `rangeFalloffEnd`. Its magazine
 * and reload are expressed in the same units the rest of the game uses
 * (`magazineCapacity` rounds, `reloadDurationMs` milliseconds).
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §7.5 these balance values live in this
 * package so the authoritative server (`apps/game-server`) and the client
 * (`apps/web`) reference the exact same numbers. This module is *data only*:
 * no engine imports, no presentation.
 *
 * The protocol package (`@buildshift/protocol` → `weapons.ts`) owns the
 * matching *string-id* vocabulary (`WeaponId`); this module owns the concrete
 * *balance values* those ids are tuned against. The two id vocabularies are
 * structurally aligned (both `"shotgun" | "assault_rifle"`) but declared
 * independently so each package stays self-contained.
 */

// ───────────────────────── Weapon id vocabulary ─────────────────────────

/**
 * A valid weapon identifier for the Energy Box Fight mode.
 *
 * Structurally identical to `@buildshift/protocol`'s `WeaponId`
 * (`"shotgun" | "assault_rifle"`); declared locally so this package does not
 * import the protocol package.
 */
export type EnergyWeaponId = "shotgun" | "assault_rifle";

/** All valid Energy Box Fight weapon ids as a frozen tuple. */
export const ENERGY_WEAPON_IDS = Object.freeze(["shotgun", "assault_rifle"] as const);

/** Type guard: `value` is a valid {@link EnergyWeaponId}. */
export function isEnergyWeaponId(value: unknown): value is EnergyWeaponId {
  return (
    typeof value === "string" &&
    (ENERGY_WEAPON_IDS as readonly string[]).includes(value)
  );
}

// ───────────────────────── Weapon config shape ─────────────────────────

/**
 * The balance definition for a single Energy Box Fight weapon.
 *
 * The shotgun is a pellet weapon: one trigger pull fires `pelletCount`
 * pellets fanned across `spreadAngleDeg`, each dealing `perPelletDamage`
 * that attenuates with distance. The magazine holds `magazineCapacity`
 * rounds and a full reload takes `reloadDurationMs` milliseconds.
 */
export interface EnergyWeaponConfig {
  /** Stable weapon identifier. */
  id: EnergyWeaponId;
  /**
   * Number of pellets fired per trigger pull. A single-shot weapon would use
   * `1`; the shotgun fans `pelletCount` independent hitscan rays.
   */
  pelletCount: number;
  /**
   * Damage dealt by each individual pellet, in health points. Total potential
   * damage of a full shot is `pelletCount × perPelletDamage` (before range
   * falloff), assuming every pellet lands on the same target.
   */
  perPelletDamage: number;
  /**
   * Total angular width of the pellet spread, in **degrees**. The pellet rays
   * are fanned symmetrically across `[-spreadAngleDeg/2, +spreadAngleDeg/2]`
   * around the aim direction (see `computePelletSpreadAngles` in
   * `@buildshift/simulation`).
   */
  spreadAngleDeg: number;
  /**
   * Distance from the shooter, in metres, at which range falloff begins.
   * Pellets striking a target closer than this deal full
   * {@link perPelletDamage}.
   */
  rangeFalloffStart: number;
  /**
   * Distance from the shooter, in metres, at which range falloff is complete
   * and each pellet deals its minimum damage. Falloff linearly interpolates
   * between {@link rangeFalloffStart} (full damage) and
   * {@link rangeFalloffEnd} (minimum damage).
   */
  rangeFalloffEnd: number;
  /** Number of rounds held in the weapon's magazine. */
  magazineCapacity: number;
  /** Duration of a full reload, in milliseconds. */
  reloadDurationMs: number;
}

// ───────────────────────── Weapon roster ─────────────────────────

/**
 * The canonical Energy Box Fight shotgun.
 *
 * Balance: an 8-pellet spread at 12° of total cone, 12 damage per pellet
 * (≈ 96 maximum on a point-blank full hit), falloff from 5 m to 20 m, an 8
 * round magazine, and a 2.5 s reload.
 */
export const ENERGY_SHOTGUN: EnergyWeaponConfig = {
  id: "shotgun",
  pelletCount: 8,
  perPelletDamage: 12,
  spreadAngleDeg: 12,
  rangeFalloffStart: 5,
  rangeFalloffEnd: 20,
  magazineCapacity: 8,
  reloadDurationMs: 2500,
};

/**
 * The set of weapons available to players in the Energy Box Fight mode.
 *
 * Currently just the {@link ENERGY_SHOTGUN}. Additional weapons (e.g. an
 * assault rifle with `pelletCount: 1`) can be appended to {@link
 * ENERGY_WEAPONS} in later stages without changing the consumer contract
 * (consumers look a weapon up by {@link EnergyWeaponConfig.id}).
 */
export const ENERGY_WEAPONS: readonly EnergyWeaponConfig[] = [ENERGY_SHOTGUN];

/**
 * Look up an Energy Box Fight weapon definition by its stable id.
 *
 * Returns `undefined` for unknown ids so callers can validate player intent
 * (e.g. the authoritative server rejecting a weapon switch to an unknown
 * weapon), mirroring the `getWeaponById` contract.
 */
export function getEnergyWeaponById(id: string): EnergyWeaponConfig | undefined {
  return ENERGY_WEAPONS.find((w) => w.id === id);
}
