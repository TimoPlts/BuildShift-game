/**
 * MatchEndScreen — a presentation-only full-screen overlay displayed
 * when the match has ended (a player reached the round-win threshold).
 *
 * Shows:
 *  - A large "VICTORY" or "DEFEAT" title (local player perspective)
 *  - The final score
 *  - "Play Again" and "Leave" action buttons
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
 *     onPlayAgain={() => restartMatch()}
 *     onLeave={() => leaveRoom()}
 *   />
 * )}
 * ```
 */

import "./match-lifecycle.css";

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
  /** Callback invoked when the user clicks "Play Again". */
  onPlayAgain: () => void;
  /** Callback invoked when the user clicks "Leave". */
  onLeave: () => void;
}

/**
 * A presentation-only full-screen match result overlay.
 *
 * Renders a centered panel with the match outcome, final score,
 * and action buttons for restarting or leaving the match.
 */
export function MatchEndScreen(props: MatchEndScreenProps): JSX.Element {
  const { localWon, localScore, remoteScore, onPlayAgain, onLeave } = props;

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

        {/* ── Final score ── */}
        <div className="match-end-screen__score">
          <span className="match-end-screen__score-label">Final Score</span>
          <span>
            {localScore} — {remoteScore}
          </span>
        </div>

        {/* ── Action buttons ── */}
        <div className="match-end-screen__actions">
          <button
            type="button"
            className="match-end-screen__btn match-end-screen__btn--primary"
            onClick={onPlayAgain}
          >
            Play Again
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
