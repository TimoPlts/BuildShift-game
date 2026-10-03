/**
 * roundStateParse — client-side bridge between the server's wire
 * `matchPhase` field and the canonical `RoundState` lifecycle enum.
 *
 * The authoritative server currently carries the match lifecycle on the
 * room state as `matchPhase` (using the legacy `MatchPhase` enum values:
 * `COUNTDOWN`, `IN_PROGRESS`, `ROUND_ENDED`, `MATCH_ENDED`). The client-side
 * {@link MatchStateController} operates on the canonical `RoundState` enum
 * (`COUNTDOWN`, `PLAYING`, `ROUND_OVER`, `MATCH_OVER`) defined in
 * `@buildshift/protocol`.
 *
 * This module provides:
 *  - {@link matchPhaseToRoundState} — maps a single `MatchPhase` value to
 *    its `RoundState` equivalent.
 *  - {@link parseRoundState} — extracts and maps the authoritative
 *    `roundState` from a raw or parsed room-state object.
 *  - {@link extractRoundStateFromMatch} — convenience overload that takes
 *    the already-parsed `ParsedMatchState` snapshot.
 *
 * All functions are pure and dependency-light (protocol types only) so
 * they are directly unit-testable in Node.
 *
 * Usage in GameRuntime (or equivalent top-level controller):
 *
 * ```ts
 * import { MatchStateController } from "./player/matchStateController";
 * import { parseRoundState } from "./player/roundStateParse";
 *
 * const matchStateController = new MatchStateController({
 *   onRoundReset: (ctx) => { /* reset prediction, positions, builds, energy *\/ },
 *   onMatchOver: (info) => { /* signal UI *\/ },
 * });
 *
 * // On each network state change:
 * const roundState = parseRoundState(state.match.matchPhase);
 * matchStateController.setServerState(roundState, winnerId, resetPayload);
 *
 * // Gate the simulation tick:
 * if (matchStateController.predictionActive) {
 *   stepSimulationTick();
 * }
 * ```
 */

import {
  MatchPhase,
  RoundState,
} from "@buildshift/protocol";

// ─────────────────────────────────────────────────────────────────────────────
// Mapping table
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Static mapping from each wire `MatchPhase` value to its canonical
 * `RoundState` equivalent.
 *
 * | Wire (MatchPhase)  | Canonical (RoundState) |
 * |--------------------|------------------------|
 * | `COUNTDOWN`        | `COUNTDOWN`            |
 * | `IN_PROGRESS`      | `PLAYING`              |
 * | `ROUND_ENDED`      | `ROUND_OVER`           |
 * | `MATCH_ENDED`      | `MATCH_OVER`           |
 */
export const MATCH_PHASE_TO_ROUND_STATE: Readonly<
  Record<MatchPhase, RoundState>
> = {
  [MatchPhase.COUNTDOWN]: RoundState.COUNTDOWN,
  [MatchPhase.IN_PROGRESS]: RoundState.PLAYING,
  [MatchPhase.ROUND_ENDED]: RoundState.ROUND_OVER,
  [MatchPhase.MATCH_ENDED]: RoundState.MATCH_OVER,
};

// ─────────────────────────────────────────────────────────────────────────────
// Parse functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a single wire `MatchPhase` value (or raw string) to its canonical
 * {@link RoundState} equivalent.
 *
 * Returns `RoundState.COUNTDOWN` when the input is unrecognised or missing —
 * the safe default for a fresh match.
 *
 * @param matchPhase the authoritative `matchPhase` value from the wire.
 * @returns the canonical `RoundState`.
 */
export function matchPhaseToRoundState(
  matchPhase: MatchPhase | string | null | undefined,
): RoundState {
  if (matchPhase == null || typeof matchPhase !== "string") {
    return RoundState.COUNTDOWN;
  }
  const mapped = MATCH_PHASE_TO_ROUND_STATE[matchPhase as MatchPhase];
  return mapped ?? RoundState.COUNTDOWN;
}

/**
 * Extract the authoritative `roundState` from a raw room-state object.
 *
 * The server carries the lifecycle field as `matchPhase` on the room state.
 * This function reads that field defensively (tolerating missing, null, or
 * malformed values) and maps it to the canonical `RoundState` enum.
 *
 * @param rawRoomState the raw (unparsed) room state object from the
 *                     network client, or the already-parsed match portion.
 * @returns the canonical `RoundState`.
 */
export function parseRoundState(
  rawRoomState: unknown,
): RoundState {
  if (rawRoomState == null || typeof rawRoomState !== "object") {
    return RoundState.COUNTDOWN;
  }
  const record = rawRoomState as Record<string, unknown>;
  return matchPhaseToRoundState(record.matchPhase as string | undefined);
}

/**
 * Extract the canonical `roundState` from a parsed match-state snapshot.
 *
 * This is the convenience overload for the already-parsed
 * `ParsedMatchState` shape (which carries `matchPhase` as a typed
 * `MatchPhase` field).
 *
 * @param matchState the parsed match state snapshot from
 *                   `parseMatchState()`.
 * @returns the canonical `RoundState`.
 */
export function extractRoundStateFromMatch(
  matchState: { matchPhase: MatchPhase | string } | null | undefined,
): RoundState {
  if (matchState == null) {
    return RoundState.COUNTDOWN;
  }
  return matchPhaseToRoundState(matchState.matchPhase);
}

/**
 * The set of all valid `RoundState` values, useful for validation and
 * exhaustive switch statements in downstream consumers.
 */
export const VALID_ROUND_STATES: readonly RoundState[] = [
  RoundState.COUNTDOWN,
  RoundState.PLAYING,
  RoundState.ROUND_OVER,
  RoundState.MATCH_OVER,
] as const;

/**
 * Check whether a raw string is a valid `RoundState` value.
 *
 * @param value the raw string to check.
 * @returns `true` when the value is one of the canonical `RoundState` members.
 */
export function isValidRoundState(value: unknown): value is RoundState {
  return typeof value === "string" && VALID_ROUND_STATES.includes(value as RoundState);
}
