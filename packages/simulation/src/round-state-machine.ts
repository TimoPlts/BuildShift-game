/**
 * Pure round/match lifecycle state-machine function.
 *
 * `advanceRoundState` is a pure function that, given the current
 * {@link GameState}, the current {@link RoundScore}, and a
 * {@link RoundEvent}, returns a {@link RoundTransition} describing
 * the next state and (optionally) an updated score.
 *
 * Transition table:
 *
 * | Current state | Event               | Next state  | Score change                          |
 * |---------------|---------------------|-------------|---------------------------------------|
 * | COUNTDOWN     | COUNTDOWN_EXPIRED   | PLAYING     | none                                  |
 * | PLAYING       | PLAYER_ELIMINATED   | ROUND_END   | surviving player score + 1            |
 * | PLAYING       | ROUND_TIME_EXPIRED  | ROUND_END   | none                                  |
 * | ROUND_END     | (any)               | COUNTDOWN   | none (if both scores < FIRST_TO_N)    |
 * | ROUND_END     | (any)               | MATCH_END   | none (if either score >= FIRST_TO_N)  |
 * | MATCH_END     | PLAY_AGAIN          | COUNTDOWN   | all scores reset to 0                 |
 *
 * Invalid (state, event) pairs throw a descriptive `Error`.
 */
import {
  GameState,
  type RoundScore,
  FIRST_TO_N,
} from "@buildshift/protocol";

/**
 * Discriminated union of all events that can drive the
 * round/match state machine forward.
 */
export type RoundEvent =
  /** Countdown timer reached zero; the round begins. */
  | { type: "COUNTDOWN_EXPIRED" }
  /** A player was eliminated; the surviving player wins the round. */
  | { type: "PLAYER_ELIMINATED"; eliminatedId: string }
  /** Round time expired with no elimination; round ends without a score change. */
  | { type: "ROUND_TIME_EXPIRED" }
  /** Match is over; both players agree to start a new match. */
  | { type: "PLAY_AGAIN" };

/**
 * Result of advancing the state machine.
 */
export interface RoundTransition {
  /** The next {@link GameState} after processing the event. */
  next: GameState;
  /** Updated score, if the transition caused a score change. */
  updatedScore?: RoundScore;
}

/**
 * Advances the round/match state machine by one event.
 *
 * @param current  The current game state.
 * @param score    The current round score (used for score updates and
 *                 determining ROUND_END → MATCH_END vs COUNTDOWN).
 * @param event    The event to process.
 * @returns A {@link RoundTransition} with the next state and
 *          optionally an updated score.
 * @throws {Error} If the (state, event) pair is not a valid transition.
 */
export function advanceRoundState(
  current: GameState,
  score: RoundScore,
  event: RoundEvent,
): RoundTransition {
  switch (current) {
    case GameState.COUNTDOWN: {
      if (event.type !== "COUNTDOWN_EXPIRED") {
        throw new Error(
          `Invalid event "${event.type}" in state COUNTDOWN. Expected COUNTDOWN_EXPIRED.`,
        );
      }
      return { next: GameState.PLAYING };
    }

    case GameState.PLAYING: {
      if (event.type === "PLAYER_ELIMINATED") {
        // Increment the surviving player's score.
        // If player A was eliminated, player B scores; and vice-versa.
        const updatedScore: RoundScore =
          event.eliminatedId === "A"
            ? { ...score, playerBScore: score.playerBScore + 1 }
            : { ...score, playerAScore: score.playerAScore + 1 };
        return { next: GameState.ROUND_END, updatedScore };
      }

      if (event.type === "ROUND_TIME_EXPIRED") {
        // No score change; the round simply ends.
        return { next: GameState.ROUND_END };
      }

      throw new Error(
        `Invalid event "${event.type}" in state PLAYING. Expected PLAYER_ELIMINATED or ROUND_TIME_EXPIRED.`,
      );
    }

    case GameState.ROUND_END: {
      // The transition out of ROUND_END is determined by the score:
      //   - If either player reached FIRST_TO_N → MATCH_END
      //   - Otherwise → COUNTDOWN (next round)
      // The event is accepted but does not affect the outcome.
      if (score.playerAScore >= FIRST_TO_N || score.playerBScore >= FIRST_TO_N) {
        return { next: GameState.MATCH_END };
      }
      return { next: GameState.COUNTDOWN };
    }

    case GameState.MATCH_END: {
      if (event.type !== "PLAY_AGAIN") {
        throw new Error(
          `Invalid event "${event.type}" in state MATCH_END. Expected PLAY_AGAIN.`,
        );
      }
      return {
        next: GameState.COUNTDOWN,
        updatedScore: { roundNumber: 0, playerAScore: 0, playerBScore: 0 },
      };
    }

    default: {
      // Exhaustiveness guard: all GameState members are handled above.
      const _exhaustive: never = current;
      throw new Error(`Unexpected GameState: ${_exhaustive}`);
    }
  }
}
