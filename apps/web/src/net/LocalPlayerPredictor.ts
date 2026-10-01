/**
 * Legacy re-export shim for LocalPlayerPredictor.
 *
 * The canonical implementation is now called `LocalPlayerPrediction` and
 * lives in `../network/twoPlayer/LocalPlayerPrediction`. This shim
 * re-exports it under the old name for backward compatibility.
 *
 * This file adds zero logic — it only re-exports the same bindings.
 */
export {
  LocalPlayerPrediction as LocalPlayerPredictor,
  SIMULATION_TICK_SECONDS,
  CORRECTION_SNAP_THRESHOLD,
  CORRECTION_SMOOTH_FRAMES,
  type PredictedState,
} from "../network/twoPlayer/LocalPlayerPrediction";
