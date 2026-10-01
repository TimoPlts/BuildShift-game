/**
 * @deprecated This module is a thin re-export for backward compatibility.
 *
 * The canonical implementation lives in `@/network/twoPlayer`.
 * Import directly from there instead:
 *
 * ```ts
 * import { InputSender, type InputSample, type BufferedInput } from "@/network/twoPlayer";
 * ```
 */
export {
  InputSender,
  INPUT_BUFFER_SIZE,
  type InputSample,
  type BufferedInput,
} from "../network/twoPlayer/InputSender";
