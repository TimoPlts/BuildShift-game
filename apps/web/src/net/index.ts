/**
 * @deprecated Legacy barrel for the old `net/` module.
 *
 * The canonical two-player networking layer lives in `@/network/twoPlayer`.
 * This barrel exists only so that any lingering `import ... from "@/net"`
 * or `import ... from "../net"` call-sites continue to resolve.
 *
 * New code MUST import directly from `@/network/twoPlayer`.
 */
export { TwoPlayerClient, TWO_PLAYER_ROOM_NAME } from "./ConnectionManager";
export type { TwoPlayerClientOptions } from "./ConnectionManager";

export { InputSender, INPUT_BUFFER_SIZE } from "./InputSender";
export type { InputSample, BufferedInput } from "./InputSender";

export {
  LocalPlayerPrediction,
  SIMULATION_TICK_SECONDS,
  CORRECTION_SNAP_THRESHOLD,
  CORRECTION_SMOOTH_FRAMES,
} from "./LocalPlayerPredictor";
export type { PredictedState } from "./LocalPlayerPredictor";
