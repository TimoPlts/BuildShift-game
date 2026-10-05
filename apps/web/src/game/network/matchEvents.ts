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

/**
 * Broadcast when a round ends (elimination, timeout, anti-stall, or
 * disconnect). The client uses this to display the round-over banner and
 * track the authoritative round result.
 */
export const MATCH_ROUND_OVER_EVENT = "match:round_over";

/** Payload for {@link MATCH_ROUND_OVER_EVENT}. */
export interface RoundOverPayload {
  /** sessionId of the player who won the round. */
  winnerId: string;
  /** sessionId of the player who lost the round. */
  loserId: string;
  /** Winner's cumulative round-win score after this round. */
  winnerScore: number;
  /** Loser's cumulative round-win score after this round. */
  loserScore: number;
  /** The 1-based round number that just ended. */
  roundNumber: number;
  /** The authoritative reason the round ended. */
  reason?: string;
}

/**
 * Broadcast each tick during the `IN_PROGRESS` phase with the authoritative
 * round timer state. The client uses this to render a deterministic countdown
 * display that is always in sync with the server clock.
 */
export const MATCH_ROUND_TIMER_EVENT = "match:round_timer";

/** Payload for {@link MATCH_ROUND_TIMER_EVENT}. */
export interface RoundTimerPayload {
  /** Remaining round time in milliseconds (>= 0). */
  remainingMs: number;
  /** Total round duration in milliseconds. */
  totalMs: number;
}

/**
 * Broadcast once when the match transitions to `MATCH_ENDED` (a player
 * reached the win threshold). The client uses this to display the final
 * result and enable the rematch button.
 */
export const MATCH_END_EVENT = "match:end";

/** Payload for {@link MATCH_END_EVENT}. */
export interface MatchEndPayload {
  /** sessionId of the player who won the match. */
  winnerId: string;
  /** Final round-win scores keyed by sessionId. */
  scores: Record<string, number>;
  /** The reason that ended the final (deciding) round. */
  reason?: string;
}

/**
 * Client → server message type for requesting a rematch. Must match the
 * server's `REMATCH_REQUEST` constant.
 */
export const REMATCH_REQUEST_MESSAGE = "match:rematch_request";

/**
 * Broadcast when both players have accepted a rematch and a new match has
 * started (fresh countdown, scores reset to zero).
 */
export const REMATCH_ACCEPTED_EVENT = "match:rematch_accepted";

/** Payload for {@link REMATCH_ACCEPTED_EVENT}. */
export interface RematchAcceptedPayload {
  /** sessionId of the player who won the previous match. */
  previousWinnerId: string;
  /** The 1-based round number of the new match (always 1). */
  newRoundNumber: number;
}

/**
 * Broadcast when a rematch request is rejected (outside the acceptance
 * window or match not in the correct state).
 */
export const REMATCH_DECLINED_EVENT = "match:rematch_declined";
