/**
 * @deprecated REMOVED — The legacy `network/reconciliation/` stack has been
 * consolidated into `game/network/`.
 *
 * The canonical prediction + reconciliation pipeline now lives at:
 *   `apps/web/src/game/network/predictionOrchestrator.ts`
 *
 * Import from `game/network` instead:
 * ```ts
 * import {
 *   PredictionOrchestrator,
 *   SIMULATION_TICK_SECONDS,
 *   type PredictedState,
 * } from "game/network";
 * ```
 */
export {};
