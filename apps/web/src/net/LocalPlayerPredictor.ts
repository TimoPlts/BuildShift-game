/**
 * @deprecated This module is a thin re-export for backward compatibility.
 *
 * The canonical implementation lives in `@/network/twoPlayer` as
 * `LocalPlayerPrediction`. Import directly from there instead:
 *
 * ```ts
 * import { LocalPlayerPrediction, type PredictedState } from "@/network/twoPlayer";
 * ```
 */
export {
  LocalPlayerPrediction,
  SIMULATION_TICK_SECONDS,
  CORRECTION_SNAP_THRESHOLD,
  CORRECTION_SMOOTH_FRAMES,
} from "../network/twoPlayer/LocalPlayerPrediction";
export type { PredictedState } from "../network/twoPlayer/LocalPlayerPrediction";
