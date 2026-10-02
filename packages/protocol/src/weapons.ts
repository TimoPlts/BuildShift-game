/**
 * Weapon identifiers shared by the client and server for the canonical
 * hitscan combat contract.
 *
 * These are the stable string ids a combat event or input references when a
 * player selects or fires a weapon. The balance *values* for each id (damage,
 * fire cadence in ticks, ammo, reload) live in `@buildshift/game-config`
 * (`WEAPONS` / `WeaponConfig`); this package owns only the shared identifier
 * vocabulary so client and server can never drift on the string ids.
 */

/** A valid weapon identifier. */
export type WeaponId = "shotgun" | "assault_rifle";

/**
 * All valid weapon identifiers as a frozen tuple, for runtime membership
 * checks and for enumerating the weapon roster.
 */
export const WEAPON_IDS = Object.freeze(["shotgun", "assault_rifle"] as const);

/**
 * Runtime type guard: `true` when `value` is one of the valid
 * {@link WeaponId} identifiers.
 */
export function isWeaponId(value: unknown): value is WeaponId {
  return (
    typeof value === "string" &&
    (WEAPON_IDS as readonly string[]).includes(value)
  );
}
