/**
 * RoundEndBanner — a presentation-only banner indicating which player
 * won the most recently completed round.
 *
 * The banner appears centered on the screen with a "ROUND WON" or
 * "ROUND LOST" message (from the local player's perspective) along with
 * the round number. It uses a CSS fade-in animation for visual polish.
 *
 * In addition to the result, the banner can present:
 *  - the authoritative reason the round ended (e.g. "OPPONENT STALLED",
 *    "TIME UP", "YOU WERE ELIMINATED") via `roundEndReason`, and
 *  - the updated post-round score via `localScore` / `remoteScore`.
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
 *     roundEndReason="anti_stall_timeout"
 *     localScore={2}
 *     remoteScore={1}
 *   />
 * )}
 * ```
 */

import "./match-lifecycle.css";
import type { RoundEndReason } from "@buildshift/protocol";
import { roundEndReasonLabel } from "./MatchHud";

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
  /**
   * The authoritative reason the round ended. When provided, a subtitle
   * explaining the outcome (anti-stall timeout, time up, elimination, or
   * disconnect) is rendered beneath the title.
   */
  roundEndReason?: RoundEndReason | null;
  /**
   * The local player's round-win count after this round. When provided
   * together with `remoteScore`, a post-round score line is rendered.
   */
  localScore?: number;
  /**
   * The remote player's round-win count after this round. When provided
   * together with `localScore`, a post-round score line is rendered.
   */
  remoteScore?: number;
}

/**
 * A presentation-only round-result banner.
 *
 * Renders a centered overlay panel with a large "ROUND WON" / "ROUND LOST"
 * title, an optional subtitle describing the authoritative round-end reason,
 * and a subtitle showing which round just ended (and the updated score).
 *
 * The parent (via `useMatchPresentation`) keeps the banner mounted briefly
 * with `visible={false}` after the authoritative phase has left ROUND_OVER so
 * the exit transition can play before the banner unmounts; while leaving, the
 * banner is kept out of the accessibility tree.
 */
export function RoundEndBanner(props: RoundEndBannerProps): JSX.Element | null {
  const { localWon, visible, roundNumber, roundEndReason, localScore, remoteScore } =
    props;

  const leaving = visible !== true;

  const reasonLabel = roundEndReasonLabel(roundEndReason, localWon);

  const showScore =
    typeof localScore === "number" && typeof remoteScore === "number";

  return (
    <div
      className={`round-end-banner ${leaving ? "round-end-banner--leaving" : ""}`}
      role="status"
      aria-live={leaving ? "off" : "assertive"}
      aria-hidden={leaving || undefined}
      aria-label={
        localWon ? "You won the round" : "You lost the round"
      }
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

      {reasonLabel && (
        <span className="round-end-banner__reason">{reasonLabel}</span>
      )}

      <span className="round-end-banner__round-info">
        {showScore
          ? `Round ${roundNumber > 0 ? roundNumber : ""} complete — ${localScore}:${remoteScore}`
          : `Round ${roundNumber > 0 ? roundNumber : ""} complete`}
      </span>
    </div>
  );
}