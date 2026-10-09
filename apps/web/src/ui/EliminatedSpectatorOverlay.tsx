/**
 * EliminatedSpectatorOverlay — a presentation-only overlay shown while the
 * local player is eliminated during an active (PLAYING) round.
 *
 * Provides:
 *  - A dark vignette around the screen edges that signals the eliminated
 *    state without fully blocking the 3D view (the player can still watch
 *    the opponent via the stable camera).
 *  - A centered "ELIMINATED" title and "SPECTATING" subtitle.
 *  - A clean fade-in on entry and a fade-out on exit.
 *
 * The parent controls visibility:
 *  - `visible={true}` while `localHud.eliminated === true` AND the match
 *    phase is `IN_PROGRESS` (the overlay is suppressed during COUNTDOWN,
 *    ROUND_OVER, and MATCH_OVER which have their own lifecycle
 *    presentations).
 *  - `visible={false}` during the exit transition (the overlay stays
 *    mounted briefly so the CSS fade-out can complete).
 *
 * This component is purely presentational: no networking, no runtime
 * queries, no side effects beyond rendering.
 */
import "./match-lifecycle.css";

export interface EliminatedSpectatorOverlayProps {
  /** Whether the overlay should be presented as active (visible). */
  visible: boolean;
}

/**
 * A presentation-only overlay for the local player's eliminated/spectating
 * state during an active round.
 *
 * Renders a full-viewport vignette with centered text. The overlay is
 * `pointer-events: none` so it never blocks the 3D canvas interaction
 * (pointer-lock look-around remains functional).
 */
export function EliminatedSpectatorOverlay(
  props: EliminatedSpectatorOverlayProps,
): JSX.Element {
  const { visible } = props;
  const leaving = visible !== true;

  return (
    <div
      className={`eliminated-overlay ${leaving ? "eliminated-overlay--leaving" : ""}`}
      role="status"
      aria-live={leaving ? "off" : "polite"}
      aria-hidden={leaving || undefined}
      aria-label="You have been eliminated. Spectating the round."
    >
      <div className="eliminated-overlay__vignette" aria-hidden="true" />
      <div className="eliminated-overlay__content">
        <span className="eliminated-overlay__title">ELIMINATED</span>
        <span className="eliminated-overlay__subtitle">SPECTATING</span>
      </div>
    </div>
  );
}
