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
 */
import { schema, t } from "@colyseus/schema";
import { PlayerStateSchema } from "./playerStateSchema.js";

export const RoomStateSchema = schema(
  {
    /**
     * All players currently in the room, keyed by Colyseus `sessionId`.
     * The server inserts on join and deletes on leave; Colyseus syncs the
     * map additions/removals/updates to every client automatically.
     */
    players: t.map(PlayerStateSchema),
  },
  "RoomStateSchema",
);

/** Instance type of {@link RoomStateSchema}. */
export type RoomStateSchemaInstance = InstanceType<typeof RoomStateSchema>;
