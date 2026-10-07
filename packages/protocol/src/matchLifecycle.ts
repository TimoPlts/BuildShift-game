/**
 * Timed-match and rematch lifecycle protocol contracts.
 *
 * Defines the shared typed constants and message shapes needed for:
 *
 *  - **Authoritative round timers** — the `RoundTimerState` payload the
 *    server broadcasts each tick so clients can render a deterministic
 *    countdown without relying on local wall-clock drift.
 *  - **Deterministic anti-stall timeout resolution** — the `RoundEndReason`
 *    vocabulary and `AntiStallState` shape so the server and clients agree
 *    on the exact conditions under which an inactive player causes the
 *    round to end, and who wins.
 *  - **Match results** — the `RoundEndResult` and `MatchEndResult`
 *    payloads carrying the authoritative outcome of each round and the
 *    final match.
 *  - **Rematch requests** — the `RematchRequest` client→server message
 *    and the `REMATCH_ACCEPTED` server→all event that confirm a new match
 *    is starting.
 *
 * Both the authoritative server (`apps/game-server`) and the client
 * (`apps/web`) import these types so they agree on the exact wire shapes
 * and event identifiers.
 *
 * This module is purely additive; it does not modify the existing
 * `MatchPhase`, `RoundState`, `RoundResult`, or `MatchState` contracts.
 * It complements them by adding the timer, anti-stall, and rematch
 * dimensions.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Round end reason
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The set of authoritative reasons a round can end.
 *
 * The server determines which reason applies and includes it in every
 * {@link RoundEndResult}. Clients use it to present the correct HUD
 * message (e.g. "Time's Up!" vs "Stall Timeout" vs "Eliminated").
 */
export type RoundEndReason =
  /** A player's health reached zero (killed by the opponent). */
  | "elimination"
  /** The round timer reached zero; the player with higher health wins. */
  | "time_expired"
  /** The anti-stall timeout expired; the inactive player lost the round. */
  | "anti_stall_timeout"
  /** A player disconnected; the remaining player wins the round. */
  | "disconnect";

/**
 * Tuple of all valid {@link RoundEndReason} values.
 *
 * Useful for runtime validation and iteration:
 * `ROUNDEND_REASONS.includes(payload.reason)`.
 */
export const ROUND_END_REASONS = [
  "elimination",
  "time_expired",
  "anti_stall_timeout",
  "disconnect",
] as const;

/**
 * Type guard: checks whether a value is a valid {@link RoundEndReason}.
 */
export function isRoundEndReason(value: unknown): value is RoundEndReason {
  return (
    typeof value === "string" &&
    (ROUND_END_REASONS as readonly string[]).includes(value)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Authoritative round timer state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authoritative round timer state carried on the room state or broadcast
 * via {@link MATCH_LIFECYCLE_EVENTS.ROUND_TIMER_UPDATE}.
 *
 * The server updates this value every simulation tick during the `PLAYING`
 * phase. Clients use it to render a deterministic countdown display that
 * is always in sync with the authoritative server clock, eliminating the
 * client-side drift that a local `setTimeout` would introduce.
 */
export interface RoundTimerState {
  /**
   * Remaining round time in milliseconds (>= 0).
   *
   * When this reaches `0`, the server ends the round with
   * `RoundEndReason = "time_expired"`.
   */
  remainingMs: number;
  /**
   * Total round duration in milliseconds.
   *
   * Set once at round start from `ROUND_DURATION_SECONDS * 1000`.
   * Clients use `remainingMs / totalMs` for a progress bar.
   */
  totalMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Anti-stall state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-player anti-stall inactivity tracking state.
 *
 * The server maintains one entry per player during the `PLAYING` phase.
 * Every tick, the server increments `inactiveMs` by the tick duration if
 * the player produced no meaningful input (movement, build, or fire).
 * When the player produces any meaningful input, `inactiveMs` resets to 0.
 *
 * When `inactiveMs >= ANTI_STALL_TIMEOUT_SECONDS * 1000`, the server
 * ends the round with `RoundEndReason = "anti_stall_timeout"` and awards
 * the round to the other player.
 */
export interface AntiStallState {
  /** Colyseus `sessionId` of the tracked player. */
  playerId: string;
  /**
   * Continuous inactivity duration in milliseconds.
   *
   * Resets to 0 when the player produces any meaningful input.
   * Compared against `ANTI_STALL_TIMEOUT_SECONDS * 1000` each tick.
   */
  inactiveMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Round end result
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authoritative result of a single completed round.
 *
 * Carried in the {@link MATCH_LIFECYCLE_EVENTS.ROUND_END} broadcast and
 * available for HUD display (round banner, kill feed, score update).
 */
export interface RoundEndResult {
  /** 1-based round number that just ended. */
  roundNumber: number;
  /**
   * Colyseus `sessionId` of the player who won the round.
   *
   * For `"time_expired"` with equal health, this is the
   * deterministic tie-break winner (e.g. lower `sessionId` for stability).
   */
  winnerId: string;
  /** Colyseus `sessionId` of the player who lost the round. */
  loserId: string;
  /** The authoritative reason the round ended. */
  reason: RoundEndReason;
}

// ─────────────────────────────────────────────────────────────────────────────
// Match end result
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authoritative final result of a completed match.
 *
 * Carried in the {@link MATCH_LIFECYCLE_EVENTS.MATCH_END} broadcast.
 * Clients use this to render the post-match screen (winner display,
 * final score, rematch button).
 */
export interface MatchEndResult {
  /** Colyseus `sessionId` of the player who won the match. */
  winnerId: string;
  /**
   * Final round-win scores for all players, keyed by `sessionId`.
   *
   * Example: `{ "session-a": 3, "session-b": 1 }`.
   */
  finalScores: Record<string, number>;
  /** Total number of rounds played in this match. */
  totalRounds: number;
  /** The reason that ended the final (deciding) round. */
  finalRoundReason: RoundEndReason;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rematch request
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Client → server message requesting a rematch.
 *
 * Sent by a player after the match has ended (`MATCH_OVER`). The server
 * only accepts it if:
 *  1. The match has actually ended (state is `MATCH_OVER`).
 *  2. The request is within the `REMATCH_WINDOW_SECONDS` window.
 *  3. The requesting player is still connected.
 *
 * The server may require both players to request (mutual consent) or
 * may accept from either player — this is a server-side policy decision.
 * The protocol only defines the message shape.
 */
export interface RematchRequest {
  /** Colyseus `sessionId` of the player requesting the rematch. */
  requesterId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Match lifecycle event identifiers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical event identifiers for the timed-match and rematch lifecycle.
 *
 * These complement the existing server-internal `MATCH_EVENTS`
 * (defined in `apps/game-server/src/match/matchLifecycle.ts`) by adding
 * the timer-update, round-end-with-reason, match-end-with-result, and
 * rematch event names to the shared protocol.
 *
 * Values follow the `namespace:action` convention.
 */
export const MATCH_LIFECYCLE_EVENTS = {
  /**
   * Server → all: authoritative round timer state.
   *
   * Broadcast every simulation tick during the `PLAYING` phase.
   * Payload: {@link RoundTimerState}.
   */
  ROUND_TIMER_UPDATE: "match:round_timer_update",
  /**
   * Server → all: a round has ended.
   *
   * Broadcast once when a round transitions from `PLAYING` to `ROUND_OVER`.
   * Payload: {@link RoundEndResult}.
   */
  ROUND_END: "match:round_end",
  /**
   * Server → all: the match has ended.
   *
   * Broadcast once when the match transitions from `ROUND_OVER` to
   * `MATCH_OVER` (i.e. a player reached the win threshold).
   * Payload: {@link MatchEndResult}.
   */
  MATCH_END: "match:match_end",
  /**
   * Client → server: a player requests a rematch.
   *
   * Sent by a player in the `MATCH_OVER` state.
   * Payload: {@link RematchRequest}.
   */
  REMATCH_REQUEST: "match:rematch_request",
  /**
   * Server → all: a rematch has been accepted and a new match is starting.
   *
   * Broadcast when the server accepts a rematch and transitions back to
   * `COUNTDOWN` for round 1 of the new match.
   * Payload: `{ winnerId: string }` (the previous match's winner, for
   * display purposes — the new match starts fresh with zero scores).
   */
  REMATCH_ACCEPTED: "match:rematch_accepted",
} as const;

/** A valid match lifecycle event identifier. */
export type MatchLifecycleEventName =
  (typeof MATCH_LIFECYCLE_EVENTS)[keyof typeof MATCH_LIFECYCLE_EVENTS];

// ─────────────────────────────────────────────────────────────────────────────
// Rematch accepted payload
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Payload for the {@link MATCH_LIFECYCLE_EVENTS.REMATCH_ACCEPTED} event.
 *
 * Carries the previous match winner for display and confirms that a new
 * match is starting with all scores reset to zero.
 */
export interface RematchAcceptedPayload {
  /**
   * Colyseus `sessionId` of the player who won the previous match.
   *
   * Included for UI continuity (e.g. "Rematch vs. Previous Winner").
   * The new match starts with all scores at 0.
   */
  previousWinnerId: string;
  /**
   * The 1-based round number of the *new* match (always 1, since a
   * rematch starts a fresh match).
   */
  newRoundNumber: number;
}
