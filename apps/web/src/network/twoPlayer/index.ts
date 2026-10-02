/**
 * Public entry point for the Stage 2D two-player movement networking layer.
 *
 * Import from here (never reach into individual files) so the boundary
 * stays clean:
 *
 * ```ts
 * import {
 *   TwoPlayerClient,
 *   InputSender,
 *   LocalPlayerPrediction,
 *   RemotePlayerInterpolation,
 * } from "../network/twoPlayer";
 * ```
 */

export {
  TwoPlayerClient,
  parseRoomState,
  TWO_PLAYER_ROOM_NAME,
  MOVEMENT_INPUT_TYPE,
  COMBAT_HIT_EVENT,
  COMBAT_ELIMINATED_EVENT,
  type TwoPlayerClientOptions,
  type RoomLike,
  type ParsedRoomState,
  type ParsedPlayerState,
} from "./TwoPlayerClient";

export {
  InputSender,
  INPUT_BUFFER_SIZE,
  type InputSample,
  type BufferedInput,
} from "./InputSender";

export {
  LocalPlayerPrediction,
  SIMULATION_TICK_SECONDS,
  CORRECTION_SNAP_THRESHOLD,
  CORRECTION_SMOOTH_FRAMES,
  type PredictedState,
  type LocalCombatState,
  type FirePredictionResult,
} from "./LocalPlayerPrediction";

export {
  RemotePlayerInterpolation,
  REMOTE_INTERPOLATION_DELAY_MS,
  REMOTE_BUFFER_SIZE,
  type TimedRemoteState,
  type InterpolatedRemoteState,
} from "./RemotePlayerInterpolation";
