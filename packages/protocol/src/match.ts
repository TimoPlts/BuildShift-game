/**
 * Match / round protocol types.
 *
 * Defines the authoritative match lifecycle phases, the round-result
 * payload, and the Colyseus wire schemas for match/round state on the
 * room state.
 *
 * Both the authoritative server (`apps/game-server`) and the client
 * (`apps/web`) import these types so they agree on the exact match
 * phase vocabulary, round-result shape, and wire encoding.
 */
import { schema, t } from "@colyseus/schema";

/**
 * Authoritative match lifecycle phases.
 *
 * The server transitions through these phases as the match progresses:
 *  - `COUNTDOWN` — pre-round countdown; players are locked in.
 *  - `IN_PROGRESS` — active round; players can move, aim, and fire.
 *  - `ROUND_ENDED` — a player was eliminated; round score updated.
 *  - `MATCH_ENDED` — a player reached `ROUNDS_TO_WIN`; match over.
 */
export enum MatchPhase {
  /** Pre-round countdown; players are locked in. */
  COUNTDOWN = "COUNTDOWN",
  /** Active round; players can move, aim, and fire. */
  IN_PROGRESS = "IN_PROGRESS",
  /** A player was eliminated; round score updated. */
  ROUND_ENDED = "ROUND_ENDED",
  /** A player reached ROUNDS_TO_WIN; match over. */
  MATCH_ENDED = "MATCH_ENDED",
}

/**
 * Canonical payload describing the outcome of a single round.
 *
 * Carried on the room state as `lastRoundResult` so every client can
 * determine who won the most recently completed round and which round
 * number it was.
 */
export interface RoundResult {
  /** Colyseus `sessionId` of the player who won the round. */
  winnerId: string;
  /** 1-based round number this result belongs to. */
  roundNumber: number;
}

/**
 * Colyseus wire schema for {@link RoundResult}.
 *
 * Used as a nested ref schema on the room state (`t.ref(RoundResultSchema)`).
 * Auto-instantiated with sentinel defaults (`winnerId = ""`,
 * `roundNumber = 0`); the server sets it authoritatively after each round
 * completes. Clients check `winnerId !== ""` to determine whether a
 * round result is present.
 */
export const RoundResultSchema = schema(
  {
    /** Colyseus `sessionId` of the player who won the round. */
    winnerId: t.string(),
    /** 1-based round number this result belongs to. */
    roundNumber: t.number(),
  },
  "RoundResultSchema",
);

/** Instance type of {@link RoundResultSchema}. */
export type RoundResultSchemaInstance = InstanceType<typeof RoundResultSchema>;

/**
 * Minimal Colyseus wire schema for a single round-score entry.
 *
 * Used as the value type in the room state's `roundScore` MapSchema
 * (`t.map(RoundScoreSchema)`). Each entry maps a player's `sessionId`
 * to their current round-win count.
 */
export const RoundScoreSchema = schema(
  {
    /** Round-win count for this player. */
    value: t.number(),
  },
  "RoundScoreSchema",
);

/** Instance type of {@link RoundScoreSchema}. */
export type RoundScoreSchemaInstance = InstanceType<typeof RoundScoreSchema>;
