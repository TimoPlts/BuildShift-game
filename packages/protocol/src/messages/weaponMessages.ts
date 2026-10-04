/**
 * Weapon action messages for the 1v1 Energy Box Fight mode (client → server).
 *
 * These are one-shot client → server *messages* sent via Colyseus
 * `client.send()` (the server is the sole authority on weapon state). They are
 * deliberately plain TypeScript interfaces (Colyseus send payloads are JSON)
 * and NOT `@colyseus/schema` `Schema` classes — they are not stored in room
 * state, so they need no Schema field tracking.
 *
 * Authoritative weapon *state* (the active `currentWeapon` and the per-weapon
 * `weapons` record) is delivered by Colyseus' built-in Schema synchronisation
 * (see `PlayerStateSchema` / `AuthoritativePlayerState`); these messages are
 * the player *intents* that drive that state.
 */
import type { WeaponId } from "../weapons.js";

/**
 * Client → server: the player wants to switch their active weapon.
 *
 * Carries the {@link WeaponId} the player is switching to. The authoritative
 * server validates the target (is it a weapon this player actually carries?)
 * and, on success, updates the player's `currentWeapon` so it syncs to all
 * clients.
 */
export interface WeaponSwitch {
  /** The weapon the player is switching to. */
  targetWeaponId: WeaponId;
}

/**
 * Client → server: the player wants to start reloading their current weapon.
 *
 * A reload request for the *current* weapon — the active weapon id is implied
 * by the player's `currentWeapon` state, so no weapon id is carried. The
 * authoritative server validates the request (does the magazine have room, is
 * reserve ammo available, is a reload already in progress?) and, on success,
 * begins the reload (setting `isReloading` and advancing `reloadProgress` on
 * the weapon's entry in the player's `weapons` record).
 */
export interface StartReload {
  /**
   * Optional id of the weapon to reload. When omitted the player's current
   * weapon is reloaded. Carried for forward-compat so an explicit target can
   * be supported without changing the message shape.
   */
  weaponId?: WeaponId;
}
