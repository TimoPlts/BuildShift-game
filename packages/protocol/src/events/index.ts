/**
 * Shared network event identifiers and combat message payloads.
 *
 * This is the single source of truth for the event *names* the client and
 * server reference, so neither side independently invents magic strings.
 *
 * The events split into two groups:
 *  - the movement-input event carried over from the Stage 2 foundation
 *    (`PLAYER_INPUT`);
 *  - the combat events introduced by the server-authoritative hitscan
 *    contract (`HIT`, `ELIMINATED`, `HEALTH_UPDATE`).
 *
 * Authoritative *state* (positions, health, shield, ammo, eliminated) is
 * delivered by Colyseus' built-in Schema synchronisation, not by a bespoke
 * event — so there is no generic "state" event to define here. The combat
 * events below are the fire-and-forget notifications the server broadcasts
 * *in addition* to the state patch.
 */
import type { WeaponId } from "../weapons.js";

/**
 * Canonical network event identifiers.
 *
 * Values follow the `namespace:action` convention used by `PLAYER_INPUT`.
 */
export const EVENTS = {
  /**
   * Client → server: a single per-tick player input frame (movement + aim +
   * fire intent) for the player's current simulation tick.
   */
  PLAYER_INPUT: "player:input",
  /**
   * Server → all: a confirmed hitscan hit was applied. The canonical payload
   * is a {@link HitResultEvent}. Fired after the server has authoritatively
   * validated the shot and applied damage to the target.
   */
  HIT: "combat:hit",
  /**
   * Server → all: a player was eliminated (health reached 0). The eliminated
   * player's authoritative state (`isEliminated = true`) is also patched; this
   * event is a lightweight notification for UI / sound effects. The canonical
   * payload is a {@link PlayerEliminatedEvent}.
   */
  ELIMINATED: "combat:eliminated",
  /**
   * Server → owner: the player's health/shield changed. Lets the owning
   * client update its HUD without relying solely on state-diff latency.
   */
  HEALTH_UPDATE: "combat:health",
} as const;

/** A valid network event identifier. */
export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/**
 * A world-space point in metres (Y-up) — e.g. the exact point on a target
 * where a hitscan projectile landed.
 */
export interface HitPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Canonical payload for the {@link EVENTS.HIT} event.
 *
 * Identifies the shooter and target, the damage dealt, the world-space
 * {@link HitPoint} where the shot landed, and the {@link WeaponId} that fired
 * the shot. This is the single authoritative shape the server and every
 * client agree on for a confirmed hitscan hit.
 */
export interface HitResultEvent {
  /** Colyseus `sessionId` of the player who fired the shot. */
  shooterId: string;
  /** Colyseus `sessionId` of the player who was hit. */
  targetId: string;
  /** Damage applied by this hit, in health points. */
  damage: number;
  /** World-space point (metres, Y-up) where the shot landed on the target. */
  hitPoint: HitPoint;
  /** The weapon that fired the shot. */
  weaponId: WeaponId;
}

/**
 * Canonical payload for the {@link EVENTS.ELIMINATED} event.
 *
 * Identifies the eliminated player and the player who delivered the
 * eliminating hit (the killer). Used for kill-feed / UI presentation.
 */
export interface PlayerEliminatedEvent {
  /** Colyseus `sessionId` of the eliminated player. */
  eliminatedId: string;
  /** Colyseus `sessionId` of the player who eliminated them. */
  eliminatedById: string;
}

/**
 * Legacy payload for the {@link EVENTS.HIT} event (and reused by
 * {@link EVENTS.HEALTH_UPDATE}) from the first combat milestone.
 *
 * @deprecated Prefer {@link HitResultEvent} for the canonical hitscan
 * contract. This shape is retained so the legacy combat room keeps compiling
 * during the Stage 2D consolidation; it is superseded by {@link HitResultEvent}.
 */
export interface HitEventPayload {
  /** Colyseus `sessionId` of the player who fired the shot. */
  shooterId: string;
  /** Colyseus `sessionId` of the player who was hit. */
  targetId: string;
  /** Damage applied by this hit, in health points. */
  damage: number;
  /** The target's health remaining after this hit (>= 0). */
  remainingHealth: number;
}
