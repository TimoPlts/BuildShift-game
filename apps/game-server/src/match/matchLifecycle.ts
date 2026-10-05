/**
 * Match lifecycle event names and payload types for the server-side
 * 1v1 Energy Box Fight match loop.
 *
 * These are server-internal broadcast event identifiers that complement
 * the shared protocol (`@buildshift/protocol`) match types. The protocol
 * defines `MatchPhase`, `RoundState`, `RoundResetPayload`, etc.; this
 * module defines the Colyseus `broadcast()` event names the server uses
 * to push transient lifecycle data (countdown ticks, round-reset payloads,
 * match-end scores) to clients in real time.
 */

// ─── Event names ─────────────────────────────────────────────────────────────

/**
 * Broadcast each tick during the COUNTDOWN phase with the remaining
 * countdown value (in ticks). Clients use this to render a countdown UI.
 */
export const MATCH_EVENTS = {
  /** Payload: `{ countdownTicks: number }` */
  COUNTDOWN_TICK: "match:countdown_tick",
  /**
   * Broadcast when a round ends (on health zero or disconnect).
   * Clients use this to display a "ROUND OVER" overlay.
   * Payload: `{ winnerId: string, loserId: string, winnerScore: number, loserScore: number, roundNumber: number }`.
   */
  ROUND_OVER: "match:round_over",
  /**
   * Broadcast when transitioning from ROUND_ENDED to COUNTDOWN.
   * Payload: `RoundResetPayload` from `@buildshift/protocol`.
   */
  ROUND_RESET: "match:round_reset",
  /**
   * Broadcast on MATCH_OVER with final scores.
   * Payload: `{ winnerId: string, scores: Record<string, number> }`.
   */
  MATCH_END: "match:end",
  /** Authoritative active-round timer; timeout is resolved by the server. */
  ROUND_TIMER: "match:round_timer",
  /** Both players accepted a rematch and a fresh countdown has begun. */
  REMATCH_ACCEPTED: "match:rematch_accepted",
  /** A rematch vote was rejected outside the post-match window. */
  REMATCH_DECLINED: "match:rematch_declined",
} as const;

export type MatchEventName = (typeof MATCH_EVENTS)[keyof typeof MATCH_EVENTS];

// ─── Payload types ──────────────────────────────────────────────────────────

/** Countdown tick broadcast payload. */
export interface CountdownTickPayload {
  /** Remaining countdown in ticks (at 30 Hz). */
  countdownTicks: number;
  /** Total countdown duration in ticks (for progress bar). */
  totalTicks: number;
}

/**
 * Round-over broadcast payload. Sent immediately when a round ends
 * (on health zero, or on disconnect).
 */
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
}

/** Round-reset broadcast payload (mirrors protocol `RoundResetPayload`). */
export interface RoundResetBroadcastPayload {
  /** Spawn position for each player (keyed by sessionId). */
  spawnPositions: Record<string, { x: number; y: number; z: number }>;
  /** Health to reset each player to. */
  resetHealth: number;
  /** Energy to reset each player to. */
  resetEnergy: number;
  /** Whether all player-placed structures should be cleared. */
  clearBuilds: boolean;
}

/** Match-end broadcast payload with final scores. */
export interface MatchEndPayload {
  /** sessionId of the winning player. */
  winnerId: string;
  /** Final round-win scores keyed by sessionId. */
  scores: Record<string, number>;
}
