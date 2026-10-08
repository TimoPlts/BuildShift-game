/**
 * Resolve the game server's WebSocket URL for the browser client.
 *
 * The value comes from the Vite build-time environment variable
 * `VITE_GAME_SERVER_URL`. When it is not set, a browser run uses its current
 * hostname with the game-server port, so a remote/forwarded frontend does not
 * accidentally target the viewing machine's unrelated `localhost`.
 *
 * This module has no runtime dependency on the SDK and is a pure function of
 * the environment, so it is trivially unit-testable.
 */

/** Default local development server address (matches `game-server` port 2567). */
export const DEFAULT_GAME_SERVER_URL = "ws://localhost:2567";

/** The environment variable name read by Vite at build time. */
export const GAME_SERVER_URL_ENV = "VITE_GAME_SERVER_URL";

/** The subset of the Vite `import.meta.env` shape this resolver reads. */
export interface ServerUrlEnv {
  readonly VITE_GAME_SERVER_URL?: string;
}

export interface BrowserLocationLike {
  readonly protocol: string;
  readonly hostname: string;
}

function defaultBrowserLocation(): BrowserLocationLike | undefined {
  return typeof window === "undefined" ? undefined : window.location;
}

function formatHost(hostname: string): string {
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}

/**
 * Resolve the game server URL from the given environment.
 *
 * Precedence: a non-empty, trimmed `VITE_GAME_SERVER_URL` wins; otherwise a
 * browser run targets its current host on port 2567, using `wss` from HTTPS.
 * Non-browser callers retain {@link DEFAULT_GAME_SERVER_URL}.
 *
 * @param environment the env-like object (defaults to Vite's `import.meta.env`).
 * @returns a `ws://`/`wss://` server URL string.
 */
export function resolveGameServerUrl(
  environment: ServerUrlEnv = import.meta.env,
  browserLocation: BrowserLocationLike | undefined = defaultBrowserLocation(),
): string {
  const raw = environment.VITE_GAME_SERVER_URL?.trim();
  if (raw) {
    return raw;
  }
  if (browserLocation) {
    const protocol = browserLocation.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${formatHost(browserLocation.hostname)}:2567`;
  }
  return DEFAULT_GAME_SERVER_URL;
}
