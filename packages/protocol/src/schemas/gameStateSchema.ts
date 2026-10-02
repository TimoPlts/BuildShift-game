/**
 * GameStateSchema — the root plain-TypeScript state contract for the
 * two-player movement room.
 *
 * This is the structural contract for the room's shared state. The
 * Colyseus `RoomStateSchema` (see `roomStateSchema.ts`) is the wire form
 * that Colyseus synchronises; this interface is the plain-data view that
 * both client and server agree on for logic, testing, and reconciliation.
 *
 * `players` is a record keyed by the Colyseus client `sessionId`, mapping
 * each player to their authoritative {@link PlayerNetworkState}.
 *
 * Match / round fields:
 *  - `matchPhase` — the authoritative match lifecycle phase.
 *  - `roundScore` — round-win count per player, keyed by `sessionId`.
 *  - `currentRound` — the 1-based current round number (0 before start).
 *  - `lastRoundResult` — the winner + round number of the most recently
 *    completed round, or `null` if no round has completed yet.
 */
import type { PlayerNetworkState } from "./playerNetworkState.js";
import type { MatchPhase, RoundResult } from "../match.js";

export interface GameStateSchema {
  /**
   * All players currently in the room, keyed by Colyseus `sessionId`.
   * The server inserts an entry on join and removes it on leave.
   */
  players: Record<string, PlayerNetworkState>;
  /**
   * Authoritative match lifecycle phase. The server transitions this
   * through COUNTDOWN → IN_PROGRESS → ROUND_ENDED → (COUNTDOWN |
   * MATCH_ENDED) as the match progresses.
   */
  matchPhase: MatchPhase;
  /**
   * Authoritative round-win score per player, keyed by Colyseus
   * `sessionId`. The server increments the winner's entry on each round
   * completion.
   */
  roundScore: Record<string, number>;
  /**
   * The 1-based number of the current (or most recently completed)
   * round. `0` before the first round begins.
   */
  currentRound: number;
  /**
   * The result of the most recently completed round (winner + round
   * number), or `null` if no round has completed yet.
   */
  lastRoundResult: RoundResult | null;
}
