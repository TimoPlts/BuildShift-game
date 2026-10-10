/**
 * Resolve the game server's WebSocket URL for the browser client.
 *
 * The value comes from, in order of precedence:
 *  1. a `?gameServer=ws://...` query parameter on the page URL — a
 *     per-page runtime override (used by the production browser smoke
 *     suite to target its own isolated game-server instance without any
 *     build-time configuration),
 *  2. the Vite build-time environment variable `VITE_GAME_SERVER_URL`,
 *  3. a browser run using its current hostname with the game-server port,
 *     so a remote/forwarded frontend does not accidentally target the
 *     viewing machine's unrelated `localhost`.
 *
 * This module has no runtime dependency on the SDK and is a pure function of
 * the environment, so it is trivially unit-testable.
 */

/** Default local development server address (matches `game-server` port 2567). */
export const DEFAULT_GAME_SERVER_URL = "ws://localhost:2567";

/** The environment variable name read by Vite at build time. */
export const GAME_SERVER_URL_ENV = "VITE_GAME_SERVER_URL";

/**
 * The query-parameter name carrying a per-page runtime game-server URL
 * override (e.g. `?gameServer=ws://127.0.0.1:25671`).
 */
export const GAME_SERVER_URL_QUERY_PARAM = "gameServer";

/** The subset of the Vite `import.meta.env` shape this resolver reads. */
export interface ServerUrlEnv {
  readonly VITE_GAME_SERVER_URL?: string;
}

export interface BrowserLocationLike {
  readonly protocol: string;
  readonly hostname: string;
  /** The URL's query string, including the leading `?` (when present). */
  readonly search?: string;
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
 * Precedence: a non-empty `?gameServer=` query parameter on the page URL
 * wins (per-page runtime override); then a non-empty, trimmed
 * `VITE_GAME_SERVER_URL`; then a browser run targets its current host on
 * port 2567, using `wss` from HTTPS. Non-browser callers retain
 * {@link DEFAULT_GAME_SERVER_URL}.
 *
 * The query-parameter value must be an absolute `ws://`/`wss://` URL;
 * anything else is ignored so a malformed parameter cannot silently point
 * the client at an invalid target.
 *
 * @param environment the env-like object (defaults to Vite's `import.meta.env`).
 * @param browserLocation the browser location (defaults to `window.location`).
 * @returns a `ws://`/`wss://` server URL string.
 */
export function resolveGameServerUrl(
  environment: ServerUrlEnv = import.meta.env,
  browserLocation: BrowserLocationLike | undefined = defaultBrowserLocation(),
): string {
  const queryOverride = queryParamGameServerUrl(browserLocation);
  if (queryOverride) {
    return queryOverride;
  }
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

/**
 * Read and validate the `?gameServer=` query parameter from the given
 * browser location.
 *
 * @returns the trimmed `ws://`/`wss://` URL, or `null` when the parameter is
 *          absent, empty, or not a valid WebSocket URL.
 */
function queryParamGameServerUrl(
  browserLocation: BrowserLocationLike | undefined,
): string | null {
  const search = browserLocation?.search?.trim();
  if (!search) {
    return null;
  }
  // `URLSearchParams` accepts the query with or without the leading `?`.
  let value: string | null = null;
  try {
    value = new URLSearchParams(search).get(GAME_SERVER_URL_QUERY_PARAM);
  } catch {
    return null;
  }
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return /^wss?:\/\//i.test(trimmed) ? trimmed : null;
}
