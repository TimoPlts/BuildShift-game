/**
 * Stage 2A Colyseus server foundation.
 *
 * Wires the minimal pieces the task asks for:
 *  - a Colyseus `Server` using the plain WebSocket transport
 *    (`@colyseus/ws-transport`) instead of the default uWebSockets transport,
 *    which avoids the `uWebSockets.js` native dependency that is rejected by
 *    the repo's `blockExoticSubdeps` pnpm policy;
 *  - registration of ONE foundational room (see `rooms/FoundationRoom.ts`);
 *  - `startServer` which binds to a port and reports the port actually bound
 *    (useful when booting on port 0 to get a free port);
 *  - `shutdownServer` which delegates to `Server.gracefullyShutdown()`.
 *
 * Stage 2B2 notes: the room NAME is sourced from the shared protocol contract
 * (`ROOMS.FOUNDATION`) and the registered room is the minimal STATEFUL
 * `FoundationRoom` (see `rooms/FoundationRoom.ts` + `state/foundationState.ts`).
 *
 * Deliberately NOT implemented here (later stages): authentication,
 * reconnection policy, room capacity, database/persistence, and any
 * authoritative gameplay (see docs/TECHNICAL_ARCHITECTURE.md §6).
 */
import { Server, type ServerOptions } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import type { AddressInfo } from "node:net";

import { ROOMS, type RoomType } from "@buildshift/protocol";

import { FoundationRoom } from "./rooms/FoundationRoom.js";

export type GameServer = Server;

/**
 * The room type registered by this foundation server. A single, neutral
 * "foundation" room is used to prove the lifecycle without tying the
 * transport to any concrete game mode.
 *
 * Stage 2B2: the room NAME is now sourced from the shared protocol contract
 * (`ROOMS.FOUNDATION`, `@buildshift/protocol`) instead of a local literal, so
 * the client and server can never drift on the room identifier.
 */
export const FOUNDATION_ROOM: RoomType = ROOMS.FOUNDATION;

/**
 * Create a Colyseus server configured with the WebSocket transport and the
 * single foundational room registered. The server is NOT listening yet —
 * call `startServer` to bind a port.
 */
export function createServer(options: ServerOptions = {}): GameServer {
  const transport = new WebSocketTransport();
  const server = new Server({
    // The `Server` constructor auto-registers a SIGINT/SIGTERM handler that
    // calls `gracefullyShutdown(true)` and exits the process. We disable it
    // so the entry point can own signal handling explicitly (Stage 2A wants
    // an observable, deterministic shutdown path).
    gracefullyShutdown: false,
    // Keep the default greeting log on; it is the clearest "we booted"
    // signal in dev.
    greet: true,
    transport,
    ...options,
  });
  server.define(FOUNDATION_ROOM, FoundationRoom);
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
    // A string means a Unix socket path; a null means not bound yet.
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
  // Pass a no-op listening listener so we can reject on bind errors while
  // still resolving through the standard path. `Server.listen` handles the
  // underlying `http.Server` `error` event, so we don't need to duplicate
  // that wiring here.
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
 *
 * Passes `exit = false` so this helper only tears the server down and does
 * NOT call `process.exit`. A caller that wants to terminate the process
 * (e.g. the entry point after a signal) does so explicitly.
 */
export async function shutdownServer(server: GameServer): Promise<void> {
  await server.gracefullyShutdown(false);
}
