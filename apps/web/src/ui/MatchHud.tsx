/**
 * MatchHud — a presentation-only match HUD overlay for the BuildShift 1v1
 * match loop.
 *
 * Displays:
 *  - Round score (local vs. remote)
 *  - Current match phase label
 *  - Latest round result banner (on ROUND_ENDED)
 *  - Match winner banner (on MATCH_ENDED)
 *
 * This component is purely presentational. All match data is supplied via
 * explicit props; the component performs no networking, no runtime queries,
 * and no side effects beyond rendering. It can be used by any parent that
 * has access to the authoritative match state (e.g. GameRuntime, GameCanvas).
 *
 * The caller is responsible for mapping session-level data (e.g.
 * `matchWinnerId`) into the local-perspective booleans
 * (`localWonLastRound`, `localWonMatch`) before passing them here.
 */
import { MatchPhase } from "@buildshift/protocol";

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
}

/**
 * Human-readable label for each {@link MatchPhase} value, used in the
 * phase indicator strip at the top of the HUD.
 */
const PHASE_LABELS: Record<MatchPhase, string> = {
  [MatchPhase.COUNTDOWN]: "GET READY",
  [MatchPhase.IN_PROGRESS]: "IN PROGRESS",
  [MatchPhase.ROUND_ENDED]: "ROUND OVER",
  [MatchPhase.MATCH_ENDED]: "MATCH OVER",
};

/**
 * A presentation-only match HUD overlay.
 *
 * Renders a fixed-position overlay at the top-center of the viewport showing
 * the round score, current phase, and contextual banners for round results
 * and match victory/defeat.
 *
 * Example usage:
 * ```tsx
 * <MatchHud
 *   localScore={2}
 *   remoteScore={1}
 *   phase={MatchPhase.ROUND_ENDED}
 *   currentRound={3}
 *   localWonLastRound={true}
 *   localWonMatch={null}
 * />
 * ```
 */
export function MatchHud(props: MatchHudProps): JSX.Element {
  const {
    localScore,
    remoteScore,
    phase,
    currentRound,
    localWonLastRound,
    localWonMatch,
  } = props;

  return (
    <div className="match-hud" aria-live="polite">
      {/* ── Score row ── */}
      <div className="match-hud__score">
        <span className="match-hud__score-value match-hud__score-value--local">
          {localScore}
        </span>
        <span className="match-hud__score-separator" aria-hidden="true">
          –
        </span>
        <span className="match-hud__score-value match-hud__score-value--remote">
          {remoteScore}
        </span>
      </div>

      {/* ── Phase + round indicator ── */}
      <div className="match-hud__phase-row">
        <span className="match-hud__round">
          Round {currentRound > 0 ? currentRound : "—"}
        </span>
        <span className="match-hud__phase match-hud__phase--active">
          {PHASE_LABELS[phase] ?? "…"}
        </span>
      </div>

      {/* ── Latest round result banner (only during ROUND_ENDED) ── */}
      {phase === MatchPhase.ROUND_ENDED && localWonLastRound !== null && (
        <div
          className={`match-hud__banner ${
            localWonLastRound
              ? "match-hud__banner--success"
              : "match-hud__banner--failure"
          }`}
        >
          {localWonLastRound ? "ROUND WON" : "ROUND LOST"}
        </div>
      )}

      {/* ── Match winner banner (only during MATCH_ENDED) ── */}
      {phase === MatchPhase.MATCH_ENDED && localWonMatch !== null && (
        <div
          className={`match-hud__banner match-hud__banner--match ${
            localWonMatch
              ? "match-hud__banner--success"
              : "match-hud__banner--failure"
          }`}
        >
          {localWonMatch ? "VICTORY" : "DEFEAT"}
        </div>
      )}
    </div>
  );
}
