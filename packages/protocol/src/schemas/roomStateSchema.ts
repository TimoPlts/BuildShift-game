/**
 * RoomStateSchema — the root Colyseus state schema for the Stage 2D
 * two-player movement room.
 *
 * This is the `state` object that the Colyseus room exposes. Colyseus
 * automatically broadcasts incremental patches of this state (and nested
 * schemas/maps) to all connected clients, so each client always has the
 * latest authoritative view of every player.
 *
 * Structure:
 *  - players: a `MapSchema` of {@link PlayerStateSchema}, keyed by the
 *    Colyseus client `sessionId`. The server adds an entry in `onJoin`
 *    and removes it in `onLeave`.
 *  - matchPhase: the authoritative match lifecycle phase (see
 *    {@link MatchPhase}). The server transitions this as the match
 *    progresses through countdown, active play, round-end, and
 *    match-end.
 *  - roundScore: a `MapSchema` of {@link RoundScoreSchema} keyed by
 *    `sessionId`, mapping each player to their current round-win count.
 *    The server increments the winner's score on each round completion.
 *  - currentRound: the 1-based number of the current (or most recently
 *    completed) round. Starts at 0 before the first round begins.
 *  - lastRoundResult: a nested {@link RoundResultSchema} carrying the
 *    winner and round number of the most recently completed round.
 *    Auto-instantiated on construction with sentinel defaults
 *    (`winnerId = ""`, `roundNumber = 0`); the server sets it
 *    authoritatively after each round completes.
 */
import { schema, t } from "@colyseus/schema";
import { PlayerStateSchema } from "./playerStateSchema.js";
import { RoundResultSchema, RoundScoreSchema } from "../match.js";

export const RoomStateSchema = schema(
  {
    /**
     * All players currently in the room, keyed by Colyseus `sessionId`.
     * The server inserts on join and deletes on leave; Colyseus syncs the
     * map additions/removals/updates to every client automatically.
     */
    players: t.map(PlayerStateSchema),
    /**
     * Authoritative match lifecycle phase. The server transitions this
     * through {@link MatchPhase.COUNTDOWN} → {@link MatchPhase.IN_PROGRESS}
     * → {@link MatchPhase.ROUND_ENDED} → ({@link MatchPhase.COUNTDOWN} |
     * {@link MatchPhase.MATCH_ENDED}). Stored as a string so it
     * serialises cleanly over the Colyseus wire.
     */
    matchPhase: t.string(),
    /**
     * Authoritative round-win score per player, keyed by Colyseus
     * `sessionId`. Each value is a {@link RoundScoreSchema} with a
     * single `value` field holding the round-win count. The server
     * increments the winner's score on each round completion.
     */
    roundScore: t.map(RoundScoreSchema),
    /**
     * The 1-based number of the current (or most recently completed)
     * round. `0` before the first round begins. The server increments
     * this after each round completes.
     */
    currentRound: t.number(),
    /**
     * The result of the most recently completed round (winner + round
     * number). A nested schema auto-instantiated with sentinel defaults
     * (`winnerId = ""`, `roundNumber = 0`). The server sets
     * `lastRoundResult.winnerId` and `lastRoundResult.roundNumber`
     * after each round completes. Clients check `winnerId !== ""` to
     * determine whether a round result is present.
     */
    lastRoundResult: t.ref(RoundResultSchema),
  },
  "RoomStateSchema",
);

/** Instance type of {@link RoomStateSchema}. */
export type RoomStateSchemaInstance = InstanceType<typeof RoomStateSchema>;
