/// <reference types="vite/client" />

/**
 * Vite build-time environment variables exposed to the web app.
 *
 * `VITE_GAME_SERVER_URL` (optional) points the browser client at the game
 * server's WebSocket endpoint. When unset, the network layer falls back to
 * `ws://localhost:2567` (see `apps/web/src/network/colyseus/serverUrl.ts`).
 *
 * This declaration only *augments* Vite's own `ImportMetaEnv` (which already
 * has a catch-all index signature); it documents the one variable the app
 * actually reads and gives it a precise type.
 */
interface ImportMetaEnv {
  /** WebSocket URL of the BuildShift game server, e.g. `ws://localhost:2567`. */
  readonly VITE_GAME_SERVER_URL?: string;
}
