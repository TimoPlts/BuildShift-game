/**
 * Test-only game-server fixture (CONTRACT.md §7).
 *
 * Integration suites need a preparation countdown shorter than the authoritative
 * 8 s so a two-player round opens within a second. That shortcut must NEVER be a
 * client-supplied join option — a real client could then shorten BOTH players'
 * preparation. It is instead a SERVER-OWNED registration input:
 * `createServer({}, { testPreparationSeconds })` arms the server-owned guard and
 * pins the duration in `server.define()` handler options, which Colyseus 0.18
 * merges OVER client join options (`merge({}, clientOptions, handler.options)`).
 * A joining client therefore cannot pick its own preparation length, not even
 * against this fixture.
 *
 * Production code must not import this file: `createServer()` with no deps is the
 * production path and always registers the guard as `false` (authoritative 8 s).
 */
import { createServer, startServer, type GameServer } from "../server.js";

/** Preparation length used by the fast integration fixture (3 ticks at 30 Hz). */
export const FAST_TEST_PREPARATION_SECONDS = 0.1;

export interface TestServerOptions {
  /** Preparation countdown length for EVERY room on this server (seconds). */
  readonly testPreparationSeconds?: number;
}

/**
 * Create a server whose canonical room is registered with the SERVER-OWNED test
 * preparation override. Same registration path as production — only the handler
 * options differ.
 */
export function createTestServer(
  options: TestServerOptions = {},
): GameServer {
  return createServer({}, {
    testPreparationSeconds:
      options.testPreparationSeconds ?? FAST_TEST_PREPARATION_SECONDS,
  });
}

/** Start a {@link createTestServer} server and report the bound port. */
export async function startTestServer(
  port = 0,
  options: TestServerOptions = {},
): Promise<{ server: GameServer; port: number }> {
  return startServer(port, createTestServer(options));
}
