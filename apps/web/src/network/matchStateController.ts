/**
 * Re-export from the canonical match state controller location.
 *
 * The authoritative implementation lives in
 * `apps/web/src/game/player/matchStateController.ts`. This module exists
 * for backward compatibility with imports from the network layer.
 */
export {
  MatchStateController,
  type MatchPhaseTransition,
  type MatchOverInfo,
  type RoundResetContext,
  type MatchStateControllerOptions,
} from "../game/player/matchStateController";
