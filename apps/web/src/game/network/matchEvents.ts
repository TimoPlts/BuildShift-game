/**
 * matchEvents — client-side mirror of the authoritative match-lifecycle
 * broadcast event names used by the game server
 * (`apps/game-server/src/match/matchLifecycle.ts`).
 *
 * The server pushes transient lifecycle data (countdown ticks, round-over,
 * round-reset, match-end) over named Colyseus broadcasts. The client
 * subscribes to these by the same string identifiers.
 *
 * These constants are kept here (rather than imported from the server
 * package) so the client build stays independent of the server; they MUST
 * stay in sync with the server's `MATCH_EVENTS` values.
 */

/**
 * Broadcast each server tick during the `COUNTDOWN` phase with the remaining
 * countdown value (in ticks). The client uses this to drive the
 * `CountdownOverlay` with an authoritative, server-synced remaining-second
 * value instead of a purely local timer.
 */
export const MATCH_COUNTDOWN_TICK_EVENT = "match:countdown_tick";

/** Payload for {@link MATCH_COUNTDOWN_TICK_EVENT}. */
export interface CountdownTickPayload {
  /** Remaining countdown in server ticks (30 Hz). */
  countdownTicks: number;
  /** Total countdown duration in server ticks (used for progress mapping). */
  totalTicks: number;
}
