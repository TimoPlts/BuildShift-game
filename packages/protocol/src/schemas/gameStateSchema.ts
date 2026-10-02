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
 */
import type { PlayerNetworkState } from "./playerNetworkState.js";

export interface GameStateSchema {
  /**
   * All players currently in the room, keyed by Colyseus `sessionId`.
   * The server inserts an entry on join and removes it on leave.
   */
  players: Record<string, PlayerNetworkState>;
}
