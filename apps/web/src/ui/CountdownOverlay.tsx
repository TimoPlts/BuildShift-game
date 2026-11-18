/**
 * CountdownOverlay — a presentation-only countdown / transition overlay.
 *
 * **Current role (round-preparation batch):** in production this component
 * presents only the brief gate-opening cue (the `"go"` phase, labelled "FIGHT"
 * by the App shell) shown when build preparation ends and the arena opens.
 *
 * The `"counting"` phase is retained as a **legacy fallback** for callers that
 * still want a full-attention pre-round intro, but the App shell no longer
 * renders it: the build-preparation window is presented by the compact,
 * pointer-transparent `PreparationBanner`, so players can see and build
 * through it instead of having the arena and crosshair hidden behind an
 * opaque full-screen countdown.
 *
 * Shows:
 *  - the authoritative round number (e.g. "ROUND 2")
 *  - a player-color legend for spawn-side readability (green = YOU,
 *    red = OPPONENT)
 *  - a large centered countdown number (3, 2, 1) that animates (pops in
 *    and fades out) each time the value changes
 *  - a brief cue ("GO!" / "FIGHT") when the countdown completes and play begins
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
   * legend + countdown; `"go"` shows the brief gate-opening transition flash.
   */
  phase?: CountdownPhase;
  /**
   * The cue word for the `"go"` phase (default `"GO!"`). The App shell passes
   * the FIGHT cue so the barrier-drop moment reads as the start of an untimed
   * fight.
   */
  goLabel?: string;
}

/**
 * A presentation-only countdown / round-intro overlay.
 *
 * During the `"counting"` phase it shows the round number, a player-color
 * legend for spawn-side identification, and the large countdown number
 * with a pop-and-fade animation (re-keyed on `remainingSeconds` so each
 * tick re-triggers the CSS animation).
 *
 * During the `"go"` phase it shows a large cue word (`goLabel`, default "GO!")
 * that fades in and scales up — the clean transition from preparation into
 * live play.
 */
export function CountdownOverlay(props: CountdownOverlayProps): JSX.Element | null {
  const {
    remainingSeconds,
    visible,
    roundNumber,
    phase = "counting",
    goLabel = "GO!",
  } = props;

  if (!visible) {
    return null;
  }

  // ── GO transition phase ──────────────────────────────────────────────
  if (phase === "go") {
    return (
      <div className="countdown-overlay countdown-overlay--go" role="status" aria-live="assertive">
        <div className="countdown-overlay__go">{goLabel}</div>
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
