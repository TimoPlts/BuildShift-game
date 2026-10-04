/**
 * 1v1 Energy Box Fight: weapon + build-edit protocol types.
 *
 * This module defines the authoritative weapon switching, reloading, firing,
 * and build-editing contract for the 1v1 Energy Box Fight mode. All types are
 * plain TypeScript interfaces (Colyseus send payloads are JSON) and NOT
 * `@colyseus/schema` `Schema` classes.
 *
 * These types are *additive*: they do not modify any existing protocol types.
 */

// ─── Weapon vocabulary ───────────────────────────────────────────────────────

/**
 * A weapon type identifier for the 1v1 Energy Box Fight mode.
 *
 * This is the shared vocabulary between client and server for the
 * authoritative weapon system.
 */
export type WeaponType = "assault_rifle" | "shotgun";

/** All valid weapon types as a frozen tuple for runtime checks. */
export const WEAPON_TYPES = Object.freeze([
  "assault_rifle",
  "shotgun",
] as const);

/** Type guard: `value` is a valid {@link WeaponType}. */
export function isWeaponType(value: unknown): value is WeaponType {
  return (
    typeof value === "string" &&
    (WEAPON_TYPES as readonly string[]).includes(value)
  );
}

// ─── Weapon state ────────────────────────────────────────────────────────────

/**
 * Authoritative weapon state (server → client).
 *
 * Describes the current ammo, reload, and type of a player's weapon slot.
 * The server is the sole authority on this state; the client renders from it.
 */
export interface WeaponState {
  /** The type of weapon in this slot. */
  weaponType: WeaponType;
  /** Rounds currently loaded in the magazine. */
  currentAmmo: number;
  /** Maximum rounds the magazine holds. */
  maxAmmo: number;
  /** Whether the weapon is currently in the middle of a reload. */
  isReloading: boolean;
  /**
   * Reload progress from 0 (reload just started) to 1 (reload complete).
   * Meaningful only while {@link isReloading} is `true`.
   */
  reloadProgress: number;
}

// ─── Client → server messages ──────────────────────────────────────────────

/**
 * Client → server: request to switch the player's active weapon.
 */
export interface SwitchWeaponRequest {
  /** The weapon type the player wants to switch to. */
  targetWeapon: WeaponType;
}

/**
 * Client → server: request to reload a specific weapon.
 */
export interface ReloadRequest {
  /** The weapon type to reload. */
  weaponType: WeaponType;
}

/**
 * A 3D direction vector (unit or non-unit) for aim.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Client → server: request to fire a weapon in a given aim direction.
 */
export interface FireRequest {
  /** The weapon type to fire. */
  weaponType: WeaponType;
  /** The aim direction as a 3D vector. */
  aimDirection: Vec3;
}

// ─── Server → client messages ──────────────────────────────────────────────

/**
 * Server → client: an update to a player's weapon state.
 *
 * Broadcast so all clients stay in sync with the authoritative weapon state.
 */
export interface WeaponStateUpdate {
  /** The player whose weapon state changed. */
  playerId: string;
  /** The new authoritative weapon state. */
  weaponState: WeaponState;
}

/**
 * A single hit produced by a fired weapon.
 */
export interface FireHit {
  /** The id of the target that was hit (player or structure). */
  targetId: string;
  /** Damage dealt to the target. */
  damage: number;
  /** Whether the target was a structure (as opposed to a player). */
  isStructure: boolean;
}

/**
 * Server → client: the result of a fire request.
 *
 * Contains the list of hits produced by the shot. For a shotgun, this may
 * contain multiple hits (one per pellet that connected).
 */
export interface FireResult {
  /** The hits produced by this shot (empty if nothing was hit). */
  hits: FireHit[];
}

// ─── Build editing ─────────────────────────────────────────────────────────

/**
 * A build-edit type: the kind of opening or modification applied to a
 * structure.
 */
export type BuildEditType = "door" | "window" | "half_top" | "half_bottom";

/** All valid build-edit types as a frozen tuple for runtime checks. */
export const BUILD_EDIT_TYPES = Object.freeze([
  "door",
  "window",
  "half_top",
  "half_bottom",
] as const);

/** Type guard: `value` is a valid {@link BuildEditType}. */
export function isBuildEditType(value: unknown): value is BuildEditType {
  return (
    typeof value === "string" &&
    (BUILD_EDIT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Client → server: a build-edit command targeting a specific structure.
 */
export interface BuildEditCommand {
  /** The stable id of the structure to edit. */
  structureId: string;
  /** The type of edit to apply. */
  editType: BuildEditType;
}

/**
 * Server → client: the result of a build-edit command.
 */
export interface BuildEditResult {
  /** Whether the server applied the edit successfully. */
  success: boolean;
  /** A human-readable reason when the edit was rejected. */
  reason?: string;
  /** The structure that was the target of the edit. */
  structureId: string;
}
