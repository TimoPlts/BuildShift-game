/**
 * Colyseus server foundation.
 *
 * Wires the minimal pieces:
 *  - a Colyseus `Server` using the plain WebSocket transport
 *    (`@colyseus/ws-transport`);
 *  - registration of the canonical gameplay room
 *    (`TwoPlayerMovementRoom`) which drives movement AND hitscan combat
 *    in a single 30 Hz tick loop;
 *  - `startServer` which binds to a port and reports the port actually bound;
 *  - `shutdownServer` which delegates to `Server.gracefullyShutdown()`.
 *
 * The canonical gameplay path is the `TwoPlayerMovementRoom` — it is the
 * SINGLE authoritative gameplay path that drives movement, prediction,
 * reconciliation, interpolation, AND hitscan combat (fire validation via
 * `canFire`, ray-cast hits, shield/health damage, elimination, and respawn)
 * in one 30 Hz tick loop.
 */
import { Server, type ServerOptions } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import type { AddressInfo } from "node:net";

import { ROOMS, type RoomType } from "@buildshift/protocol";

import { createAiChatRouter } from "./aiChat/aiChatRoute.js";
import { createChatService, type ChatService } from "./aiChat/chatService.js";
import { TwoPlayerMovementRoom } from "./rooms/TwoPlayerMovementRoom.js";
import {
  issueTestPreparationOverride,
  normalizeTestPreparationSeconds,
  TEST_PREPARATION_TOKEN_OPTION,
} from "./rooms/testPreparationOverride.js";

export type GameServer = Server;

/**
 * The canonical gameplay room name, sourced from the shared protocol contract
 * so client, server, and tests share one identifier.
 */
export const TWO_PLAYER_ROOM: RoomType = ROOMS.TWO_PLAYER_MOVEMENT;

/**
 * Dependency hooks for {@link createServer} (all optional).
 */
export interface CreateServerDeps {
  /**
   * Chat service backing `POST /api/ai-chat`. Defaults to the real service
   * (bounded in-memory store + school LLM); tests may inject a stub.
   */
  readonly aiChatService?: ChatService;
  /**
   * TEST-ONLY server-owned preparation override (see CONTRACT.md §7).
   *
   * When a finite number > 0 is supplied, the canonical room is registered with
   * SERVER-DEFINED handler options carrying a capability token issued by this
   * process, and the room resolves the preparation length SERVER-SIDE from that
   * token. A client join option can neither arm the override nor pick a
   * duration — it has no token, and Colyseus 0.18 merges handler options over
   * client options (`merge({}, clientOptions, handler.options)`).
   *
   * Production callers (and `createServer()` with no deps) leave this unset, so
   * the room registers with an empty token and always runs the authoritative 8 s
   * preparation for BOTH players. This is deliberately NOT inferred from
   * `NODE_ENV`; it is explicit, per-server construction.
   */
  readonly testPreparationSeconds?: number;
}

/**
 * Handler (server-defined) options for the canonical room registration.
 *
 * Exported for contract tests. The production shape is exactly
 * `{ __testPreparationToken: "" }` — an explicit neutral value that the shallow
 * Colyseus merge assigns OVER any client-sent token. The test shape carries a
 * freshly issued, server-side-only token (never transmitted to clients) bound to
 * the requested duration.
 */
export function roomRegistrationOptions(
  deps: Pick<CreateServerDeps, "testPreparationSeconds"> = {},
): Record<string, unknown> {
  const token = issueTestPreparationOverride(
    normalizeTestPreparationSeconds(deps.testPreparationSeconds),
  );
  return { [TEST_PREPARATION_TOKEN_OPTION]: token ?? "" };
}

/**
 * Create a Colyseus server configured with the WebSocket transport and the
 * canonical gameplay room. The server is NOT listening yet — call `startServer`
 * to bind a port.
 *
 * The Colyseus endpoints are attached to an Express app that also serves the
 * AI chat route (`POST /api/ai-chat`) on the SAME origin/port, so the web
 * client keeps resolving one game-server URL for both.
 */
export function createServer(
  options: ServerOptions = {},
  deps: CreateServerDeps = {},
): GameServer {
  const transport = new WebSocketTransport();
  const aiChatService = deps.aiChatService ?? createChatService();
  const aiChatRouter = createAiChatRouter(aiChatService);
  const server = new Server({
    gracefullyShutdown: false,
    greet: true,
    transport,
    // Mount the AI chat route on the SAME Express/HTTP origin as the
    // Colyseus endpoints (the transport creates the Express app when an
    // `express` callback is provided).
    express: (app) => {
      app.disable("x-powered-by");
      app.use(aiChatRouter);
    },
    ...options,
  });
  server.define(
    ROOMS.TWO_PLAYER_MOVEMENT,
    TwoPlayerMovementRoom,
    roomRegistrationOptions(deps),
  );
  console.log(`[buildshift:game-server] gameplay room registered ("${ROOMS.TWO_PLAYER_MOVEMENT}")`);
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
