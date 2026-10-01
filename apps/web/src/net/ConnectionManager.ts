/**
 * @deprecated This module is a thin re-export for backward compatibility.
 *
 * The canonical implementation lives in `@/network/twoPlayer` as
 * `TwoPlayerClient`. Import directly from there instead:
 *
 * ```ts
 * import { TwoPlayerClient, type TwoPlayerClientOptions } from "@/network/twoPlayer";
 * ```
 */
export { TwoPlayerClient, TWO_PLAYER_ROOM_NAME } from "../network/twoPlayer/TwoPlayerClient";
export type { TwoPlayerClientOptions } from "../network/twoPlayer/TwoPlayerClient";
