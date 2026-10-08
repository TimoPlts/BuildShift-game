/**
 * Unit tests for the pure match-lifecycle presentation model.
 *
 * These lock down the authoritative-wiring contract: every presentation
 * moment is derived exclusively from the normalized MatchLifecycleView
 * (the authoritative phase, scores, round, countdown and connection flag)
 * and the enter/hold/exit lifecycle of the round banner is a deterministic
 * function of the authoritative round result plus time.
 */
import { describe, expect, it } from "vitest";
import { RoundState } from "@buildshift/protocol";
import type { MatchLifecycleView } from "../game/matchLifecycleView";
import {
  deriveLifecyclePresentation,
  stepRoundBanner,
  rematchWindowRemaining,
  EMPTY_ROUND_BANNER,
  ROUND_RESULT_EXIT_MS,
  type RoundResultData,
} from "./matchPresentation";

/** A connected, in-play lifecycle view; override per case. */
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

const roundResult: RoundResultData = {
  localWon: true,
  roundNumber: 3,
  localScore: 2,
  remoteScore: 1,
};

describe("deriveLifecyclePresentation (authoritative wiring)", () => {
  it("presents nothing before the first authoritative view exists", () => {
    const p = deriveLifecyclePresentation(null);
    expect(p.moment).toBe("none");
    expect(p.countdownSeconds).toBe(0);
    expect(p.round).toBeNull();
    expect(p.match).toBeNull();
  });

  it("presents nothing while disconnected (no spurious countdown/banner)", () => {
    const d = deriveLifecyclePresentation(
      view({
        connected: false,
        roundState: RoundState.COUNTDOWN,
        countdownRemainingSeconds: 3,
      }),
    );
    expect(d.moment).toBe("none");
    expect(d.countdownSeconds).toBe(0);
  });

  it("maps COUNTDOWN to the countdown moment with the authoritative seconds", () => {
    const p = deriveLifecyclePresentation(
      view({ roundState: RoundState.COUNTDOWN, countdownRemainingSeconds: 2 }),
    );
    expect(p.moment).toBe("countdown");
    expect(p.countdownSeconds).toBe(2);
    expect(p.round).toBeNull();
    expect(p.match).toBeNull();
  });

  it("does not present a countdown once the authoritative countdown reaches zero", () => {
    const p = deriveLifecyclePresentation(
      view({ roundState: RoundState.COUNTDOWN, countdownRemainingSeconds: 0 }),
    );
    expect(p.moment).toBe("none");
    expect(p.countdownSeconds).toBe(0);
  });

  it("presents nothing during active play", () => {
    const p = deriveLifecyclePresentation(view({ roundState: RoundState.PLAYING }));
    expect(p.moment).toBe("none");
  });

  it("maps ROUND_OVER to the round-result moment in the local perspective", () => {
    const p = deriveLifecyclePresentation(
      view({
        roundState: RoundState.ROUND_OVER,
        currentRound: 3,
        localScore: 2,
        remoteScore: 1,
        localWonLastRound: true,
      }),
    );
    expect(p.moment).toBe("roundResult");
    expect(p.round).toEqual({
      localWon: true,
      roundNumber: 3,
      localScore: 2,
      remoteScore: 1,
    });
    expect(p.match).toBeNull();
  });

  it("inverts the perspective when the opponent won the round", () => {
    const p = deriveLifecyclePresentation(
      view({
        roundState: RoundState.ROUND_OVER,
        currentRound: 2,
        localScore: 0,
        remoteScore: 2,
        localWonLastRound: false,
      }),
    );
    expect(p.moment).toBe("roundResult");
    expect(p.round?.localWon).toBe(false);
    expect(p.round?.localScore).toBe(0);
    expect(p.round?.remoteScore).toBe(2);
  });

  it("presents no round result when the authoritative result is unknown", () => {
    const p = deriveLifecyclePresentation(
      view({ roundState: RoundState.ROUND_OVER, localWonLastRound: null }),
    );
    expect(p.moment).toBe("none");
    expect(p.round).toBeNull();
  });

  it("maps MATCH_OVER to the match-result moment with total rounds", () => {
    const p = deriveLifecyclePresentation(
      view({
        roundState: RoundState.MATCH_OVER,
        currentRound: 4,
        localScore: 3,
        remoteScore: 1,
        localWonMatch: true,
      }),
    );
    expect(p.moment).toBe("matchResult");
    expect(p.match).toEqual({
      localWon: true,
      localScore: 3,
      remoteScore: 1,
      totalRounds: 4,
    });
    expect(p.round).toBeNull();
  });

  it("presents no match result while the winner is unknown", () => {
    const p = deriveLifecyclePresentation(
      view({ roundState: RoundState.MATCH_OVER, localWonMatch: null }),
    );
    expect(p.moment).toBe("none");
    expect(p.match).toBeNull();
  });
});

describe("stepRoundBanner (enter / hold / exit lifecycle)", () => {
  it("enters on the first authoritative round result", () => {
    const next = stepRoundBanner(EMPTY_ROUND_BANNER, roundResult, 1000, ROUND_RESULT_EXIT_MS);
    expect(next).toEqual({ data: roundResult, visible: true, exitAt: null });
  });

  it("keeps the exact state while the authoritative result is unchanged (no re-animation)", () => {
    const entered = stepRoundBanner(EMPTY_ROUND_BANNER, roundResult, 1000, ROUND_RESULT_EXIT_MS);
    const same = { ...roundResult };
    const next = stepRoundBanner(entered, same, 2000, ROUND_RESULT_EXIT_MS);
    expect(next).toBe(entered);
  });

  it("re-enters when a new round result arrives", () => {
    const entered = stepRoundBanner(EMPTY_ROUND_BANNER, roundResult, 1000, ROUND_RESULT_EXIT_MS);
    const nextRound = { ...roundResult, roundNumber: 4, localScore: 3 };
    const next = stepRoundBanner(entered, nextRound, 5000, ROUND_RESULT_EXIT_MS);
    expect(next.visible).toBe(true);
    expect(next.exitAt).toBeNull();
    expect(next.data).toEqual(nextRound);
  });

  it("begins the exit when the authoritative phase leaves ROUND_OVER", () => {
    const entered = stepRoundBanner(EMPTY_ROUND_BANNER, roundResult, 1000, ROUND_RESULT_EXIT_MS);
    const leaving = stepRoundBanner(entered, null, 4000, ROUND_RESULT_EXIT_MS);
    expect(leaving.visible).toBe(false);
    expect(leaving.exitAt).toBe(4000 + ROUND_RESULT_EXIT_MS);
    // The data is held so the exit renders against the last result:
    expect(leaving.data).toEqual(roundResult);
  });

  it("completes the exit once the exit window has elapsed", () => {
    const entered = stepRoundBanner(EMPTY_ROUND_BANNER, roundResult, 1000, ROUND_RESULT_EXIT_MS);
    const leaving = stepRoundBanner(entered, null, 4000, ROUND_RESULT_EXIT_MS);
    const done = stepRoundBanner(leaving, null, 4000 + ROUND_RESULT_EXIT_MS, ROUND_RESULT_EXIT_MS);
    expect(done).toEqual(EMPTY_ROUND_BANNER);
  });

  it("holds the exit state while the window has not elapsed", () => {
    const entered = stepRoundBanner(EMPTY_ROUND_BANNER, roundResult, 1000, ROUND_RESULT_EXIT_MS);
    const leaving = stepRoundBanner(entered, null, 4000, ROUND_RESULT_EXIT_MS);
    const mid = stepRoundBanner(leaving, null, 4000 + 100, ROUND_RESULT_EXIT_MS);
    expect(mid).toBe(leaving);
  });

  it("does nothing when there is no result to exit from", () => {
    const next = stepRoundBanner(EMPTY_ROUND_BANNER, null, 1000, ROUND_RESULT_EXIT_MS);
    expect(next).toBe(EMPTY_ROUND_BANNER);
  });

  it("restarts the enter when a new result arrives mid-exit", () => {
    const entered = stepRoundBanner(EMPTY_ROUND_BANNER, roundResult, 1000, ROUND_RESULT_EXIT_MS);
    const leaving = stepRoundBanner(entered, null, 4000, ROUND_RESULT_EXIT_MS);
    const nextRound = { ...roundResult, roundNumber: 4 };
    const reentered = stepRoundBanner(leaving, nextRound, 4100, ROUND_RESULT_EXIT_MS);
    expect(reentered.visible).toBe(true);
    expect(reentered.exitAt).toBeNull();
    expect(reentered.data).toEqual(nextRound);
  });
});

describe("rematchWindowRemaining", () => {
  it("starts at the full shared window", () => {
    expect(rematchWindowRemaining(0, 30)).toBe(30);
    expect(rematchWindowRemaining(999, 30)).toBe(30);
  });

  it("counts down in whole seconds", () => {
    expect(rematchWindowRemaining(10_000, 30)).toBe(20);
    expect(rematchWindowRemaining(29_999, 30)).toBe(1);
  });

  it("closes at and beyond the window length", () => {
    expect(rematchWindowRemaining(30_000, 30)).toBe(0);
    expect(rematchWindowRemaining(60_000, 30)).toBe(0);
  });

  it("is defensive against malformed input", () => {
    expect(rematchWindowRemaining(-5, 30)).toBe(30);
    expect(rematchWindowRemaining(Number.NaN, 30)).toBe(30);
    expect(rematchWindowRemaining(0, Number.NaN)).toBe(0);
    expect(rematchWindowRemaining(0, -1)).toBe(0);
  });
});
