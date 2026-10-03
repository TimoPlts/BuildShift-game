/**
 * Round and match lifecycle protocol types.
 *
 * Defines the authoritative game-state vocabulary for the 1v1 Energy Box
 * Fight match loop, the countdown timer shape, the round-score record,
 * the final match result, the `FIRST_TO_N` win threshold, the full
 * match state shape, and the round-reset payload.
 *
 * Both the authoritative server (`apps/game-server`) and the client
 * (`apps/web`) import these types so they agree on the exact state
 * machine vocabulary and score shape.
 */

// ─────────────────────────────────────────────────────────────────────────────
// RoundState enum
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authoritative round/match lifecycle state.
 *
 * The server transitions through these states as the match progresses:
 * - `COUNTDOWN`  — pre-round countdown; players are locked in.
 * - `PLAYING`    — active round; players can move, aim, and fire.
 * - `ROUND_OVER` — a player was eliminated or round time expired;
 *                  score updated.
 * - `MATCH_OVER` — a player reached the win threshold; match complete.
 */
export enum RoundState {
  /** Pre-round countdown; players are locked in. */
  COUNTDOWN = "COUNTDOWN",
  /** Active round; players can move, aim, and fire. */
  PLAYING = "PLAYING",
  /** Round completed; score updated. */
  ROUND_OVER = "ROUND_OVER",
  /** Match complete; a player reached the win threshold. */
  MATCH_OVER = "MATCH_OVER",
}

// ─────────────────────────────────────────────────────────────────────────────
// Match state shape
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The authoritative match state carried on the room state.
 *
 * Contains the current lifecycle state, the round number, and a score
 * record mapping each player's id to their accumulated round-win count.
 */
export interface MatchState {
  /** The current round/match lifecycle state. */
  state: RoundState;
  /** 1-based round number currently in progress (or just completed). */
  roundNumber: number;
  /**
   * Cumulative round-win scores keyed by player identifier.
   * Maps each `playerId` (Colyseus `sessionId`) to the number of rounds
   * that player has won in this match.
   */
  score: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Round reset payload
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Payload broadcast by the server when a round is being reset, instructing
 * each client to restore their player to the specified initial conditions.
 *
 * The server sends this transitionally between `ROUND_OVER` → `COUNTDOWN`
 * so clients can immediately reset their local prediction state.
 */
export interface RoundResetPayload {
  /**
   * The spawn position for the player being reset (capsule-centre
   * world-space position, matching the authoritative position semantic).
   */
  spawnPosition: {
    x: number;
    y: number;
    z: number;
  };
  /**
   * Health to reset the player to. Typically the max health value from
   * game-config (`PLAYER.maxHealth`).
   */
  resetHealth: number;
  /**
   * Energy to reset the player to. Typically the starting energy value
   * from game-config (`ENERGY.startingEnergy`).
   */
  resetEnergy: number;
  /**
   * When `true`, the client should clear all player-placed structures
   * (builds) for this round. The server authoritatively removes them;
   * this flag tells clients to remove their local predictions.
   */
  clearBuilds: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy: GameState enum (kept for backward compatibility)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use {@link RoundState} instead. This legacy enum used
 * `ROUND_END` / `MATCH_END` naming; the canonical lifecycle vocabulary
 * is now `ROUND_OVER` / `MATCH_OVER`.
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

// ─────────────────────────────────────────────────────────────────────────────
// Countdown state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Countdown timer state carried during the COUNTDOWN phase.
 */
export interface CountdownState {
  /** Remaining countdown time in milliseconds. */
  remainingMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Round score (legacy playerA/playerB shape)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cumulative round-win scores for both players and the current
 * round number.
 *
 * @deprecated Prefer {@link MatchState} which uses a playerId-keyed
 * score record instead of fixed playerA/playerB fields.
 */
export interface RoundScore {
  /** 1-based round number currently in progress. */
  roundNumber: number;
  /** Total rounds won by player A. */
  playerAScore: number;
  /** Total rounds won by player B. */
  playerBScore: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Match result
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Final result of a completed match.
 */
export interface MatchResult {
  /** Colyseus `sessionId` (or logical id) of the winning player. */
  winningPlayerId: string;
  /** Final scores at the end of the match. */
  finalScores: RoundScore;
}

// ─────────────────────────────────────────────────────────────────────────────
// Win threshold constant
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Number of rounds a player must win to take the match.
 *
 * @deprecated Use `WIN_ROUNDS` from `@buildshift/game-config` as the
 * canonical source for the win threshold value.
 */
export const FIRST_TO_N = 3 as const;
