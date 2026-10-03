/**
 * Round and match lifecycle protocol types.
 *
 * Defines the authoritative game-state vocabulary for the 1v1 Energy Box
 * Fight match loop, the countdown timer shape, the round-score record,
 * the final match result, and the `FIRST_TO_N` win threshold.
 *
 * Both the authoritative server (`apps/game-server`) and the client
 * (`apps/web`) import these types so they agree on the exact state
 * machine vocabulary and score shape.
 */

/**
 * Authoritative game-state vocabulary for the round/match lifecycle.
 *
 * - `COUNTDOWN` — pre-round countdown; players are locked in.
 * - `PLAYING`   — active round; players can move, aim, and fire.
 * - `ROUND_END` — a player was eliminated or round time expired;
 *                 score updated (or not).
 * - `MATCH_END` — a player reached FIRST_TO_N; match over.
 */
export enum GameState {
  /** Pre-round countdown; players are locked in. */
  COUNTDOWN = "COUNTDOWN",
  /** Active round; players can move, aim, and fire. */
  PLAYING = "PLAYING",
  /** Round completed; score updated. */
  ROUND_END = "ROUND_END",
  /** Match complete; a player reached FIRST_TO_N. */
  MATCH_END = "MATCH_END",
}

/**
 * Countdown timer state carried during the COUNTDOWN phase.
 */
export interface CountdownState {
  /** Remaining countdown time in milliseconds. */
  remainingMs: number;
}

/**
 * Cumulative round-win scores for both players and the current
 * round number.
 */
export interface RoundScore {
  /** 1-based round number currently in progress. */
  roundNumber: number;
  /** Total rounds won by player A. */
  playerAScore: number;
  /** Total rounds won by player B. */
  playerBScore: number;
}

/**
 * Final result of a completed match.
 */
export interface MatchResult {
  /** Colyseus `sessionId` (or logical id) of the winning player. */
  winningPlayerId: string;
  /** Final scores at the end of the match. */
  finalScores: RoundScore;
}

/**
 * Number of rounds a player must win to take the match.
 */
export const FIRST_TO_N = 3 as const;
