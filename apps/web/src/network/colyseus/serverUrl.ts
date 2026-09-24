/**
 * Resolve the game server's WebSocket URL for the browser client.
 *
 * The value comes from the Vite build-time environment variable
 * `VITE_GAME_SERVER_URL`. When it is not set (the normal local-dev case) we
 * fall back to the default local server address `ws://localhost:2567` — the
 * port `apps/game-server` listens on by default (see
 * `apps/game-server/src/port.ts`, `DEFAULT_PORT = 2567`).
 *
 * This module has no runtime dependency on the SDK and is a pure function of
 * the environment, so it is trivially unit-testable (see `serverUrl.test.ts`).
 * It never contains secrets — the game server is a public, unauthenticated
 * local development endpoint.
 */

/** Default local development server address (matches `game-server` port 2567). */
export const DEFAULT_GAME_SERVER_URL = "ws://localhost:2567";

/** The environment variable name read by Vite at build time. */
export const GAME_SERVER_URL_ENV = "VITE_GAME_SERVER_URL";

/** The subset of the Vite `import.meta.env` shape this resolver reads. */
export interface ServerUrlEnv {
  readonly VITE_GAME_SERVER_URL?: string;
}

/**
 * Resolve the game server URL from the given environment.
 *
 * Precedence: a non-empty, trimmed `VITE_GAME_SERVER_URL` wins; otherwise the
 * {@link DEFAULT_GAME_SERVER_URL} fallback is returned. Empty / whitespace-only
 * values fall through to the default so a stray empty env var can't point the
 * client at `""`.
 *
 * @param environment the env-like object (defaults to Vite's `import.meta.env`).
 * @returns a `ws://`/`wss://` server URL string.
 */
export function resolveGameServerUrl(
  environment: ServerUrlEnv = import.meta.env,
): string {
  const raw = environment.VITE_GAME_SERVER_URL?.trim();
  if (raw) {
    return raw;
  }
  return DEFAULT_GAME_SERVER_URL;
}
