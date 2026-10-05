/**
 * MatchEndScreen — a presentation-only full-screen overlay displayed
 * when the match has ended (a player reached the round-win threshold).
 *
 * Shows:
 *  - A large "VICTORY" or "DEFEAT" title (local player perspective)
 *  - An optional explicit winner label (`matchWinnerLabel`)
 *  - The reason the deciding round ended (e.g. "TIME UP", "OPPONENT STALLED")
 *  - The final score (and optional total rounds played)
 *  - A rematch-readiness status (open / available / window closed)
 *  - "Play Again"/"Rematch" and "Leave" action buttons
 *
 * The parent controls when this screen is shown by conditionally
 * rendering it based on the match state being `RoundState.MATCH_OVER`.
 *
 * This component is purely presentational. All data is supplied via
 * explicit props; the component performs no networking, no runtime
 * queries, and no side effects beyond rendering and invoking the
 * callback props.
 *
 * Example usage:
 * ```tsx
 * {phase === RoundState.MATCH_OVER && localWonMatch !== null && (
 *   <MatchEndScreen
 *     localWon={localWonMatch}
 *     localScore={3}
 *     remoteScore={1}
 *     rematchAvailable={true}
 *     rematchWindowSeconds={24}
 *     totalRounds={4}
 *     finalRoundReason="anti_stall_timeout"
 *     onPlayAgain={() => requestRematch()}
 *     onLeave={() => leaveRoom()}
 *   />
 * )}
 * ```
 */

import "./match-lifecycle.css";
import type { RoundEndReason } from "@buildshift/protocol";
import { roundEndReasonLabel } from "./MatchHud";

/**
 * Explicit props for the MatchEndScreen component.
 */
export interface MatchEndScreenProps {
  /** Whether the local player won the match. */
  localWon: boolean;
  /** The local player's final round-win count. */
  localScore: number;
  /** The remote player's final round-win count. */
  remoteScore: number;
  /** Callback invoked when the user clicks "Play Again" / "Rematch". */
  onPlayAgain: () => void;
  /** Callback invoked when the user clicks "Leave". */
  onLeave: () => void;
  /**
   * Whether a rematch is currently available (within the server's rematch
   * window and not yet accepted). Drives the rematch-readiness status and
   * the primary button label.
   */
  rematchAvailable?: boolean;
  /**
   * Seconds remaining in the rematch-acceptance window (when known). When
   * provided and > 0, the status line counts down the window.
   */
  rematchWindowSeconds?: number;
  /**
   * An optional explicit label describing the match winner (e.g. a player
   * name or id). Rendered as a small line beneath the result title.
   */
  matchWinnerLabel?: string;
  /**
   * The total number of rounds played in the match. When provided (and > 0),
   * rendered alongside the final score.
   */
  totalRounds?: number;
  /**
   * The authoritative reason the final (deciding) round ended. When
   * provided, a subtitle explaining the outcome is rendered.
   */
  finalRoundReason?: RoundEndReason | null;
}

/**
 * Derive the rematch-readiness status line from the explicit props.
 *
 * Returns `null` when the state is unknown (no readiness signal supplied),
 * so the line is simply omitted rather than showing misleading text.
 */
function rematchStatusLabel(
  rematchAvailable: boolean | undefined,
  rematchWindowSeconds: number | undefined,
): string | null {
  if (rematchAvailable === false) {
    return "Rematch window closed";
  }
  if (
    typeof rematchWindowSeconds === "number" &&
    Number.isFinite(rematchWindowSeconds) &&
    rematchWindowSeconds > 0
  ) {
    return `Rematch available · ${rematchWindowSeconds}s`;
  }
  if (rematchAvailable === true) {
    return "Rematch available";
  }
  return null;
}

/**
 * A presentation-only full-screen match result overlay.
 *
 * Renders a centered panel with the match outcome, winner label, deciding
 * round reason, final score, rematch-readiness status, and action buttons
 * for restarting or leaving the match.
 */
export function MatchEndScreen(props: MatchEndScreenProps): JSX.Element {
  const {
    localWon,
    localScore,
    remoteScore,
    onPlayAgain,
    onLeave,
    rematchAvailable,
    rematchWindowSeconds,
    matchWinnerLabel,
    totalRounds,
    finalRoundReason,
  } = props;

  const rematchStatus = rematchStatusLabel(
    rematchAvailable,
    rematchWindowSeconds,
  );
  const reasonLabel = roundEndReasonLabel(finalRoundReason, localWon);
  const primaryLabel = rematchAvailable ? "Rematch" : "Play Again";

  return (
    <div
      className="match-end-screen"
      role="dialog"
      aria-modal="true"
      aria-label="Match ended"
    >
      <div className="match-end-screen__panel">
        {/* ── Result title ── */}
        <h1
          className={`match-end-screen__title ${
            localWon
              ? "match-end-screen__title--victory"
              : "match-end-screen__title--defeat"
          }`}
        >
          {localWon ? "Victory" : "Defeat"}
        </h1>

        {/* ── Winner label (optional) ── */}
        {typeof matchWinnerLabel === "string" && matchWinnerLabel !== "" && (
          <p className="match-end-screen__winner">{matchWinnerLabel}</p>
        )}

        {/* ── Deciding-round reason (optional) ── */}
        {reasonLabel && (
          <p className="match-end-screen__reason">{reasonLabel}</p>
        )}

        {/* ── Final score (+ optional total rounds) ── */}
        <div className="match-end-screen__score">
          <span className="match-end-screen__score-label">Final Score</span>
          <span>
            {localScore} — {remoteScore}
          </span>
          {typeof totalRounds === "number" && totalRounds > 0 && (
            <span className="match-end-screen__rounds">
              · {totalRounds} rounds
            </span>
          )}
        </div>

        {/* ── Rematch readiness (optional) ── */}
        {rematchStatus && (
          <p
            className={`match-end-screen__rematch ${
              rematchAvailable
                ? "match-end-screen__rematch--ready"
                : "match-end-screen__rematch--closed"
            }`}
            role="status"
          >
            {rematchStatus}
          </p>
        )}

        {/* ── Action buttons ── */}
        <div className="match-end-screen__actions">
          <button
            type="button"
            className={`match-end-screen__btn match-end-screen__btn--primary ${
              rematchAvailable ? "match-end-screen__btn--rematch-ready" : ""
            }`}
            onClick={onPlayAgain}
          >
            {primaryLabel}
          </button>
          <button
            type="button"
            className="match-end-screen__btn match-end-screen__btn--secondary"
            onClick={onLeave}
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
