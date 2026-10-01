/**
 * @deprecated This module is a thin re-export barrel for backward compatibility.
 *
 * The canonical implementation lives in `@/network/twoPlayer`.
 * Import directly from there instead:
 *
 * ```ts
 * import { TwoPlayerClient, InputSender, LocalPlayerPrediction } from "@/network/twoPlayer";
 * ```
 */
export {
  TwoPlayerClient,
  TWO_PLAYER_ROOM_NAME,
  type TwoPlayerClientOptions,
} from "../network/twoPlayer";

export {
  InputSender,
  INPUT_BUFFER_SIZE,
  type InputSample,
  type BufferedInput,
} from "../network/twoPlayer";

export {
  LocalPlayerPrediction,
  SIMULATION_TICK_SECONDS,
  CORRECTION_SNAP_THRESHOLD,
  CORRECTION_SMOOTH_FRAMES,
  type PredictedState,
} from "../network/twoPlayer";
