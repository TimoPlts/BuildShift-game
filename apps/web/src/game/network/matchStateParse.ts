/**
 * matchStateParse — authoritative match/round state parsing for the client.
 *
 * Parses the authoritative match fields the server carries on the room state
 * (`matchPhase`, `roundScore`, `currentRound`, `lastRoundResult`) into a plain,
 * defensive {@link ParsedMatchState} snapshot the GameRuntime can consume.
 *
 * Kept separate from `NetworkClient` so the parsing rules (and their edge
 * cases) are directly unit-testable without a Colyseus room.
 */
import { MatchPhase, type RoundResult } from "@buildshift/protocol";

/** The valid authoritative match lifecycle phase values. */
const MATCH_PHASE_VALUES: readonly string[] = [
  "COUNTDOWN",
  "IN_PROGRESS",
  "ROUND_ENDED",
  "MATCH_ENDED",
];

/**
 * The canonical, client-side view of the authoritative match/round state.
 *
 * This is a plain-data snapshot (no schema refs) that is safe to store, diff,
 * and hand to reconciliation / match-loop logic.
 */
export interface ParsedMatchState {
  /** Authoritative match lifecycle phase. */
  matchPhase: MatchPhase;
  /** Authoritative round-win score per player, keyed by `sessionId`. */
  roundScore: Record<string, number>;
  /** The 1-based number of the current (or most recently completed) round. */
  currentRound: number;
  /**
   * The result of the most recently completed round, or `null` when no round
   * has completed yet (the wire sentinel `winnerId === ""`).
   */
  lastRoundResult: RoundResult | null;
  /**
   * The session ID of the player who won the match, or `null` while the match
   * is still in progress.
   */
  matchWinnerId: string | null;
}

/**
 * Parse the authoritative match/round state off the raw room state.
 */
export function parseMatchState(raw: unknown): ParsedMatchState {
  const record =
    raw == null || typeof raw !== "object" ? null : (raw as Record<string, unknown>);

  const matchPhase = coerceMatchPhase(record ? record.matchPhase : undefined);
  const roundScore = parseRoundScore(record ? record.roundScore : undefined);
  const currentRound = coerceCurrentRound(record ? record.currentRound : undefined);
  const lastRoundResult = parseLastRoundResult(
    record ? record.lastRoundResult : undefined,
  );

  const matchWinnerId =
    matchPhase === MatchPhase.MATCH_ENDED ? deriveMatchWinner(roundScore) : null;

  return { matchPhase, roundScore, currentRound, lastRoundResult, matchWinnerId };
}

/**
 * Coerce a raw wire value into a known {@link MatchPhase}, defaulting to
 * `COUNTDOWN` when the value is missing or unrecognized.
 */
function coerceMatchPhase(value: unknown): MatchPhase {
  if (typeof value === "string" && MATCH_PHASE_VALUES.includes(value)) {
    return value as MatchPhase;
  }
  return MatchPhase.COUNTDOWN;
}

/**
 * Coerce the raw `currentRound` wire value into a non-negative integer,
 * defaulting to 0 when missing or malformed.
 */
function coerceCurrentRound(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

/**
 * Parse the authoritative `roundScore` map into a plain `sessionId → wins`
 * record.
 */
function parseRoundScore(raw: unknown): Record<string, number> {
  const result: Record<string, number> = {};

  if (raw == null) {
    return result;
  }

  if (
    typeof (raw as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function"
  ) {
    for (const item of raw as Iterable<unknown>) {
      if (Array.isArray(item) && item.length >= 2) {
        const key = String(item[0]);
        const wins = coerceScore(item[1]);
        if (wins !== null) {
          result[key] = wins;
        }
      }
    }
    return result;
  }

  if (typeof raw === "object") {
    for (const key of Object.keys(raw as Record<string, unknown>)) {
      const wins = coerceScore((raw as Record<string, unknown>)[key]);
      if (wins !== null) {
        result[key] = wins;
      }
    }
  }

  return result;
}

/**
 * Coerce one round-score entry into a non-negative integer.
 */
function coerceScore(raw: unknown): number | null {
  const value =
    raw != null && typeof raw === "object"
      ? (raw as { value?: unknown }).value
      : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.floor(value));
}

/**
 * Parse the nested `lastRoundResult` ref into a plain {@link RoundResult}.
 */
function parseLastRoundResult(raw: unknown): RoundResult | null {
  if (raw == null || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const winnerId = typeof r.winnerId === "string" ? r.winnerId : "";
  const roundNumber =
    typeof r.roundNumber === "number" && Number.isFinite(r.roundNumber)
      ? r.roundNumber
      : 0;
  if (winnerId === "") {
    return null;
  }
  return { winnerId, roundNumber };
}

/**
 * Derive the match winner from the authoritative `roundScore`.
 */
function deriveMatchWinner(roundScore: Record<string, number>): string | null {
  let bestId: string | null = null;
  let bestWins = -1;
  for (const [id, wins] of Object.entries(roundScore)) {
    if (wins > bestWins) {
      bestWins = wins;
      bestId = id;
    }
  }
  return bestWins > 0 ? bestId : null;
}
