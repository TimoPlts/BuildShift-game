/**
 * matchReset — pure, testable logic for the client-side match-loop lifecycle.
 *
 * Given two consecutive snapshots of the authoritative match state, this
 * module decides:
 *  - whether the transition crosses an authoritative **round boundary** (a new
 *    round is starting, so the client must clear its stale prediction /
 *    reconciliation / interpolation / combat / input state), and
 *  - whether the **match has just finished** (a player reached the win
 *    threshold, i.e. the phase transitioned into `MATCH_ENDED`).
 *
 * This module holds no Colyseus / Babylon dependencies — it is a pure
 * function over plain match-state snapshots so the reset trigger can be unit
 * tested in isolation from the GameRuntime.
 */
import { MatchPhase } from "@buildshift/protocol";

/**
 * A minimal snapshot of the authoritative match state required to detect a
 * round-boundary reset and match completion.
 *
 * Mirrors the subset of the parsed room state the GameRuntime tracks between
 * updates; it is intentionally decoupled from the full `ParsedMatchState` so
 * the detection logic stays simple and framework-free.
 */
export interface MatchStateSnapshot {
  /** Authoritative match lifecycle phase. */
  matchPhase: MatchPhase;
  /** The 1-based current (or most recently completed) round number. */
  currentRound: number;
  /** Authoritative round-win score per player (sessionId → wins). */
  roundScore: Record<string, number>;
  /** The most recently completed round's result, or null. */
  lastRoundResult: { winnerId: string; roundNumber: number } | null;
}

/**
 * The outcome of diffing two consecutive match-state snapshots.
 */
export interface MatchResetDecision {
  /**
   * Whether to clear the stale per-round client state (local prediction,
   * reconciliation, remote interpolation, combat, and input sequence).
   */
  shouldReset: boolean;
  /**
   * Whether the match has just finished on this transition (a player reached
   * the win threshold; the phase entered `MATCH_ENDED`).
   */
  matchEnded: boolean;
}

/**
 * The pre-match snapshot the client starts from before the first
 * authoritative state arrives.
 */
export const INITIAL_MATCH_SNAPSHOT: MatchStateSnapshot = {
  matchPhase: MatchPhase.COUNTDOWN,
  currentRound: 0,
  roundScore: {},
  lastRoundResult: null,
};

/**
 * Decide whether the transition from `prev` to `next` crosses an authoritative
 * round boundary (requiring a stale-state reset) and/or the completion of the
 * match.
 *
 * A round boundary is detected when EITHER:
 *  - the authoritative `currentRound` advances to a higher number, or
 *  - the phase leaves `ROUND_ENDED` and enters a fresh round
 *    (`COUNTDOWN` or `IN_PROGRESS`).
 *
 * The match is considered finished the moment the phase transitions into
 * `MATCH_ENDED`; a finished match also implies a final reset so the deciding
 * round's stale combat / input state is cleared.
 */
export function computeMatchReset(
  prev: MatchStateSnapshot,
  next: MatchStateSnapshot,
): MatchResetDecision {
  const matchEnded =
    next.matchPhase === MatchPhase.MATCH_ENDED &&
    prev.matchPhase !== MatchPhase.MATCH_ENDED;

  const roundAdvanced = next.currentRound > prev.currentRound;
  const enteredFreshRound =
    prev.matchPhase === MatchPhase.ROUND_ENDED &&
    (next.matchPhase === MatchPhase.COUNTDOWN ||
      next.matchPhase === MatchPhase.IN_PROGRESS);

  const shouldReset = roundAdvanced || enteredFreshRound || matchEnded;

  return { shouldReset, matchEnded };
}
