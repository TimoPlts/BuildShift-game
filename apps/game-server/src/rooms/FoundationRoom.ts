/**
 * Stage 2A foundational room.
 *
 * This is the single, deliberately minimal room that proves the Colyseus
 * server foundation works end-to-end (room registration + join/leave
 * lifecycle + clean dispose). It carries NO game state and defines NO
 * protocol/state/input contracts — those belong to later game-mode stages
 * (see docs/TECHNICAL_ARCHITECTURE.md §6). Because the room is stateless,
 * Colyseus uses its built-in "none" serializer and no shared `Schema` is
 * required, which keeps this file within the Stage 2A ownership boundary.
 */
import { Room, type Client } from "@colyseus/core";

export class FoundationRoom extends Room {
  /**
   * Invoked by the matchmaker once, after the room has been instantiated
   * and before any client joins.
   */
  onCreate(): void {
    console.log(
      `[buildshift:foundation] room created (roomId=${this.roomId})`,
    );
  }

  /**
   * Invoked on the server whenever a new client joins this room.
   */
  onJoin(client: Client): void {
    console.log(
      `[buildshift:foundation] client joined (sessionId=${client.sessionId}, clients=${this.clients.length})`,
    );
  }

  /**
   * Invoked on the server whenever a client leaves this room. The client is
   * already removed from `this.clients` before this hook runs.
   */
  onLeave(client: Client, code?: number): void {
    console.log(
      `[buildshift:foundation] client left (sessionId=${client.sessionId}, code=${code ?? "n/a"}, clients=${this.clients.length})`,
    );
  }

  /**
   * Invoked on the server when the room is disposed (all clients have left
   * and autoDispose kicks in, or the server is shutting down).
   */
  onDispose(): void {
    console.log(
      `[buildshift:foundation] room disposed (roomId=${this.roomId})`,
    );
  }
}
