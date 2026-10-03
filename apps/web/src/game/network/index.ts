/**
 * Public entry point for the canonical game networking layer.
 *
 * Import from here (never reach into individual files) so the boundary
 * stays clean:
 *
 * ```ts
 * import {
 *   NetworkClient,
 *   InputBatcher,
 *   PredictionOrchestrator,
 *   RemotePlayerManager,
 *   reconcileHealthDisplay,
 * } from "./game/network";
 * ```
 *
 * This is the SINGLE canonical networking path for the GameRuntime.
 * All multiplayer interaction flows through these modules.
 */

// ── NetworkClient (the Colyseus transport) ─────────────────────────────────
export {
  NetworkClient,
  parseRoomState,
  ROOM_NAME,
  INPUT_MESSAGE_TYPE,
  COMBAT_HIT_EVENT,
  COMBAT_ELIMINATED_EVENT,
  type NetworkClientOptions,
  type RoomLike,
  type ParsedRoomState,
  type ParsedPlayerState,
} from "./NetworkClient";

// ── Replicated player collection parsing (client-side) ─────────────────────
export {
  parsePlayers,
  parsePlayerEntry,
} from "./playerStateParse";

// ── Replicated building state parsing (client-side) ────────────────────────
export {
  parseBuildingState,
  parseStructureState,
  EMPTY_BUILDING_STATE,
} from "./structureStateParse";

// ── Authoritative match/round state parsing (client-side) ──────────────────
export {
  parseMatchState,
  type ParsedMatchState,
} from "./matchStateParse";

// ── Match-loop reset detection (pure, testable) ────────────────────────────
export {
  computeMatchReset,
  INITIAL_MATCH_SNAPSHOT,
  type MatchStateSnapshot,
  type MatchResetDecision,
} from "./matchReset";

// ── Server URL resolution ──────────────────────────────────────────────────
export {
  DEFAULT_GAME_SERVER_URL,
  GAME_SERVER_URL_ENV,
  resolveGameServerUrl,
  type ServerUrlEnv,
} from "./serverUrl";

// ── InputBatcher (sequenced input send) ────────────────────────────────────
export {
  InputBatcher,
  INPUT_BUFFER_SIZE,
  type InputSample,
  type BufferedInput,
} from "./inputBatcher";

// ── PredictionOrchestrator (local prediction + reconciliation) ─────────────
export {
  PredictionOrchestrator,
  SIMULATION_TICK_SECONDS,
  CORRECTION_SNAP_THRESHOLD,
  CORRECTION_SMOOTH_FRAMES,
  type PredictedState,
  type LocalCombatState,
  type FirePredictionResult,
} from "./predictionOrchestrator";

// ── RemotePlayerManager (remote interpolation buffer) ──────────────────────
export {
  RemotePlayerManager,
  REMOTE_INTERPOLATION_DELAY_MS,
  REMOTE_BUFFER_SIZE,
  type TimedRemoteState,
  type InterpolatedRemoteState,
} from "./RemotePlayerManager";

// ── Reconciliation helpers ─────────────────────────────────────────────────
export {
  reconcileHealthDisplay,
  shouldShowElimination,
  type AuthoritativeCombatData,
} from "./reconciliation";

// ── Factory ────────────────────────────────────────────────────────────────
export {
  createGameNetworking,
  type GameNetworking,
} from "./createGameNetworking";
