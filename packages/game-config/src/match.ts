/**
 * Match / round configuration.
 *
 * Shared match-loop timing and scoring constants that both the
 * authoritative server and the client reference. These values drive
 * the round lifecycle: countdown, active play, reset delay, and the
 * number of round wins needed to end the match.
 */

/**
 * Number of rounds a player must win to take the match.
 *
 * When a player's score in the `MatchState.score` record reaches this
 * value, the server transitions the match to `RoundState.MATCH_OVER`.
 */
export const WIN_ROUNDS = 3;

/**
 * @deprecated Use {@link WIN_ROUNDS} as the canonical source for the
 * round-win threshold. This alias is kept for backward compatibility.
 */
export const ROUNDS_TO_WIN = WIN_ROUNDS;

/**
 * Duration of the pre-round countdown, in seconds.
 *
 * The server sets `RoundState.COUNTDOWN` for this many seconds before
 * each round begins. Players are locked in during this phase.
 */
export const ROUND_COUNTDOWN_SECONDS = 3;

/**
 * Delay between round end and the next round's countdown, in seconds.
 *
 * After a round is completed (`RoundState.ROUND_OVER`), the server
 * waits this many seconds before starting the next countdown, giving
 * players a brief pause to see the result.
 */
export const ROUND_RESET_DELAY_SECONDS = 2;
