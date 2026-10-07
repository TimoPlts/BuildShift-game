/**
 * 1v1 Energy Box Fight: weapon balance and build-edit configuration.
 *
 * This module is an *additive* configuration for the 1v1 Energy Box Fight
 * mode. It defines the authoritative weapon balance values (damage, fire
 * rate, magazine size, reload time) and the build-edit → structure-type
 * mapping. The existing `WEAPONS` / `WeaponConfig` in `weapons.ts` and the
 * Energy Fight weapon definitions in `shotgunWeapon.ts` are left untouched.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §7.5 these balance values live in this
 * package so the authoritative server and the client reference the exact
 * same numbers. The type vocabularies are declared locally (structurally
 * aligned with `@buildshift/protocol`) so this package stays self-contained.
 */

// ─── Weapon type vocabulary (structurally aligned with protocol) ─────────────

/**
 * A weapon type identifier for the 1v1 Energy Box Fight mode.
 *
 * Structurally identical to `@buildshift/protocol`'s `WeaponType`
 * (`"assault_rifle" | "shotgun"`); declared locally so this package does
 * not import the protocol package.
 */
export type WeaponType = "assault_rifle" | "shotgun";

// ─── Build-edit type vocabulary (structurally aligned with protocol) ───────

/**
 * A build-edit type: the kind of opening or modification applied to a
 * structure.
 *
 * Structurally identical to `@buildshift/protocol`'s `BuildEditType`
 * (`"door" | "window" | "half_top" | "half_bottom"`); declared locally so
 * this package stays self-contained.
 */
export type BuildEditType = "door" | "window" | "half_top" | "half_bottom";

// ─── Weapon config shape ───────────────────────────────────────────────────

/**
 * Base fields shared by every weapon in the 1v1 Energy Box Fight mode.
 */
export interface EnergyBoxFightWeaponBase {
  /** Damage dealt per shot (or per pellet for shotgun). */
  damage: number;
  /** Shots (or trigger pulls) per second. */
  fireRate: number;
  /** Number of rounds held in the magazine. */
  magazineSize: number;
  /** Duration of a full reload, in seconds. */
  reloadTimeSec: number;
}

/**
 * The shotgun weapon configuration.
 *
 * Extends the base with pellet-specific fields.
 */
export interface ShotgunWeaponConfig extends EnergyBoxFightWeaponBase {
  /** Number of pellets fired per trigger pull. */
  pelletCount: number;
  /** Total angular width of the pellet spread, in degrees. */
  spreadDeg: number;
}

/**
 * The assault rifle weapon configuration.
 */
export interface AssaultRifleWeaponConfig extends EnergyBoxFightWeaponBase {
  // No additional fields beyond the base.
}

/**
 * Discriminated union of all Energy Box Fight weapon configs.
 */
export type EnergyBoxFightWeaponConfig =
  | ShotgunWeaponConfig
  | AssaultRifleWeaponConfig;

// ─── Weapons record ────────────────────────────────────────────────────────

/**
 * The authoritative weapon balance values for the 1v1 Energy Box Fight mode,
 * keyed by {@link WeaponType}.
 *
 * - `assault_rifle`: 22 damage, 8 shots/sec, 30-round mag, 2.2 s reload.
 * - `shotgun`: 14 damage per pellet, 1.5 trigger pulls/sec, 6-round mag,
 *   2.8 s reload, 8 pellets, 12° spread.
 */
export const weapons: Readonly<
  Record<WeaponType, EnergyBoxFightWeaponConfig>
> = {
  assault_rifle: {
    damage: 22,
    fireRate: 8,
    magazineSize: 30,
    reloadTimeSec: 2.2,
  },
  shotgun: {
    damage: 14,
    fireRate: 1.5,
    magazineSize: 6,
    reloadTimeSec: 2.8,
    pelletCount: 8,
    spreadDeg: 12,
  },
} as const;

/**
 * Look up an Energy Box Fight weapon config by type.
 *
 * Returns `undefined` for unknown types so callers can validate input.
 */
export function getWeaponConfig(
  weaponType: string,
): EnergyBoxFightWeaponConfig | undefined {
  return (weapons as Record<string, EnergyBoxFightWeaponConfig | undefined>)[
    weaponType
  ];
}

// ─── Build edits record ────────────────────────────────────────────────────

/**
 * Mapping from each {@link BuildEditType} to the structure types it is
 * allowed to be applied to.
 *
 * - `door`: walls
 * - `window`: walls
 * - `half_top`: walls, roofs
 * - `half_bottom`: walls, floors
 */
export const buildEdits: Readonly<Record<BuildEditType, readonly string[]>> =
  {
    door: ["wall"],
    window: ["wall"],
    half_top: ["wall", "roof"],
    half_bottom: ["wall", "floor"],
  } as const;

/**
 * Check whether a given build-edit type is allowed on a structure of the
 * given type.
 */
export function isBuildEditAllowedForStructure(
  editType: BuildEditType,
  structureType: string,
): boolean {
  const allowed = buildEdits[editType];
  return allowed.includes(structureType);
}
