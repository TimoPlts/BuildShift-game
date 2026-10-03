/**
 * matchHudMapper — pure, testable mapping from the authoritative
 * {@link ParsedMatchState} (synchronized from the server) to the
 * {@link MatchHudProps} the presentation-only `MatchHud` React component
 * expects.
 *
 * The mapping translates server-authoritative session-level data into
 * the local-player perspective booleans and scores that the HUD renders.
 *
 * No side effects, no framework dependencies — just a pure function
 * over plain data.
 */
import type { ParsedMatchState } from "./network/matchStateParse";
import type { MatchHudProps } from "../ui/MatchHud";

/**
 * Map the authoritative match state into the local-perspective props
 * the `MatchHud` component requires.
 *
 * @param state The parsed, synchronized match state from the server.
 * @param sessionId The local player's Colyseus session ID.
 * @returns The `MatchHudProps` ready to pass to the component.
 */
export function mapMatchStateToHudProps(
  state: ParsedMatchState,
  sessionId: string,
): MatchHudProps {
  const localScore = state.roundScore[sessionId] ?? 0;

  // Remote score is the other entry in roundScore (1v1: exactly one other).
  let remoteScore = 0;
  for (const [id, wins] of Object.entries(state.roundScore)) {
    if (id !== sessionId) {
      remoteScore = wins;
      break;
    }
  }

  const localWonLastRound: boolean | null =
    state.lastRoundResult === null
      ? null
      : state.lastRoundResult.winnerId === sessionId;

  const localWonMatch: boolean | null =
    state.matchWinnerId === null
      ? null
      : state.matchWinnerId === sessionId;

  return {
    localScore,
    remoteScore,
    phase: state.matchPhase,
    currentRound: state.currentRound,
    localWonLastRound,
    localWonMatch,
  };
}
