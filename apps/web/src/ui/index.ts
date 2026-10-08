/**
 * UI barrel exports — presentation-only React components for the
 * BuildShift 1v1 Energy Box Fight match lifecycle and HUD overlays.
 *
 * Components are grouped by concern:
 *  - **ScoreBar** — top-center round-win score display
 *  - **CountdownOverlay** — pre-round countdown with animated number
 *  - **RoundEndBanner** — brief round result indicator
 *  - **MatchEndScreen** — full match result with action buttons
 *
 * All components are purely presentational; they accept data via props
 * and perform no networking, no game runtime queries, and no side
 * effects beyond rendering (and invoking callback props).
 */

export { ScoreBar, type ScoreBarProps } from "./ScoreBar";
export { CountdownOverlay, type CountdownOverlayProps, type CountdownPhase } from "./CountdownOverlay";
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
