/**
 * @deprecated This module has been consolidated into
 * `apps/web/src/network/twoPlayer/`. Use {@link LocalPlayerPrediction}
 * from `@/network/twoPlayer` instead.
 *
 * The old `LocalPlayerPredictor` applied hard-snap reconciliation at a
 * 0.01 m epsilon. The canonical version in `network/twoPlayer` uses a
 * smooth correction model: snap for corrections > 0.5 m, otherwise lerp
 * over 5 render frames. It also shares movement config from
 * `@buildshift/game-config` directly.
 */
export {};
