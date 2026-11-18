/**
 * MatchHud — a presentation-only match HUD overlay for the BuildShift 1v1
 * match loop.
 *
 * Displays the persistent, non-blocking in-match information:
 *  - A "waiting for opponent" indicator (lobby / not-yet-full state)
 *  - Round score (local vs. remote), with a pulse when a score changes
 *  - Current match phase label
 *
 * **There is deliberately no round timer.** An in-progress fight is untimed:
 * a round ends on an authoritative elimination (or the explicit
 * leaving/forfeit exception), so a remaining-time read-out, a progress bar or
 * any expiry label would promise a win condition that does not exist. The
 * only clock in the game is the build-preparation countdown, presented by the
 * App-level PreparationBanner; a stale timer value arriving from any legacy
 * event is therefore never rendered here.
 *
 * The full-attention lifecycle moments (build preparation, round win/loss,
 * final victory/defeat) are presented exclusively by the App-level lifecycle
 * overlays, so the header never doubles them.
 *
 * This component is purely presentational. All match data is supplied via
 * explicit props; the component performs no networking, no runtime queries,
 * and no side effects beyond rendering. It can be used by any parent that
 * has access to the authoritative match state (e.g. GameRuntime, GameCanvas).
 *
 * The caller is responsible for mapping session-level data (e.g.
 * `matchWinnerId`) into the local-perspective booleans
 * (`localWonLastRound`, `localWonMatch`) before passing them here.
 *
 * Every optional prop (`waitingForOpponent`, `preparationActive`) is optional
 * so that existing callers that only supply the core score/phase props keep
 * compiling and rendering exactly as before.
 */
import {
  MatchPhase,
  type RoundEndReason,
  isRoundEndReason,
} from "@buildshift/protocol";

/**
 * Explicit props for the match HUD.
 *
 * All values represent the **local player's** perspective. The caller
 * (e.g. GameRuntime) translates authoritative session-level data into
 * these local-perspective values.
 */
export interface MatchHudProps {
  /** The local player's round-win count. */
  localScore: number;
  /** The remote player's round-win count. */
  remoteScore: number;
  /** The authoritative match lifecycle phase. */
  phase: MatchPhase;
  /** The 1-based number of the current (or most recently completed) round. */
  currentRound: number;
  /**
   * Whether the local player won the most recently completed round.
   * `null` when no round has completed yet (e.g. during the initial
   * countdown before the first elimination).
   */
  localWonLastRound: boolean | null;
  /**
   * Whether the local player won the match.
   * `null` when the match has not ended yet.
   */
  localWonMatch: boolean | null;
  /**
   * Whether to show a "waiting for opponent" indicator. Set `true` while a
   * player has joined a room but the match is not yet full / started. Ignored
   * (suppressed) while `preparationActive` is `true`, because preparation
   * already proves both players are present.
   */
  waitingForOpponent?: boolean;
  /**
   * Whether the authoritative build-preparation phase is running (the
   * replicated `preparationActive` room flag). While true the phase label
   * reads as the build phase instead of a generic "get ready".
   */
  preparationActive?: boolean;
}

/**
 * Human-readable label for each {@link MatchPhase} value, used in the
 * phase indicator strip at the top of the HUD.
 *
 * `COUNTDOWN` is the build-preparation phase, so its label is refined from
 * the replicated preparation flag (see {@link phaseLabel}).
 */
const PHASE_LABELS: Record<MatchPhase, string> = {
  [MatchPhase.COUNTDOWN]: "GET READY",
  [MatchPhase.IN_PROGRESS]: "IN PROGRESS",
  [MatchPhase.ROUND_ENDED]: "ROUND OVER",
  [MatchPhase.MATCH_ENDED]: "MATCH OVER",
};

/** The pre-fight label while the authoritative build preparation is running. */
export const PREPARATION_HUD_LABEL = "BUILD";

/**
 * The phase-strip label: the base phase label, refined for the pre-fight
 * build phase when the authoritative preparation flag is set.
 */
export function phaseLabel(
  phase: MatchPhase,
  preparationActive?: boolean,
): string {
  if (phase === MatchPhase.COUNTDOWN && preparationActive === true) {
    return PREPARATION_HUD_LABEL;
  }
  return PHASE_LABELS[phase] ?? "…";
}

/**
 * Map an authoritative {@link RoundEndReason} into a human-readable,
 * local-perspective label.
 *
 * The same reason reads differently depending on whether the local player
 * won the round (`disconnect` is "OPPONENT DISCONNECTED" for the winner and
 * "YOU DISCONNECTED" for the loser). When `localWon` is `null` (perspective
 * unknown), a neutral label is returned.
 *
 * Rounds are untimed, so the retired timed / anti-stall win conditions are no
 * longer presented: any reason other than elimination or the explicit
 * leaving/forfeit disconnect yields `null`, which suppresses the tag rather
 * than showing a stale timed-rule explanation.
 *
 * This helper is shared by the other presentation-only match components
 * (`RoundEndBanner`, `MatchEndScreen`) so the reason vocabulary has a single
 * source of truth.
 */
export function roundEndReasonLabel(
  reason: RoundEndReason | null | undefined,
  localWon: boolean | null,
): string | null {
  if (reason == null || !isRoundEndReason(reason)) {
    return null;
  }

  switch (reason) {
    case "elimination":
      if (localWon === null) return "ELIMINATION";
      return localWon ? "OPPONENT ELIMINATED" : "YOU WERE ELIMINATED";
    case "disconnect":
      if (localWon === null) return "DISCONNECT";
      return localWon ? "OPPONENT DISCONNECTED" : "YOU DISCONNECTED";
    default:
      return null;
  }
}

/**
 * A presentation-only match HUD overlay.
 *
 * Renders a fixed-position overlay at the top-center of the viewport showing
 * the round score, current phase and contextual banners for round results and
 * match victory/defeat — and never a round clock, because a fight ends on
 * elimination, not on time.
 *
 * Example usage:
 * ```tsx
 * <MatchHud
 *   localScore={2}
 *   remoteScore={1}
 *   phase={MatchPhase.IN_PROGRESS}
 *   currentRound={3}
 *   localWonLastRound={true}
 *   localWonMatch={null}
 *   preparationActive={false}
 * />
 * ```
 */
export function MatchHud(props: MatchHudProps): JSX.Element {
  const {
    localScore,
    remoteScore,
    phase,
    currentRound,
    waitingForOpponent,
    preparationActive,
  } = props;

  // Preparation proves both players are present, so the two indicators are
  // mutually exclusive even if a caller still passes its legacy waiting flag.
  const showWaiting = waitingForOpponent === true && preparationActive !== true;

  return (
    <div className="match-hud">
      {/* ── Waiting-for-opponent indicator ── */}
      {showWaiting && (
        <div className="match-hud__waiting" role="status">
          WAITING FOR OPPONENT…
        </div>
      )}

      {/* ── Score row ── */}
      <div className="match-hud__score" aria-live="polite">
        <span
          key={`local-${localScore}`}
          className="match-hud__score-value match-hud__score-value--local match-hud__score-value--pulse"
        >
          {localScore}
        </span>
        <span className="match-hud__score-separator" aria-hidden="true">
          –
        </span>
        <span
          key={`remote-${remoteScore}`}
          className="match-hud__score-value match-hud__score-value--remote match-hud__score-value--pulse"
        >
          {remoteScore}
        </span>
      </div>

      {/* ── No round timer: an in-progress fight is untimed (elimination ends it) ── */}

      {/* ── Phase + round indicator ── */}
      <div className="match-hud__phase-row">
        <span className="match-hud__round">
          Round {currentRound > 0 ? currentRound : "—"}
        </span>
        <span className="match-hud__phase match-hud__phase--active">
          {phaseLabel(phase, preparationActive)}
        </span>
      </div>
    </div>
  );
}
