/**
 * Canonical Energy Box Fight room protocol — weapon switch / fire / reload and
 * build-edit messages.
 *
 * This module is the *canonical* wire contract for the authoritative Energy
 * Box Fight room and its real `NetworkClient` path. It is a **new, additive**
 * contract: it does not modify the earlier additive slices
 * (`weaponMessages.ts`, `weaponRequestMessages.ts`, `energyBoxFightMessages.ts`,
 * `buildEditMessages.ts`), which stay exported unchanged for backward
 * compatibility.
 *
 * All types are plain TypeScript interfaces — Colyseus `client.send` payloads
 * are JSON, so these one-shot messages are *not* `@colyseus/schema` `Schema`
 * classes (they are not stored in room state; the authoritative weapon state is
 * delivered separately via {@link WeaponStateUpdate} and schema sync).
 *
 * The canonical messages:
 *  - {@link WeaponSwitchRequest} — client → server, switch the active weapon;
 *  - {@link FireWeaponRequest}   — client → server, fire in an aim direction;
 *  - {@link ReloadRequest}       — client → server, reload the active weapon;
 *  - {@link BuildEditRequest}    — client → server, edit a placed structure;
 *  - {@link WeaponStateUpdate}   — server → client, authoritative weapon state.
 */
import type { WeaponId } from "../weapons.js";
import type { BuildEditType } from "./energyBoxFightMessages.js";

/**
 * A 3D vector (metres, Y-up), used for aim directions and grid offsets.
 *
 * Declared locally (type-only) so this module does not depend on the
 * simulation package; it is structurally identical to the shared combat
 * `Vec3`.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ─────────────────────── Client → server messages ───────────────────────

/**
 * Client → server: the player wants to switch their active weapon.
 *
 * Carries the {@link WeaponId} the player is switching to. The authoritative
 * server validates the target (is it a weapon this player actually carries?)
 * and, on success, updates the player's active weapon and broadcasts a
 * {@link WeaponStateUpdate} so all clients stay in sync.
 */
export interface WeaponSwitchRequest {
  /** The weapon the player is switching to. */
  weaponId: WeaponId;
}

/**
 * Client → server: the player wants to fire their active weapon.
 *
 * Carries the aim {@link direction} (a 3D vector, unit or non-unit). The active
 * weapon id is implied by the player's authoritative weapon state, so it is not
 * carried here. The authoritative server runs the fire gate (cadence, ammo,
 * not-reloading) and, on approval, resolves the shot (a single ray for the
 * assault rifle; `pellets` spread rays for the shotgun) against live targets
 * and reports the result.
 */
export interface FireWeaponRequest {
  /** The aim direction as a 3D vector. */
  direction: Vec3;
}

/**
 * Client → server: the player wants to reload their active weapon.
 *
 * The active weapon id is implied by the player's authoritative weapon state,
 * so no weapon id is carried. The authoritative server validates the request
 * (does the magazine have room, is the weapon not already reloading?) and, on
 * success, begins the reload — setting `isReloading` and scheduling
 * `reloadEndTime` on the player's weapon state, then broadcasting a
 * {@link WeaponStateUpdate}.
 */
export interface ReloadRequest {}

/**
 * Client → server: the player wants to edit a placed structure.
 *
 * Carries the stable `structureId` to edit, the {@link BuildEditType} to apply
 * (`door` / `window` / `half_top` / `half_bottom`), and a `gridOffset` — the
 * grid-cell offset (a 3D integer/coordinate vector) locating the cell the edit
 * applies to within the structure. The authoritative server validates the
 * request (structure exists, player owns it, edit type is legal for that
 * structure, cell is in bounds) and, on success, updates the structure's state
 * and broadcasts the result.
 */
export interface BuildEditRequest {
  /** The stable id of the structure to edit (assigned by the server). */
  structureId: string;
  /** The type of opening/edit to apply. */
  editType: BuildEditType;
  /** The grid-cell offset locating the targeted cell within the structure. */
  gridOffset: Vec3;
}

// ─────────────────────── Server → client messages ───────────────────────

/**
 * Server → client: the authoritative state of a player's *active* weapon.
 *
 * Broadcast (or sent to the requesting client) so every client renders the
 * correct active weapon, ammo counter, and reload state. `reloadEndTime` is an
 * absolute timestamp (same time base as the client's `performance.now()`-style
 * clock used by the simulation's `isReloadComplete`) at which the in-progress
 * reload completes — clients compute remaining time as `reloadEndTime - now`.
 */
export interface WeaponStateUpdate {
  /** The stable id of the player's currently active weapon. */
  currentWeaponId: string;
  /** Rounds currently loaded in the active weapon's magazine. */
  ammo: number;
  /** Maximum rounds the active weapon's magazine holds. */
  maxAmmo: number;
  /** `true` while the active weapon is in the middle of a reload. */
  isReloading: boolean;
  /**
   * Absolute timestamp at which the in-progress reload completes. Meaningful
   * only while {@link isReloading} is `true`; `0` when not reloading.
   */
  reloadEndTime: number;
}
