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
 *   WeaponNetworkClient,
 *   reconcileHealthDisplay,
 * } from "./game/network";
 * ```
 *
 * This is the SINGLE canonical networking path for the GameRuntime.
 * All multiplayer interaction flows through these modules.
 */

// ── NetworkClient (the Colyseus transport) ────────────────────────────────────
export {
  NetworkClient,
  parseRoomState,
  ROOM_NAME,
  INPUT_MESSAGE_TYPE,
  WEAPON_SWITCH_MESSAGE,
  WEAPON_RELOAD_MESSAGE,
  WEAPON_STATE_EVENT,
  BUILD_EDIT_MESSAGE,
  COMBAT_HIT_EVENT,
  COMBAT_ELIMINATED_EVENT,
  type NetworkClientOptions,
  type RoomLike,
  type ParsedRoomState,
  type ParsedPlayerState,
} from "./NetworkClient";

// ── Replicated player collection parsing (client-side) ─────────────────────────
export {
  parsePlayers,
  parsePlayerEntry,
} from "./playerStateParse";

// ── Replicated building state parsing (client-side) ───────────────────────────
export {
  parseBuildingState,
  parseStructureState,
  parseStructureDurability,
  parseStructureDurabilities,
  EMPTY_BUILDING_STATE,
  EMPTY_STRUCTURE_DURABILITIES,
} from "./structureStateParse";

// ── Authoritative match/round state parsing (client-side) ─────────────────────
export {
  parseMatchState,
  type ParsedMatchState,
} from "./matchStateParse";

// ── Match-lifecycle broadcast event names (client-side mirror of server) ──────
export {
  MATCH_COUNTDOWN_TICK_EVENT,
  MATCH_ROUND_OVER_EVENT,
  MATCH_ROUND_TIMER_EVENT,
  MATCH_END_EVENT,
  REMATCH_REQUEST_MESSAGE,
  REMATCH_ACCEPTED_EVENT,
  REMATCH_DECLINED_EVENT,
  type CountdownTickPayload,
  type RoundOverPayload,
  type RoundTimerPayload,
  type MatchEndPayload,
  type RematchAcceptedPayload,
} from "./matchEvents";

// ── Match-loop reset detection (pure, testable) ───────────────────────────────
export {
  computeMatchReset,
  INITIAL_MATCH_SNAPSHOT,
  type MatchStateSnapshot,
  type MatchResetDecision,
} from "./matchReset";

// ── Server URL resolution ─────────────────────────────────────────────────────
export {
  DEFAULT_GAME_SERVER_URL,
  GAME_SERVER_URL_ENV,
  resolveGameServerUrl,
  type ServerUrlEnv,
} from "./serverUrl";

// ── InputBatcher (sequenced input send) ───────────────────────────────────────
export {
  InputBatcher,
  INPUT_BUFFER_SIZE,
  type InputSample,
  type BufferedInput,
} from "./inputBatcher";

// ── PredictionOrchestrator (local prediction + reconciliation) ───────────────
export {
  PredictionOrchestrator,
  SIMULATION_TICK_SECONDS,
  CORRECTION_SNAP_THRESHOLD,
  CORRECTION_SMOOTH_FRAMES,
  type PredictedState,
  type LocalCombatState,
  type FirePredictionResult,
} from "./predictionOrchestrator";

// ── RemotePlayerManager (remote interpolation buffer) ─────────────────────────
export {
  RemotePlayerManager,
  REMOTE_INTERPOLATION_DELAY_MS,
  REMOTE_BUFFER_SIZE,
  type TimedRemoteState,
  type InterpolatedRemoteState,
} from "./RemotePlayerManager";

// ── Reconciliation helpers ────────────────────────────────────────────────────
export {
  reconcileHealthDisplay,
  shouldShowElimination,
  type AuthoritativeCombatData,
} from "./reconciliation";

// ── WeaponNetworkClient (canonical weapon/build-edit network bridge) ──────────
export {
  WeaponNetworkClient,
  type WeaponInputFrame,
} from "../player/WeaponNetworkClient";

// ── WeaponPrediction (local weapon state prediction / reconciliation) ────────
// NOTE: `FirePredictionResult` from WeaponPrediction is intentionally NOT
// re-exported here to avoid a name collision with the movement-layer
// `FirePredictionResult` from predictionOrchestrator. Import it directly
// from "../player/WeaponPrediction" if needed.
export {
  WeaponPrediction,
  type LocalWeaponState,
  type SwitchPredictionResult,
  type ReloadPredictionResult,
  type AuthoritativeWeaponState,
} from "../player/WeaponPrediction";

// ── Factory ───────────────────────────────────────────────────────────────────
export {
  createGameNetworking,
  type GameNetworking,
} from "./createGameNetworking";
