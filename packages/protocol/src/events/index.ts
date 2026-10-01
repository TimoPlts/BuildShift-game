/**
 * Shared network event identifiers and combat message payloads.
 *
 * This is the single source of truth for the event *names* the client and
 * server reference, so neither side independently invents magic strings.
 *
 * The events split into two groups:
 *  - the movement-input event carried over from the Stage 2 foundation
 *    (`PLAYER_INPUT`);
 *  - the combat events introduced by the first server-authoritative hitscan
 *    milestone (`HIT`, `ELIMINATED`, `HEALTH_UPDATE`).
 *
 * Authoritative *state* (positions, health, alive) is delivered by Colyseus'
 * built-in Schema synchronisation, not by a bespoke event — so there is no
 * generic "state" event to define here. The combat events below are the
 * fire-and-forget notifications the server broadcasts *in addition* to the
 * state patch.
 */

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
   * Server → all: a confirmed hitscan hit was applied. Payload is a
   * {@link HitEventPayload}. Fired after the server has authoritatively
   * validated the shot and applied damage to the target.
   */
  HIT: "combat:hit",
  /**
   * Server → all: a player was eliminated (health reached 0). The eliminated
   * player's authoritative state (`alive = false`) is also patched; this event
   * is a lightweight notification for UI / sound effects.
   */
  ELIMINATED: "combat:eliminated",
  /**
   * Server → owner: the player's health changed. Lets the owning client update
   * its health display without relying solely on state-diff latency. Payload is
   * a {@link HitEventPayload} (or a bare `{ remainingHealth }` shape).
   */
  HEALTH_UPDATE: "combat:health",
} as const;

/** A valid network event identifier. */
export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/**
 * Payload for the {@link EVENTS.HIT} event (and reused by
 * {@link EVENTS.HEALTH_UPDATE}).
 *
 * Identifies the shooter and target, the damage dealt, and the target's
 * remaining health after the hit so clients can update UI without a full state
 * read.
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
