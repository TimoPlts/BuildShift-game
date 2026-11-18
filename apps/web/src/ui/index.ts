/**
 * UI barrel exports — presentation-only React components for the
 * BuildShift 1v1 Energy Box Fight match lifecycle and HUD overlays.
 *
 * Components are grouped by concern:
 *  - **ScoreBar** — top-center round-win score display
 *  - **CountdownOverlay** — post-countdown (gate-opening) cue, plus a legacy
 *    full-attention countdown phase kept for non-production callers
 *  - **PreparationBanner** — the compact build-preparation phase strip (the
 *    only clock a player sees)
 *  - **RoundEndBanner** — brief round result indicator
 *  - **MatchEndScreen** — full match result with action buttons
 *
 * All components are purely presentational; they accept data via props
 * and perform no networking, no game runtime queries, and no side
 * effects beyond rendering (and invoking callback props).
 */

export { ScoreBar, type ScoreBarProps } from "./ScoreBar";
export { CountdownOverlay, type CountdownOverlayProps, type CountdownPhase } from "./CountdownOverlay";
export {
  PreparationBanner,
  type PreparationBannerProps,
} from "./PreparationBanner";
export {
  derivePreparationUi,
  preparationSideHint,
  NO_PREPARATION,
  PREPARATION_PHASE_LABEL,
  PREPARATION_OPENING_LABEL,
  READY_PHASE_LABEL,
  WAITING_PHASE_LABEL,
  FIGHT_CUE_LABEL,
  type PreparationUiSource,
  type PreparationUiState,
  type PreparationUiMode,
  type PreparationSide,
} from "./preparationPresentation";
export { RoundEndBanner, type RoundEndBannerProps } from "./RoundEndBanner";
export { MatchEndScreen, type MatchEndScreenProps } from "./MatchEndScreen";
export {
  useMatchPresentation,
  type MatchPresentationState,
} from "./useMatchPresentation";
export {
  deriveLifecyclePresentation,
  stepRoundBanner,
  rematchWindowRemaining,
  EMPTY_ROUND_BANNER,
  ROUND_RESULT_EXIT_MS,
  type PresentationMoment,
  type LifecyclePresentation,
  type RoundResultData,
  type MatchResultData,
  type RoundBannerState,
} from "./matchPresentation";
