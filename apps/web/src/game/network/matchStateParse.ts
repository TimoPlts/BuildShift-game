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
import type { MatchPhase, RoundResult } from "@buildshift/protocol";

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
   * is still in progress. Derived from the authoritative `roundScore`: when
   * the match has ended, the winner is the player whose round-win count is
   * the highest (i.e. reached `ROUNDS_TO_WIN`).
   */
  matchWinnerId: string | null;
}

/**
 * Parse the authoritative match/round state off the raw room state.
 *
 * The room state carries (see `RoomStateSchema`):
 *  - `matchPhase`      — `t.string()` holding a {@link MatchPhase} value;
 *  - `roundScore`      — `t.map(RoundScoreSchema)` keyed by `sessionId`, each
 *    value a schema instance with a numeric `value`;
 *  - `currentRound`    — `t.number()`;
 *  - `lastRoundResult` — a nested {@link RoundResultSchema} ref with
 *    `winnerId` / `roundNumber` (auto-instantiated with sentinel defaults
 *    `winnerId = ""`, `roundNumber = 0`).
 *
 * Every field falls back to a safe default when the wire value is missing or
 * malformed, so callers can rely on {@link parseMatchState} never throwing.
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
    matchPhase === "MATCH_ENDED" ? deriveMatchWinner(roundScore) : null;

  return { matchPhase, roundScore, currentRound, lastRoundResult, matchWinnerId };
}

/**
 * Coerce a raw wire value into a known {@link MatchPhase}, defaulting to
 * `COUNTDOWN` when the value is missing or unrecognized (the natural initial
 * phase of a fresh match).
 */
function coerceMatchPhase(value: unknown): MatchPhase {
  if (typeof value === "string" && MATCH_PHASE_VALUES.includes(value)) {
    return value as MatchPhase;
  }
  return "COUNTDOWN";
}

/**
 * Parse the authoritative `roundScore` map into a plain `sessionId → wins`
 * record. Accepts both a Colyseus MapSchema (iterable of `[key, value]`
 * pairs, where each value carries a numeric `value`) and a plain object
 * (used in tests and by lightweight fakes).
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
 * Coerce one round-score entry into a non-negative integer, returning `null`
 * when it cannot be interpreted as a score.
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
 * Parse the nested `lastRoundResult` ref into a plain {@link RoundResult}
 * (or `null` when the sentinel `winnerId === ""` indicates no completed
 * round).
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
 * Derive the match winner from the authoritative `roundScore`: the player
 * with the highest round-win count. Returns `null` when no player has any
 * wins. On a real match end exactly one player holds the winning total, so
 * the "highest score" rule identifies the winner unambiguously.
 */
function deriveMatchWinner(
  roundScore: Record<string, number>,
): string | null {
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
