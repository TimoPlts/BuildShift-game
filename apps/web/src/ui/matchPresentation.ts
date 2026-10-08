/**
 * matchPresentation — pure, framework-free mapping from the authoritative
 * {@link MatchLifecycleView} into the presentation "moments" the production
 * shell renders on top of the redesigned HUD.
 *
 * Every value is derived from the existing authoritative match state (the
 * normalized lifecycle view: phase, scores, round, countdown, connection).
 * No gameplay state is mirrored or invented here; the module is a plain
 * pure function over that data and is directly unit-testable.
 *
 * The presentation model guarantees that each lifecycle moment has exactly
 * one intentional presentation:
 *
 *  - `countdown`   — the full-screen pre-round countdown overlay.
 *  - `roundResult` — the centered round win/loss banner (with an explicit
 *                    enter/exit lifecycle, see {@link stepRoundBanner}).
 *  - `matchResult` — the full-screen final victory/defeat screen.
 *  - `none`        — normal gameplay; only the in-game HUD is shown.
 */
import { RoundState } from "@buildshift/protocol";
import type { MatchLifecycleView } from "../game/matchLifecycleView";

/**
 * How long (ms) the round-result banner keeps rendering after the
 * authoritative phase has left ROUND_OVER, so its exit transition can
 * complete before the banner unmounts.
 */
export const ROUND_RESULT_EXIT_MS = 320;

/** The single presentation moment active for a given authoritative view. */
export type PresentationMoment =
  | "countdown"
  | "roundResult"
  | "matchResult"
  | "none";

/** The local-perspective data the round-result banner presents. */
export interface RoundResultData {
  /** Whether the local player won the round that just completed. */
  localWon: boolean;
  /** The 1-based round number that just completed. */
  roundNumber: number;
  /** The local player's round-win count after this round. */
  localScore: number;
  /** The opponent's round-win count after this round. */
  remoteScore: number;
}

/** The local-perspective data the final match-result screen presents. */
export interface MatchResultData {
  /** Whether the local player won the match. */
  localWon: boolean;
  /** The local player's final round-win count. */
  localScore: number;
  /** The opponent's final round-win count. */
  remoteScore: number;
  /** The total number of rounds played (the deciding round number). */
  totalRounds: number;
}

/** The instantaneous presentation derived from one authoritative view. */
export interface LifecyclePresentation {
  /** The active presentation moment. */
  moment: PresentationMoment;
  /** Remaining countdown seconds (meaningful only for the `countdown` moment). */
  countdownSeconds: number;
  /** Round-result banner data, or `null` when no round result is presented. */
  round: RoundResultData | null;
  /** Match-result screen data, or `null` while the match is still in play. */
  match: MatchResultData | null;
}

/**
 * Derive the presentation moment and its data from the authoritative
 * normalized lifecycle view.
 *
 * Returns `none` while disconnected or before the view exists, so a
 * fresh/empty room state never presents a spurious countdown or banner.
 */
export function deriveLifecyclePresentation(
  view: MatchLifecycleView | null,
): LifecyclePresentation {
  const none: LifecyclePresentation = {
    moment: "none",
    countdownSeconds: 0,
    round: null,
    match: null,
  };

  if (view === null || view.connected === false) {
    return none;
  }

  switch (view.roundState) {
    case RoundState.COUNTDOWN:
      if (view.countdownRemainingSeconds > 0) {
        return {
          ...none,
          moment: "countdown",
          countdownSeconds: view.countdownRemainingSeconds,
        };
      }
      return none;

    case RoundState.ROUND_OVER:
      if (view.localWonLastRound === null) {
        return none;
      }
      return {
        ...none,
        moment: "roundResult",
        round: {
          localWon: view.localWonLastRound,
          roundNumber: view.currentRound,
          localScore: view.localScore,
          remoteScore: view.remoteScore,
        },
      };

    case RoundState.MATCH_OVER:
      if (view.localWonMatch === null) {
        return none;
      }
      return {
        ...none,
        moment: "matchResult",
        match: {
          localWon: view.localWonMatch,
          localScore: view.localScore,
          remoteScore: view.remoteScore,
          totalRounds: view.currentRound,
        },
      };

    case RoundState.PLAYING:
    default:
      return none;
  }
}

/**
 * The round-result banner's presentation state across the enter/hold/exit
 * lifecycle.
 *
 * `data` is retained after the authoritative phase has left ROUND_OVER so the
 * exit transition renders against the last authoritative result; `exitAt` is
 * the timestamp at which the exit completes and the banner should unmount.
 */
export interface RoundBannerState {
  /** The last authoritative round result, or `null` when nothing is held. */
  data: RoundResultData | null;
  /** Whether the banner content should be presented as active (enter/hold). */
  visible: boolean;
  /** The exit-completion timestamp in ms, or `null` while entering/holding. */
  exitAt: number | null;
}

/** The empty round-banner state (nothing presented, nothing held). */
export const EMPTY_ROUND_BANNER: RoundBannerState = {
  data: null,
  visible: false,
  exitAt: null,
};

/** Whether two round-result payloads are player-visible identical. */
function sameRoundResult(a: RoundResultData, b: RoundResultData): boolean {
  return (
    a.localWon === b.localWon &&
    a.roundNumber === b.roundNumber &&
    a.localScore === b.localScore &&
    a.remoteScore === b.remoteScore
  );
}

/**
 * Advance the round-banner presentation state to match the authoritative
 * round result (which may be `null` once the phase has moved on).
 *
 * Pure and total: given the previous presentation state, the current
 * authoritative round result (or `null`), the current time and the exit
 * duration, it returns the next presentation state. Re-entering a new round
 * result during an in-progress exit restarts the banner (enter again).
 */
export function stepRoundBanner(
  prev: RoundBannerState,
  round: RoundResultData | null,
  now: number,
  exitMs: number,
): RoundBannerState {
  if (round !== null) {
    // Entering / holding: a changed authoritative result re-enters (re-keys
    // the banner animation); an unchanged one keeps the exact state so the
    // animation is not re-triggered by repeated state pushes.
    if (prev.data !== null && sameRoundResult(prev.data, round)) {
      return prev;
    }
    return { data: round, visible: true, exitAt: null };
  }

  if (prev.data === null) {
    return prev;
  }

  // Leaving: begin the exit on the first push after the phase moved on, and
  // complete it once the exit window has elapsed.
  if (prev.exitAt === null) {
    return { ...prev, visible: false, exitAt: now + exitMs };
  }
  if (now >= prev.exitAt) {
    return EMPTY_ROUND_BANNER;
  }
  return prev;
}

/**
 * The remaining rematch-window seconds given the time elapsed since the
 * authoritative match-end moment and the shared window length.
 *
 * The window length is the shared game-config constant the server enforces;
 * this only counts it down for presentation, always clamped to `[0, window]`.
 */
export function rematchWindowRemaining(
  elapsedMs: number,
  windowSeconds: number,
): number {
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    return 0;
  }
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return Math.floor(windowSeconds);
  }
  return Math.max(0, Math.floor(windowSeconds) - Math.floor(elapsedMs / 1000));
}
