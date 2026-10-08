/**
 * useMatchPresentation — the production shell's match-lifecycle presentation
 * hook.
 *
 * Consumes the authoritative, normalized {@link MatchLifecycleView} (built by
 * the runtime from the server's match state and countdown broadcasts) and
 * produces the presentation state the App shell renders:
 *
 *  - the pre-round countdown moment (remaining authoritative seconds),
 *  - the round win/loss banner with an explicit enter/hold/exit lifecycle
 *    (the banner keeps rendering briefly after the authoritative phase
 *    leaves ROUND_OVER so its exit transition can complete),
 *  - the final victory/defeat screen data,
 *  - the rematch-readiness state: the shared rematch window counting down
 *    from the authoritative match-end moment (the server still enforces the
 *    window authoritatively; this is presentation only).
 *
 * All timers owned by this hook (the banner exit timer and the rematch-window
 * heartbeat) are cleaned up on unmount and on the authoritative reset
 * transitions (disconnect, rematch accepted), so no timer outlives the
 * presentation moment that started it.
 */
import { useEffect, useMemo, useState } from "react";
import { REMATCH_WINDOW_SECONDS } from "@buildshift/game-config";
import { RoundState } from "@buildshift/protocol";
import type { MatchLifecycleView } from "../game/matchLifecycleView";
import {
  deriveLifecyclePresentation,
  stepRoundBanner,
  rematchWindowRemaining,
  EMPTY_ROUND_BANNER,
  ROUND_RESULT_EXIT_MS,
  type MatchResultData,
  type PresentationMoment,
  type RoundBannerState,
  type RoundResultData,
} from "./matchPresentation";

/** The presentation state the App shell renders from. */
export interface MatchPresentationState {
  /** The active presentation moment. */
  moment: PresentationMoment;
  /** Remaining countdown seconds for the pre-round overlay (0 = hidden). */
  countdownSeconds: number;
  /** The round win/loss banner data, or `null` once fully dismissed. */
  roundResult: RoundResultData | null;
  /** Whether the banner is in its active (enter/hold) presentation state. */
  roundResultVisible: boolean;
  /** The final victory/defeat screen data, or `null` while in play. */
  matchResult: MatchResultData | null;
  /** Whether the rematch window is still open (authoritative anchor + shared window). */
  rematchAvailable: boolean;
  /** Whole seconds remaining in the rematch window (0 = closed). */
  rematchWindowSeconds: number;
}

/**
 * Compute the match-lifecycle presentation state for the authoritative
 * lifecycle view. See the module docs for the timer/cleanup contract.
 */
export function useMatchPresentation(
  view: MatchLifecycleView | null,
): MatchPresentationState {
  const derived = useMemo(() => deriveLifecyclePresentation(view), [view]);

  // ── Round win/loss banner (enter / hold / exit) ───────────────────────────
  const [banner, setBanner] = useState<RoundBannerState>(EMPTY_ROUND_BANNER);

  useEffect(() => {
    setBanner((prev) =>
      stepRoundBanner(prev, derived.round, Date.now(), ROUND_RESULT_EXIT_MS),
    );
  }, [derived]);

  // Schedule the exit completion (and its cleanup) while the banner is in
  // its exit window; re-armed whenever the banner state changes.
  useEffect(() => {
    if (banner.data === null || banner.exitAt === null) {
      return;
    }
    const delay = Math.max(0, banner.exitAt - Date.now());
    const timer = setTimeout(() => {
      setBanner((prev) =>
        prev.data === null || prev.exitAt === null
          ? prev
          : EMPTY_ROUND_BANNER,
      );
    }, delay);
    return () => clearTimeout(timer);
  }, [banner]);

  // ── Rematch window (anchored to the authoritative match-end) ─────────────
  const matchOver =
    view !== null &&
    view.connected === true &&
    view.roundState === RoundState.MATCH_OVER;

  const [matchEndAt, setMatchEndAt] = useState<number | null>(null);

  useEffect(() => {
    if (matchOver) {
      // Anchor once per match-end episode; a rematch (phase leaves
      // MATCH_ENDED) or a disconnect clears it and the window resets.
      setMatchEndAt((prev) => prev ?? Date.now());
    } else {
      setMatchEndAt(null);
    }
  }, [matchOver]);

  // 1s heartbeat while the match is over so the window countdown re-renders;
  // the interval is the only timer and it is cleared on unmount / reset.
  const [heartbeat, setHeartbeat] = useState(0);
  useEffect(() => {
    if (matchEndAt === null) {
      return;
    }
    const interval = setInterval(() => setHeartbeat((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [matchEndAt]);
  void heartbeat;

  const rematchWindowSeconds =
    matchEndAt === null
      ? 0
      : rematchWindowRemaining(Date.now() - matchEndAt, REMATCH_WINDOW_SECONDS);

  return {
    moment: derived.moment,
    countdownSeconds: derived.countdownSeconds,
    roundResult: banner.data,
    roundResultVisible: banner.visible,
    matchResult: derived.match,
    rematchAvailable: matchOver && rematchWindowSeconds > 0,
    rematchWindowSeconds: matchOver ? rematchWindowSeconds : 0,
  };
}
