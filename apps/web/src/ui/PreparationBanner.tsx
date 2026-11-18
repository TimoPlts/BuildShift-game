/**
 * PreparationBanner — the compact, non-blocking build-preparation phase strip.
 *
 * Before every fight the match is in `MatchPhase.COUNTDOWN`, which the round
 * preparation contract uses as the **build phase**: each player may only move
 * and build inside their own outermost build-grid row while temporary
 * barriers hold the arena closed. This banner is the whole of that phase's UI:
 *
 *  - `waiting`   — "WAITING FOR OPPONENT" until both players are present;
 *  - `preparing` — a clear "BUILD PHASE" label with the authoritative
 *                  countdown (the only clock a player ever sees) and the
 *                  readable assigned-row hint when the server supplied a side;
 *  - `ready`     — a plain "GET READY" countdown fallback for a pre-round
 *                  countdown the server did not flag as preparation.
 *
 * Deliberately **not** a full-screen takeover: unlike the legacy
 * `CountdownOverlay`, this strip never dims the arena, never sits over the
 * crosshair, and is pointer-transparent (`pointer-events: none` in
 * `match-lifecycle.css`), so players can see and build through it throughout
 * the preparation window.
 *
 * Presentation only: every value arrives via props, derived by
 * {@link derivePreparationUi} from the authoritative lifecycle view. The
 * component owns no timer, no networking and no runtime query.
 */
import type {
  PreparationUiMode,
} from "./preparationPresentation";
import {
  PREPARATION_OPENING_LABEL,
  PREPARATION_PHASE_LABEL,
  READY_PHASE_LABEL,
  WAITING_PHASE_LABEL,
} from "./preparationPresentation";
import "./match-lifecycle.css";

/** Explicit props for the preparation banner. */
export interface PreparationBannerProps {
  /** The derived preparation mode. `"idle"` renders nothing. */
  mode: PreparationUiMode;
  /** Authoritative whole seconds remaining (0 = nothing to clock). */
  remainingSeconds?: number;
  /** Readable assigned-row hint, or `null`/omitted when none is assigned. */
  sideHint?: string | null;
  /** The 1-based round being prepared for (0 = unknown, not rendered). */
  roundNumber?: number;
  /** Master switch; `false` renders nothing (defaults to `true`). */
  visible?: boolean;
}

/** The banner's primary label for a mode. */
function labelFor(mode: PreparationUiMode, remainingSeconds: number): string {
  switch (mode) {
    case "waiting":
      return WAITING_PHASE_LABEL;
    case "ready":
      return READY_PHASE_LABEL;
    case "preparing":
      return remainingSeconds > 0 ? PREPARATION_PHASE_LABEL : PREPARATION_OPENING_LABEL;
    default:
      return "";
  }
}

/** The banner's secondary explainer for a mode. */
function hintFor(mode: PreparationUiMode, remainingSeconds: number): string {
  switch (mode) {
    case "waiting":
      return "The build phase starts when both players are in the arena.";
    case "ready":
      return remainingSeconds > 0
        ? `Arena opens in ${remainingSeconds}s.`
        : "Arena opening…";
    case "preparing":
      return remainingSeconds > 0
        ? `Arena opens in ${remainingSeconds}s — build in your row.`
        : "Barriers dropping — fight starts now.";
    default:
      return "";
  }
}

/**
 * The compact preparation-phase strip.
 *
 * Example usage:
 * ```tsx
 * const prep = derivePreparationUi(lifecycle);
 * <PreparationBanner
 *   mode={prep.mode}
 *   remainingSeconds={prep.remainingSeconds}
 *   sideHint={prep.sideHint}
 *   roundNumber={prep.roundNumber}
 * />
 * ```
 */
export function PreparationBanner(props: PreparationBannerProps): JSX.Element | null {
  const {
    mode,
    remainingSeconds = 0,
    sideHint = null,
    roundNumber = 0,
    visible = true,
  } = props;

  if (!visible || mode === "idle") {
    return null;
  }

  const label = labelFor(mode, remainingSeconds);
  const hint = hintFor(mode, remainingSeconds);
  const showClock = mode !== "waiting" && remainingSeconds > 0;

  return (
    <div
      className={`preparation-banner preparation-banner--${mode}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={
        showClock
          ? `${label}: ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"} remaining`
          : label
      }
    >
      {roundNumber > 0 && (
        <span className="preparation-banner__round">Round {roundNumber}</span>
      )}
      <span className="preparation-banner__label">{label}</span>
      {showClock && (
        // Re-keyed on the value so each authoritative second re-triggers the
        // pop animation (and so a stale second can never linger on screen).
        <span
          key={remainingSeconds}
          className="preparation-banner__count"
          aria-hidden="true"
        >
          {remainingSeconds}
        </span>
      )}
      <span className="preparation-banner__hint">{hint}</span>
      {sideHint !== null && sideHint.length > 0 && (
        <span className="preparation-banner__side">{sideHint}</span>
      )}
    </div>
  );
}
