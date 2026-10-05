/**
 * Colyseus server foundation.
 *
 * Wires the minimal pieces:
 *  - a Colyseus `Server` using the plain WebSocket transport
 *    (`@colyseus/ws-transport`);
 *  - registration of the canonical Energy Box Fight room
 *    (`BoxFightRoom`);
 *  - `startServer` which binds to a port and reports the port actually bound;
 *  - `shutdownServer` which delegates to `Server.gracefullyShutdown()`.
 *
 * Note: `TwoPlayerMovementRoom` has been retired from production registration.
 * The canonical Energy Box Fight room is `BoxFightRoom`.
 */
import { Server, type ServerOptions } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import type { AddressInfo } from "node:net";

import { BoxFightRoom } from "./rooms/BoxFightRoom.js";
import { BOX_FIGHT_ROOM } from "./rooms/boxFightContract.js";

export { BOX_FIGHT_ROOM };

export type GameServer = Server;

/**
 * Create a Colyseus server configured with the WebSocket transport and the
 * canonical Energy Box Fight room. The server is NOT listening yet — call
 * `startServer` to bind a port.
 */
export function createServer(options: ServerOptions = {}): GameServer {
  const transport = new WebSocketTransport();
  const server = new Server({
    gracefullyShutdown: false,
    greet: true,
    transport,
    ...options,
  });
  server.define(BOX_FIGHT_ROOM, BoxFightRoom);
  console.log(`[buildshift:game-server] gameplay room registered ("${BOX_FIGHT_ROOM}")`);
  return server;
}

interface BoundAddress {
  port: number;
  address: string;
}

/**
 * Read the actual bound address/port from the underlying HTTP server.
 * Returns `null` if the transport has no server attached yet (e.g. called
 * before `listen`).
 */
function readBoundAddress(server: GameServer): BoundAddress | null {
  const httpServer = server.transport.server;
  if (!httpServer) {
    return null;
  }
  const address = httpServer.address();
  if (address === null || typeof address === "string") {
    return null;
  }
  const info = address as AddressInfo;
  return { port: info.port, address: info.address };
}

/**
 * Start the given server (or a freshly created one if omitted) on `port`.
 * Resolves to the server plus the port it is actually listening on.
 */
export async function startServer(
  port: number,
  server: GameServer = createServer(),
): Promise<{ server: GameServer; port: number }> {
  await server.listen(port);
  const bound = readBoundAddress(server);
  if (bound === null) {
    throw new Error(
      "[buildshift:game-server] server.listen() resolved but the transport has no bound HTTP server",
    );
  }
  return { server, port: bound.port };
}

/**
 * Stop the server and release all underlying resources (matchmaker,
 * transport, presence, driver). The server instance must not be reused
 * after this call.
 */
export async function shutdownServer(server: GameServer): Promise<void> {
  await server.gracefullyShutdown(false);
}
