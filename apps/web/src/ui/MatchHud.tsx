/**
 * MatchHud — a presentation-only match HUD overlay for the BuildShift 1v1
 * match loop.
 *
 * Displays:
 *  - A "waiting for opponent" indicator (lobby / not-yet-full state)
 *  - The pre-round countdown (when provided)
 *  - Round score (local vs. remote)
 *  - The authoritative round timer (remaining time + progress bar)
 *  - Current match phase label
 *  - The latest round-end outcome (elimination / time-up / anti-stall /
 *    disconnect) derived from the authoritative `RoundEndReason`
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
 *
 * Every "timed match" prop (`waitingForOpponent`, `roundTimerRemainingMs`,
 * `roundTimerTotalMs`, `countdownSeconds`, `roundEndReason`) is optional so
 * that existing callers that only supply the core score/phase props keep
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
   * player has joined a room but the match is not yet full / started.
   */
  waitingForOpponent?: boolean;
  /**
   * Authoritative remaining round time in milliseconds (>= 0). When provided
   * and greater than `0`, the round timer (progress bar + countdown) is
   * rendered.
   */
  roundTimerRemainingMs?: number;
  /**
   * Total round duration in milliseconds, used to render a progress bar
   * alongside the remaining time. Ignored when omitted.
   */
  roundTimerTotalMs?: number;
  /**
   * Pre-round countdown in whole seconds (e.g. 3, 2, 1). Rendered when
   * greater than `0`; hidden otherwise.
   */
  countdownSeconds?: number;
  /**
   * The authoritative reason the most recently completed round ended. Used to
   * present the anti-stall / time-up / elimination / disconnect outcome tag.
   * `null` (or omitted) when no round has ended yet or the reason is unknown.
   */
  roundEndReason?: RoundEndReason | null;
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
 * Map an authoritative {@link RoundEndReason} into a human-readable,
 * local-perspective label.
 *
 * The same reason reads differently depending on whether the local player
 * won the round (e.g. `anti_stall_timeout` is "OPPONENT STALLED" when the
 * local player is the winner and "YOU STALLED" when they are the loser).
 * When `localWon` is `null` (perspective unknown), a neutral label is
 * returned. Returns `null` for a missing / unrecognised reason so callers
 * can suppress the tag.
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
    case "time_expired":
      return "TIME UP";
    case "anti_stall_timeout":
      if (localWon === null) return "STALL TIMEOUT";
      return localWon ? "OPPONENT STALLED" : "YOU STALLED";
    case "disconnect":
      if (localWon === null) return "DISCONNECT";
      return localWon ? "OPPONENT DISCONNECTED" : "YOU DISCONNECTED";
    default:
      return null;
  }
}

/**
 * Format a millisecond duration into a compact `m:ss` string for the round
 * timer (e.g. `90000` → `1:30`, `30000` → `0:30`).
 */
function formatRoundTimer(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * A presentation-only match HUD overlay.
 *
 * Renders a fixed-position overlay at the top-center of the viewport showing
 * the round score, current phase, a round timer, and contextual banners for
 * round results and match victory/defeat.
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
 *   roundTimerRemainingMs={45000}
 *   roundTimerTotalMs={90000}
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
    waitingForOpponent,
    roundTimerRemainingMs,
    roundTimerTotalMs,
    countdownSeconds,
    roundEndReason,
  } = props;

  // ── Round timer ──────────────────────────────────────────────────────────
  const showTimer =
    typeof roundTimerRemainingMs === "number" &&
    Number.isFinite(roundTimerRemainingMs) &&
    roundTimerRemainingMs > 0;

  let timerFraction = 0;
  if (
    showTimer &&
    typeof roundTimerTotalMs === "number" &&
    Number.isFinite(roundTimerTotalMs) &&
    roundTimerTotalMs > 0
  ) {
    timerFraction = Math.min(
      1,
      Math.max(0, (roundTimerRemainingMs as number) / roundTimerTotalMs),
    );
  }
  const timerLow =
    showTimer && (roundTimerRemainingMs as number) <= 10_000;

  // ── Countdown ────────────────────────────────────────────────────────────
  const showCountdown =
    typeof countdownSeconds === "number" &&
    Number.isFinite(countdownSeconds) &&
    countdownSeconds > 0;

  // ── Round-end outcome tag (anti-stall / time-up / elimination) ──────────
  const showReasonTag =
    phase === MatchPhase.ROUND_ENDED || phase === MatchPhase.MATCH_ENDED;
  const reasonLabel = showReasonTag
    ? roundEndReasonLabel(roundEndReason, localWonLastRound)
    : null;

  return (
    <div className="match-hud" aria-live="polite">
      {/* ── Waiting-for-opponent indicator ── */}
      {waitingForOpponent && (
        <div className="match-hud__waiting" role="status">
          WAITING FOR OPPONENT…
        </div>
      )}

      {/* ── Pre-round countdown (large, centered) ── */}
      {showCountdown && (
        <div
          key={countdownSeconds}
          className="match-hud__countdown"
          role="status"
          aria-live="assertive"
          aria-label={`${countdownSeconds} second${
            (countdownSeconds as number) !== 1 ? "s" : ""
          } until the round starts`}
        >
          {countdownSeconds}
        </div>
      )}

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

      {/* ── Round timer (progress bar + remaining time) ── */}
      {showTimer && (
        <div
          className={`match-hud__timer ${
            timerLow ? "match-hud__timer--low" : ""
          }`}
          role="timer"
          aria-label={`Round time ${formatRoundTimer(
            roundTimerRemainingMs as number,
          )} remaining`}
        >
          <div className="match-hud__timer-track">
            <div
              className="match-hud__timer-fill"
              style={{ width: `${Math.round(timerFraction * 100)}%` }}
            />
          </div>
          <span className="match-hud__timer-value">
            {formatRoundTimer(roundTimerRemainingMs as number)}
          </span>
        </div>
      )}

      {/* ── Phase + round indicator (+ round-end reason tag) ── */}
      <div className="match-hud__phase-row">
        <span className="match-hud__round">
          Round {currentRound > 0 ? currentRound : "—"}
        </span>
        <span className="match-hud__phase match-hud__phase--active">
          {PHASE_LABELS[phase] ?? "…"}
        </span>
        {reasonLabel && <span className="match-hud__reason">{reasonLabel}</span>}
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
