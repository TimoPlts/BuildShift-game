/**
 * CountdownOverlay — a presentation-only pre-round countdown display.
 *
 * Shows a large centered countdown number (3, 2, 1) that animates (pops in
 * and fades out) each time the value changes. When `visible` is `false`
 * the overlay is not rendered, so the parent controls when it appears
 * and disappears based on the match lifecycle state.
 *
 * The parent is expected to set `visible={true}` during
 * `RoundState.COUNTDOWN` and `visible={false}` once the state
 * transitions to `RoundState.PLAYING`.
 *
 * This component is purely presentational. All data is supplied via
 * explicit props; the component performs no networking, no runtime
 * queries, and no side effects beyond rendering.
 *
 * Example usage:
 * ```tsx
 * {phase === RoundState.COUNTDOWN && (
 *   <CountdownOverlay remainingSeconds={2} visible={true} />
 * )}
 * ```
 */

import "./match-lifecycle.css";

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
}

/**
 * A presentation-only countdown overlay that displays a large centered
 * number with a pop-and-fade animation.
 *
 * The `key` on the number element is set to `remainingSeconds` so that
 * each time the value changes, React remounts the element and re-triggers
 * the CSS animation.
 */
export function CountdownOverlay(props: CountdownOverlayProps): JSX.Element | null {
  const { remainingSeconds, visible } = props;

  if (!visible || remainingSeconds <= 0) {
    return null;
  }

  return (
    <div className="countdown-overlay" role="status" aria-live="assertive">
      <div
        key={remainingSeconds}
        className="countdown-overlay__number"
        aria-label={`${remainingSeconds} second${remainingSeconds !== 1 ? "s" : ""} remaining`}
      >
        {remainingSeconds}
      </div>
      <span className="countdown-overlay__label">Get Ready</span>
    </div>
  );
}
