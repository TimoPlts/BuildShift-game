/**
 * RoundEndBanner — a presentation-only banner indicating which player
 * won the most recently completed round.
 *
 * The banner appears centered on the screen with a "ROUND WON" or
 * "ROUND LOST" message (from the local player's perspective) along with
 * the round number. It uses a CSS fade-in animation for visual polish.
 *
 * The parent controls visibility: set `visible={true}` when the match
 * state is `RoundState.ROUND_OVER` and `visible={false}` once the next
 * countdown begins or the match ends.
 *
 * This component is purely presentational. All data is supplied via
 * explicit props; the component performs no networking, no runtime
 * queries, and no side effects beyond rendering.
 *
 * Example usage:
 * ```tsx
 * {phase === RoundState.ROUND_OVER && localWonLastRound !== null && (
 *   <RoundEndBanner
 *     localWon={localWonLastRound}
 *     visible={true}
 *     roundNumber={3}
 *   />
 * )}
 * ```
 */

import "./match-lifecycle.css";

/**
 * Explicit props for the RoundEndBanner component.
 */
export interface RoundEndBannerProps {
  /** Whether the local player won the most recently completed round. */
  localWon: boolean;
  /** Whether the banner should be rendered. */
  visible: boolean;
  /** The 1-based round number that just completed. */
  roundNumber: number;
}

/**
 * A presentation-only round-result banner.
 *
 * Renders a centered overlay panel with a large "ROUND WON" / "ROUND LOST"
 * title and a subtitle showing which round just ended.
 */
export function RoundEndBanner(props: RoundEndBannerProps): JSX.Element | null {
  const { localWon, visible, roundNumber } = props;

  if (!visible) {
    return null;
  }

  return (
    <div
      className="round-end-banner"
      role="status"
      aria-live="assertive"
      aria-label={localWon ? "You won the round" : "You lost the round"}
    >
      <span
        className={`round-end-banner__title ${
          localWon
            ? "round-end-banner__title--won"
            : "round-end-banner__title--lost"
        }`}
      >
        {localWon ? "ROUND WON" : "ROUND LOST"}
      </span>
      <span className="round-end-banner__round-info">
        Round {roundNumber > 0 ? roundNumber : ""} complete
      </span>
    </div>
  );
}
