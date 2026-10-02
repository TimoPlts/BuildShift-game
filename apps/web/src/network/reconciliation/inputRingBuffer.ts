/**
 * @deprecated REMOVED — The legacy `network/reconciliation/` stack has been
 * consolidated into `game/network/`.
 *
 * The canonical input batching (ring buffer, sequence management) now lives at:
 *   `apps/web/src/game/network/inputBatcher.ts`
 *
 * Import from `game/network` instead:
 * ```ts
 * import { InputBatcher, type InputSample, type BufferedInput } from "game/network";
 * ```
 */
export {};
