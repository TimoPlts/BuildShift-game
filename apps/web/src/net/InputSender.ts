/**
 * Legacy re-export shim for InputSender.
 *
 * The canonical implementation lives in `../network/twoPlayer/InputSender`.
 * This file adds zero logic — it only re-exports the same bindings.
 */
export {
  InputSender,
  INPUT_BUFFER_SIZE,
  type InputSample,
  type BufferedInput,
} from "../network/twoPlayer/InputSender";
