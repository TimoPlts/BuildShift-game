/**
 * AI Guide backend origin — derived from the *existing* game-server URL
 * configuration, never from a hardcoded deployment host or VM IP.
 *
 * The chat backend (`POST /api/ai-chat`) is served alongside the game server,
 * so the origin is exactly the origin of the resolved game-server URL with
 * the WebSocket scheme mapped to its HTTP counterpart:
 *
 *  - `ws://host:port`  → `http://host:port`
 *  - `wss://host:port` → `https://host:port`
 *
 * The resolved value comes from `resolveGameServerUrl` (`VITE_GAME_SERVER_URL`
 * or the local-dev fallback `ws://localhost:2567`), so there is a single
 * source of configuration for both the authoritative game traffic and the
 * AI Guide endpoint.
 */
import { resolveGameServerUrl, type ServerUrlEnv } from "../../network/colyseus/serverUrl";

/**
 * Derive the HTTP(S) origin that serves `/api/ai-chat` from the game-server
 * URL configuration.
 *
 * @param environment env-like object (defaults to Vite's `import.meta.env`).
 * @returns an origin string such as `http://localhost:2567` (no trailing slash).
 * @throws when the configured game-server URL cannot be mapped to an HTTP(S) origin.
 */
export function resolveAiChatOrigin(
  environment?: ServerUrlEnv,
): string {
  const gameServerUrl = resolveGameServerUrl(environment);
  const parsed = new URL(gameServerUrl);
  switch (parsed.protocol) {
    case "ws:":
      return `http://${parsed.host}`;
    case "wss:":
      return `https://${parsed.host}`;
    case "http:":
    case "https:":
      return parsed.origin;
    default:
      throw new Error(
        `Cannot derive the AI Guide origin from the game server URL: ${gameServerUrl}`,
      );
  }
}

/** The full `/api/ai-chat` endpoint for the given environment. */
export function aiChatEndpoint(environment?: ServerUrlEnv): string {
  return `${resolveAiChatOrigin(environment)}/api/ai-chat`;
}
