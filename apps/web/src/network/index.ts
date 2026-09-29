/**
 * Public entry point for the browser networking layer.
 *
 * Import from here (never reach into `colyseus/` directly) so the layer's
 * boundary stays clean:
 *
 * ```ts
 * import {
 *   createFoundationNetwork,
 *   type FoundationNetwork,
 *   type NetworkUiState,
 * } from "./network";
 * ```
 *
 * The concrete `@colyseus/sdk` import is confined to
 * `createFoundationNetwork.ts`; everything the rest of the app (React UI,
 * `GameRuntime`) sees is the framework-agnostic {@link FoundationNetwork}
 * interface.
 */

export { createFoundationNetwork } from "./createFoundationNetwork";
export { getFoundationNetwork } from "./networkInstance";
export {
  FoundationNetwork,
  type FoundationNetworkOptions,
  type NetworkUiState,
} from "./colyseus/foundationNetwork";
export {
  computeNextConnectionState,
  type ConnectionEvent,
  type ConnectionState,
} from "./colyseus/connectionState";
export {
  countPlayers,
  mapPlayersToSnapshot,
  type ClientPlayerSnapshot,
  type PlayerSnapshotMap,
} from "./colyseus/playerSnapshot";
export {
  DEFAULT_GAME_SERVER_URL,
  GAME_SERVER_URL_ENV,
  resolveGameServerUrl,
} from "./colyseus/serverUrl";
