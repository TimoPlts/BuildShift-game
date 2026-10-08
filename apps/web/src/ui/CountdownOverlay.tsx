/**
 * CountdownOverlay — a presentation-only pre-round round-intro and countdown
 * display.
 *
 * Shows:
 *  - the authoritative round number (e.g. "ROUND 2")
 *  - a player-color legend for spawn-side readability (green = YOU,
 *    red = OPPONENT)
 *  - a large centered countdown number (3, 2, 1) that animates (pops in
 *    and fades out) each time the value changes
 *  - a brief "GO!" flash when the countdown completes and play begins
 *
 * When `phase` is `"go"` the overlay presents the transition-to-live-play
 * moment ("GO!") before unmounting. The parent controls the phase: set
 * `phase="counting"` during `RoundState.COUNTDOWN` and `phase="go"` for
 * the brief post-countdown transition window.
 *
 * This component is purely presentational. All data is supplied via
 * explicit props; the component performs no networking, no runtime
 * queries, and no side effects beyond rendering.
 *
 * Example usage:
 * ```tsx
 * {phase === RoundState.COUNTDOWN && countdownSeconds > 0 && (
 *   <CountdownOverlay remainingSeconds={2} roundNumber={3} visible={true} phase="counting" />
 * )}
 * ```
 */

import "./match-lifecycle.css";

/** The presentation phase of the overlay. */
export type CountdownPhase = "counting" | "go";

/**
 * Explicit props for the CountdownOverlay component.
 */
export interface CountdownOverlayProps {
  /** The remaining countdown time in whole seconds (e.g. 3, 2, 1). */
  remainingSeconds: number;
  /**
   * Whether the overlay should be rendered. Set to `false` when the
   * match transitions from COUNTDOWN to PLAYING to remove the overlay.
   */
  visible: boolean;
  /** The 1-based round number about to begin (or 0 for the first round). */
  roundNumber?: number;
  /**
   * The presentation phase: `"counting"` shows the round number + color
   * legend + countdown; `"go"` shows the brief "GO!" transition flash.
   */
  phase?: CountdownPhase;
}

/**
 * A presentation-only countdown / round-intro overlay.
 *
 * During the `"counting"` phase it shows the round number, a player-color
 * legend for spawn-side identification, and the large countdown number
 * with a pop-and-fade animation (re-keyed on `remainingSeconds` so each
 * tick re-triggers the CSS animation).
 *
 * During the `"go"` phase it shows a large "GO!" text that fades in and
 * scales up — the clean transition from the countdown into live play.
 */
export function CountdownOverlay(props: CountdownOverlayProps): JSX.Element | null {
  const { remainingSeconds, visible, roundNumber, phase = "counting" } = props;

  if (!visible) {
    return null;
  }

  // ── GO transition phase ──────────────────────────────────────────────
  if (phase === "go") {
    return (
      <div className="countdown-overlay countdown-overlay--go" role="status" aria-live="assertive">
        <div className="countdown-overlay__go">GO!</div>
      </div>
    );
  }

  // ── Counting phase ───────────────────────────────────────────────────
  if (remainingSeconds <= 0) {
    return null;
  }

  return (
    <div className="countdown-overlay" role="status" aria-live="assertive">
      {roundNumber !== undefined && roundNumber > 0 && (
        <span className="countdown-overlay__round">ROUND {roundNumber}</span>
      )}
      <div
        key={remainingSeconds}
        className="countdown-overlay__number"
        aria-label={`${remainingSeconds} second${remainingSeconds !== 1 ? "s" : ""} remaining`}
      >
        {remainingSeconds}
      </div>
      <div className="countdown-overlay__legend" aria-label="Player colors">
        <span className="countdown-overlay__legend-item countdown-overlay__legend-item--local">
          <span className="countdown-overlay__legend-dot countdown-overlay__legend-dot--local" />
          YOU
        </span>
        <span className="countdown-overlay__legend-sep" aria-hidden="true">vs</span>
        <span className="countdown-overlay__legend-item countdown-overlay__legend-item--remote">
          <span className="countdown-overlay__legend-dot countdown-overlay__legend-dot--remote" />
          OPPONENT
        </span>
      </div>
    </div>
  );
}
