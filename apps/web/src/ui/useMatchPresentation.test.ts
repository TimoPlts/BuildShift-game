/**
 * Hook tests for useMatchPresentation — the production shell's transition
 * layer between the authoritative match lifecycle view and the overlay
 * presentation (countdown, round win/loss banner, final result, rematch
 * state).
 *
 * Locks down, against a real React render tree:
 *  - the authoritative wiring (phase + scores + countdown drive the moments);
 *  - the round banner's enter/hold/exit lifecycle, including that the exit
 *    timer actually completes and unmounts the banner after the phase moves on;
 *  - the rematch window: anchored at the authoritative MATCH_ENDED moment,
 *    counting down on a 1s heartbeat, resetting on the rematch-accepted
 *    transition (phase leaves MATCH_ENDED) and on disconnect;
 *  - timer/listener cleanup on unmount (no timer outlives the component).
 *
 * The default vitest environment is node; this file opts into happy-dom for
 * the DOM render. Timers (including Date) are faked so every lifecycle step
 * is deterministic.
 */
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Opt in to React's act() environment for this file (React 18).
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
import { createElement, useEffect } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { RoundState } from "@buildshift/protocol";
import { REMATCH_WINDOW_SECONDS } from "@buildshift/game-config";
import type { MatchLifecycleView } from "../game/matchLifecycleView";
import {
  useMatchPresentation,
  type MatchPresentationState,
} from "./useMatchPresentation";

function view(overrides: Partial<MatchLifecycleView> = {}): MatchLifecycleView {
  return {
    connected: true,
    roundState: RoundState.PLAYING,
    currentRound: 1,
    localScore: 0,
    remoteScore: 0,
    localWonLastRound: null,
    localWonMatch: null,
    countdownRemainingSeconds: 0,
    ...overrides,
  };
}

function Harness({
  view: v,
  onState,
}: {
  view: MatchLifecycleView | null;
  onState: (state: MatchPresentationState) => void;
}) {
  const state = useMatchPresentation(v);
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

describe("useMatchPresentation", () => {
  let container: HTMLElement;
  let root: Root;
  let latest: MatchPresentationState | null;
  let current: MatchLifecycleView | null;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    latest = null;
    current = view();
    act(() => {
      root.render(
        createElement(Harness, {
          view: current,
          onState: (s: MatchPresentationState) => {
            latest = s;
          },
        }),
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function setView(next: MatchLifecycleView) {
    current = next;
    act(() => {
      root.render(
        createElement(Harness, {
          view: current,
          onState: (s: MatchPresentationState) => {
            latest = s;
          },
        }),
      );
    });
  }

  it("presents the countdown moment only from the authoritative countdown seconds", () => {
    expect(latest?.moment).toBe("none");
    expect(latest?.countdownSeconds).toBe(0);

    setView(
      view({ roundState: RoundState.COUNTDOWN, countdownRemainingSeconds: 3 }),
    );
    expect(latest?.moment).toBe("countdown");
    expect(latest?.countdownSeconds).toBe(3);

    setView(
      view({ roundState: RoundState.COUNTDOWN, countdownRemainingSeconds: 1 }),
    );
    expect(latest?.countdownSeconds).toBe(1);

    // Round starts: the countdown moment ends with the authoritative phase.
    setView(view({ roundState: RoundState.PLAYING }));
    expect(latest?.moment).toBe("none");
    expect(latest?.countdownSeconds).toBe(0);
  });

  it("enters, holds, and exits the round-result banner on authoritative transitions", () => {
    setView(
      view({
        roundState: RoundState.ROUND_OVER,
        currentRound: 2,
        localScore: 1,
        remoteScore: 1,
        localWonLastRound: true,
      }),
    );
    expect(latest?.moment).toBe("roundResult");
    expect(latest?.roundResult).toEqual({
      localWon: true,
      roundNumber: 2,
      localScore: 1,
      remoteScore: 1,
    });
    expect(latest?.roundResultVisible).toBe(true);

    // Phase moves on (next countdown): the banner leaves but stays mounted
    // for its exit transition, still holding the last authoritative result.
    setView(
      view({
        roundState: RoundState.COUNTDOWN,
        currentRound: 3,
        countdownRemainingSeconds: 3,
      }),
    );
    expect(latest?.roundResultVisible).toBe(false);
    expect(latest?.roundResult?.roundNumber).toBe(2);

    // After the exit window, the banner fully dismisses.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(latest?.roundResult).toBeNull();
    expect(latest?.roundResultVisible).toBe(false);
  });

  it("re-enters the banner for a new round result", () => {
    setView(
      view({
        roundState: RoundState.ROUND_OVER,
        currentRound: 1,
        localScore: 0,
        remoteScore: 1,
        localWonLastRound: false,
      }),
    );
    expect(latest?.roundResult?.localWon).toBe(false);
    expect(latest?.roundResultVisible).toBe(true);

    setView(
      view({
        roundState: RoundState.ROUND_OVER,
        currentRound: 3,
        localScore: 2,
        remoteScore: 1,
        localWonLastRound: true,
      }),
    );
    expect(latest?.roundResult).toEqual({
      localWon: true,
      roundNumber: 3,
      localScore: 2,
      remoteScore: 1,
    });
    expect(latest?.roundResultVisible).toBe(true);
  });

  it("anchors the rematch window at the authoritative match end and counts it down", () => {
    setView(
      view({
        roundState: RoundState.MATCH_OVER,
        currentRound: 4,
        localScore: 3,
        remoteScore: 1,
        localWonMatch: true,
      }),
    );
    expect(latest?.moment).toBe("matchResult");
    expect(latest?.matchResult).toEqual({
      localWon: true,
      localScore: 3,
      remoteScore: 1,
      totalRounds: 4,
    });
    expect(latest?.rematchAvailable).toBe(true);
    expect(latest?.rematchWindowSeconds).toBe(REMATCH_WINDOW_SECONDS);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(latest?.rematchWindowSeconds).toBe(REMATCH_WINDOW_SECONDS - 10);
    expect(latest?.rematchAvailable).toBe(true);

    act(() => {
      vi.advanceTimersByTime(REMATCH_WINDOW_SECONDS * 1000);
    });
    expect(latest?.rematchWindowSeconds).toBe(0);
    expect(latest?.rematchAvailable).toBe(false);
    // The final result itself stays presented for the whole MATCH_OVER phase.
    expect(latest?.matchResult?.localWon).toBe(true);
  });

  it("resets the match result and rematch window when the rematch is accepted", () => {
    setView(
      view({
        roundState: RoundState.MATCH_OVER,
        currentRound: 3,
        localScore: 3,
        remoteScore: 0,
        localWonMatch: true,
      }),
    );
    expect(latest?.matchResult).not.toBeNull();
    expect(latest?.rematchAvailable).toBe(true);

    // Both players rematched: the authoritative phase leaves MATCH_ENDED.
    setView(
      view({
        roundState: RoundState.COUNTDOWN,
        currentRound: 1,
        localScore: 0,
        remoteScore: 0,
        countdownRemainingSeconds: 3,
      }),
    );
    expect(latest?.matchResult).toBeNull();
    expect(latest?.rematchAvailable).toBe(false);
    expect(latest?.rematchWindowSeconds).toBe(0);
    expect(latest?.moment).toBe("countdown");
  });

  it("presents nothing while disconnected and clears the rematch anchor on reconnect", () => {
    setView(
      view({
        roundState: RoundState.MATCH_OVER,
        currentRound: 3,
        localScore: 3,
        remoteScore: 0,
        localWonMatch: true,
      }),
    );
    expect(latest?.matchResult).not.toBeNull();

    setView(view({ connected: false }));
    expect(latest?.moment).toBe("none");
    expect(latest?.matchResult).toBeNull();
    expect(latest?.rematchAvailable).toBe(false);

    // Reconnect mid-match: no stale match result or rematch state.
    setView(view({ roundState: RoundState.PLAYING, currentRound: 2 }));
    expect(latest?.matchResult).toBeNull();
    expect(latest?.rematchAvailable).toBe(false);
  });

  it("cleans up all timers on unmount (none outlive the presentation)", () => {
    setView(
      view({
        roundState: RoundState.ROUND_OVER,
        currentRound: 1,
        localWonLastRound: true,
      }),
    );
    // The banner is in its exit state once the phase has moved on: this
    // schedules the exit timer, and the match-end anchor schedules the
    // rematch heartbeat.
    setView(
      view({
        roundState: RoundState.MATCH_OVER,
        currentRound: 3,
        localScore: 3,
        remoteScore: 0,
        localWonMatch: true,
      }),
    );
    setView(view({ roundState: RoundState.COUNTDOWN, countdownRemainingSeconds: 3 }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });
});
