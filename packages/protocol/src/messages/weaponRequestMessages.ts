/**
 * 1v1 Energy Box Fight weapon-switch / reload request messages and the
 * server-to-client weapon-state payload.
 *
 * This module is an *additive* contract. It complements — and does not
 * modify — the existing {@link WeaponSwitch} / {@link StartReload} client
 * intents in `weaponMessages.ts` (those remain exported unchanged for
 * backward compatibility). These new *request* messages carry an explicit
 * `playerId` (and, for the reload, a `weaponId`) because they are the
 * server-authoritative, player-addressed intents used by the authoritative
 * weapon-switch / reload slice.
 *
 * Like the existing weapon messages, these are plain TypeScript interfaces
 * (Colyseus send payloads are JSON) and NOT `@colyseus/schema` `Schema`
 * classes — they are one-shot intents, not room-state, so no Schema field
 * tracking is required. {@link WeaponState} is the server → client payload
 * that reports the authoritative per-weapon ammo + reload state.
 */
import type { WeaponId } from "../weapons.js";

/**
 * Client → server: the player wants to switch their active weapon.
 *
 * Carries the {@link WeaponId} the player is switching to and the `playerId`
 * of the player issuing the request. The authoritative server validates the
 * target (is it a weapon this player actually carries?) and, on success,
 * updates the player's active weapon so it syncs to all clients.
 */
export interface WeaponSwitchRequest {
  /** The player issuing the weapon-switch request. */
  playerId: string;
  /** The weapon the player is switching to. */
  weaponId: WeaponId;
}

/**
 * Client → server: the player wants to start reloading a weapon.
 *
 * Carries the `playerId` and the explicit {@link WeaponId} to reload. The
 * authoritative server validates the request (does the magazine have room, is
 * reserve ammo available, is a reload already in progress?) and, on success,
 * begins the reload.
 */
export interface ReloadRequest {
  /** The player issuing the reload request. */
  playerId: string;
  /** The weapon to reload. */
  weaponId: WeaponId;
}

/**
 * Server → client: the authoritative ammo + reload state of a single weapon.
 *
 * Broadcast (or sent to the requesting client) so the client can render the
 * correct ammo counter and any reload animation. This is the server-to-client
 * *payload* counterpart to the {@link WeaponSwitchRequest} /
 * {@link ReloadRequest} intents; the *resulting* per-weapon state is also
 * carried authoritatively by Colyseus state synchronisation, and this payload
 * is a convenience snapshot so a client need not wait on the state patch.
 */
export interface WeaponState {
  /** The weapon this state describes. */
  weaponId: WeaponId;
  /** Rounds currently loaded in the weapon's magazine. */
  ammoInMag: number;
  /** Rounds available to reload the magazine. */
  ammoReserve: number;
  /** `true` while this weapon is in the middle of a reload. */
  reloading: boolean;
  /**
   * Remaining reload time, in **milliseconds**. `0` when not reloading (or
   * the reload has completed). Meaningful only while {@link reloading} is
   * `true`.
   */
  reloadRemainingMs: number;
}
