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
 * LEGACY pre-round countdown length, in seconds.
 *
 * Superseded by the round-preparation batch: the server's `COUNTDOWN`
 * phase is now the build PREPARATION phase and runs for
 * `BOX_FIGHT_PREPARATION.durationSeconds` (8 s, see
 * `boxFightPreparation.ts`), not this value. Kept exported only for
 * legacy consumers still importing it; new code must use
 * `BOX_FIGHT_PREPARATION` for the pre-fight countdown duration.
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
