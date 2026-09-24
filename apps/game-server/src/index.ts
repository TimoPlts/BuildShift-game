/**
 * Game server entry point.
 *
 * Boots the Stage 2A Colyseus foundation (see `server.ts`) and wires
 * explicit process signal handling so the server shuts down cleanly on
 * SIGINT / SIGTERM. The port is read from `GAME_SERVER_PORT` (falling back
 * to `PORT`, then a sensible dev default), so the same binary works in
 * dev, CI, and a container without code changes.
 */
import { PROTOCOL_VERSION } from "@buildshift/protocol";

import { resolvePort } from "./port.js";
import {
  FOUNDATION_ROOM,
  createServer,
  startServer,
  shutdownServer,
  type GameServer,
} from "./server.js";

const LOG_PREFIX = "[buildshift:game-server]";

let server: GameServer | null = null;
let shuttingDown = false;

/**
 * Idempotent shutdown: safe to call from multiple signal handlers in flight.
 */
async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`${LOG_PREFIX} ${reason}; shutting down gracefully`);
  if (server === null) {
    process.exit(0);
    return;
  }
  const active = server;
  server = null;
  try {
    await shutdownServer(active);
    console.log(`${LOG_PREFIX} shutdown complete`);
  } catch (err) {
    console.error(`${LOG_PREFIX} error during shutdown:`, err);
  } finally {
    process.exit(0);
  }
}

async function main(): Promise<void> {
  const requestedPort = resolvePort();
  console.log(`${LOG_PREFIX} starting (protocol ${PROTOCOL_VERSION})`);
  console.log(`${LOG_PREFIX} requested port: ${requestedPort}`);
  console.log(`${LOG_PREFIX} registering room: ${FOUNDATION_ROOM}`);

  server = createServer();
  const { server: running, port } = await startServer(requestedPort, server);
  server = running;

  const bound = running.transport.server?.address();
  // Normalize the bound address into a clean, host-style string for the log:
  //  - `::` / `0.0.0.0` (any-interface) → `0.0.0.0`
  //  - a specific IPv6 address → bracketed, e.g. `[::1]`
  //  - anything else (IPv4 / undefined) → as-is, or `localhost`
  const displayHost = (() => {
    if (typeof bound !== "object" || bound === null) return "localhost";
    const { address } = bound;
    if (address === "::" || address === "0.0.0.0") return "0.0.0.0";
    if (address.includes(":")) return `[${address}]`;
    return address;
  })();
  const anyInterface =
    typeof bound === "object" &&
    bound !== null &&
    (bound.address === "::" || bound.address === "0.0.0.0");
  console.log(
    `${LOG_PREFIX} listening on http://${displayHost}:${port}` +
      (anyInterface ? " (bound to all interfaces)" : ""),
  );
  console.log(`${LOG_PREFIX} room "${FOUNDATION_ROOM}" is ready for connections`);

  process.on("SIGINT", () => {
    void shutdown("received SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("received SIGTERM");
  });
}

main().catch((err: unknown) => {
  console.error(`${LOG_PREFIX} failed to start:`, err);
  process.exit(1);
});
