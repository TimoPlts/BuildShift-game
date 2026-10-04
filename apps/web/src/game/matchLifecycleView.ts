/**
 * matchLifecycleView — pure mapping from the authoritative client match
 * state (the T3 `GameRuntime` snapshot) plus the pre-round countdown into a
 * normalized view the React shell (T4 UI) consumes to choose which screen to
 * render for each phase of the match lifecycle.
 *
 * The view translates server-authoritative, session-keyed data into the
 * local-player perspective values the presentation-only components expect
 * (`localWonLastRound`, `localWonMatch`, scores, ...), and folds in the
 * canonical {@link RoundState} vocabulary (`COUNTDOWN` / `PLAYING` /
 * `ROUND_OVER` / `MATCH_OVER`) that the screen transitions key off of.
 *
 * No side effects, no framework dependencies — a pure function over plain
 * data, directly unit-testable.
 */
import { RoundState } from "@buildshift/protocol";
import { matchPhaseToRoundState } from "./player/roundStateParse";
import type { ParsedMatchState } from "./network/matchStateParse";

/**
 * The normalized match-lifecycle view the React shell renders from.
 *
 * All values are from the **local player's** perspective. `connected`
 * reflects whether the runtime is currently joined to a room; the shell uses
 * it to gate the lifecycle overlays so they are never shown while
 * disconnected (a fresh/empty room state must not render a spurious
 * countdown).
 */
export interface MatchLifecycleView {
  /** Whether the runtime is currently connected and joined to a room. */
  connected: boolean;
  /** The canonical lifecycle phase driving the screen transitions. */
  roundState: RoundState;
  /** The 1-based number of the current (or most recently completed) round. */
  currentRound: number;
  /** The local player's accumulated round-win count. */
  localScore: number;
  /** The opponent's accumulated round-win count. */
  remoteScore: number;
  /**
   * Whether the local player won the most recently completed round. `null`
   * when no round has completed yet (or when there is no session to compare
   * against).
   */
  localWonLastRound: boolean | null;
  /**
   * Whether the local player won the match. `null` when the match has not
   * ended yet (or when there is no session to compare against).
   */
  localWonMatch: boolean | null;
  /**
   * The authoritative pre-round countdown remaining seconds. Meaningful
   * (>= 1) only during {@link RoundState.COUNTDOWN}; `0` otherwise.
   */
  countdownRemainingSeconds: number;
}

/**
 * Build the normalized {@link MatchLifecycleView} from the authoritative
 * parsed match state, the local session id, the current countdown value, and
 * the connection flag.
 *
 * @param match The parsed, synchronized match state snapshot.
 * @param sessionId The local player's session id, or `null` when not
 *                  connected (perspective booleans become `null`).
 * @param countdownRemainingSeconds The current countdown value in whole
 *        seconds (the runtime tracks this from the server's countdown ticks).
 * @param connected Whether the runtime is connected to a room.
 */
export function buildMatchLifecycleView(
  match: ParsedMatchState,
  sessionId: string | null,
  countdownRemainingSeconds: number,
  connected: boolean,
): MatchLifecycleView {
  const localScore = sessionId ? match.roundScore[sessionId] ?? 0 : 0;

  // In a 1v1 match there is exactly one other entry in roundScore.
  let remoteScore = 0;
  if (sessionId) {
    for (const [id, wins] of Object.entries(match.roundScore)) {
      if (id !== sessionId) {
        remoteScore = wins;
        break;
      }
    }
  }

  const localWonLastRound: boolean | null =
    sessionId === null || match.lastRoundResult === null
      ? null
      : match.lastRoundResult.winnerId === sessionId;

  const localWonMatch: boolean | null =
    sessionId === null || match.matchWinnerId === null
      ? null
      : match.matchWinnerId === sessionId;

  return {
    connected,
    roundState: matchPhaseToRoundState(match.matchPhase),
    currentRound: match.currentRound,
    localScore,
    remoteScore,
    localWonLastRound,
    localWonMatch,
    countdownRemainingSeconds: connected ? countdownRemainingSeconds : 0,
  };
}
