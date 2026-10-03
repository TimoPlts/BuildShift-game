/**
 * ScoreBar — a presentation-only score display for the 1v1 Energy Box Fight
 * match lifecycle.
 *
 * Shows both players' round-win counts as a set of pips (filled = won)
 * alongside a numeric score display and the current round number.
 *
 * This component is purely presentational. All data is supplied via
 * explicit props; the component performs no networking, no runtime
 * queries, and no side effects beyond rendering.
 *
 * Example usage:
 * ```tsx
 * <ScoreBar
 *   localScore={2}
 *   remoteScore={1}
 *   currentRound={4}
 *   roundsToWin={3}
 * />
 * ```
 */

import "./match-lifecycle.css";

/**
 * Explicit props for the ScoreBar component.
 */
export interface ScoreBarProps {
  /** The local player's accumulated round-win count. */
  localScore: number;
  /** The remote player's accumulated round-win count. */
  remoteScore: number;
  /** The 1-based number of the current round. */
  currentRound: number;
  /** The number of rounds needed to win the match. */
  roundsToWin: number;
}

/**
 * A presentation-only score bar showing both players' round-win progress.
 *
 * Renders a fixed-position overlay at the top-center of the viewport with
 * pip indicators for each player and a numeric score in the center.
 */
export function ScoreBar(props: ScoreBarProps): JSX.Element {
  const { localScore, remoteScore, currentRound, roundsToWin } = props;

  return (
    <div className="score-bar" aria-live="polite" aria-label="Match score">
      {/* ── Local player side ── */}
      <div className="score-bar__side">
        <span className="score-bar__label">You</span>
        <div className="score-bar__pips" aria-label={`You have won ${localScore} rounds`}>
          {Array.from({ length: roundsToWin }, (_, i) => (
            <span
              key={i}
              className={`score-bar__pip ${
                i < localScore ? "score-bar__pip--won-local" : ""
              }`}
            />
          ))}
        </div>
      </div>

      {/* ── Center: round + numeric score ── */}
      <div className="score-bar__center">
        <span className="score-bar__round">
          Round {currentRound > 0 ? currentRound : "—"}
        </span>
        <span className="score-bar__score-display">
          {localScore} : {remoteScore}
        </span>
      </div>

      {/* ── Remote player side ── */}
      <div className="score-bar__side">
        <span className="score-bar__label">Opponent</span>
        <div className="score-bar__pips" aria-label={`Opponent has won ${remoteScore} rounds`}>
          {Array.from({ length: roundsToWin }, (_, i) => (
            <span
              key={i}
              className={`score-bar__pip ${
                i < remoteScore ? "score-bar__pip--won-remote" : ""
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
