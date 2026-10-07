/**
 * Unit tests for the MatchStateController.
 */
import { describe, expect, it } from "vitest";
import { RoundState, type RoundResetPayload } from "@buildshift/protocol";
import {
  MatchStateController,
  type MatchPhaseTransition,
  type MatchOverInfo,
  type RoundResetContext,
} from "./matchStateController";

function makeResetPayload(overrides?: Partial<RoundResetPayload>): RoundResetPayload {
  return { spawnPosition: { x: 0, y: 1, z: 0 }, resetHealth: 100, resetEnergy: 50, clearBuilds: true, ...overrides };
}

function makeRecordingCallbacks() {
  const phaseChanges: MatchPhaseTransition[] = [];
  const inputGateChanges: boolean[] = [];
  const predictionGateChanges: boolean[] = [];
  const matchOverInfos: MatchOverInfo[] = [];
  const roundResetContexts: RoundResetContext[] = [];
  return {
    phaseChanges, inputGateChanges, predictionGateChanges, matchOverInfos, roundResetContexts,
    options: {
      onPhaseChanged: (t: MatchPhaseTransition) => phaseChanges.push(t),
      onInputGateChanged: (e: boolean) => inputGateChanges.push(e),
      onPredictionGateChanged: (a: boolean) => predictionGateChanges.push(a),
      onMatchOver: (i: MatchOverInfo) => matchOverInfos.push(i),
      onRoundReset: (c: RoundResetContext) => roundResetContexts.push(c),
    },
  };
}

describe("MatchStateController — initial state", () => {
  it("starts in COUNTDOWN with input disabled and prediction stopped", () => {
    const c = new MatchStateController();
    expect(c.state).toBe(RoundState.COUNTDOWN);
    expect(c.inputEnabled).toBe(false);
    expect(c.predictionActive).toBe(false);
    expect(c.matchOver).toBe(false);
  });
});

describe("MatchStateController — COUNTDOWN → PLAYING", () => {
  it("enables input and prediction", () => {
    const { options, inputGateChanges, predictionGateChanges, phaseChanges } = makeRecordingCallbacks();
    const c = new MatchStateController(options);
    c.setServerState(RoundState.PLAYING);
    expect(c.state).toBe(RoundState.PLAYING);
    expect(c.inputEnabled).toBe(true);
    expect(c.predictionActive).toBe(true);
    expect(inputGateChanges).toEqual([true]);
    expect(predictionGateChanges).toEqual([true]);
    expect(phaseChanges).toEqual([{ prev: RoundState.COUNTDOWN, next: RoundState.PLAYING }]);
  });
});

describe("MatchStateController — PLAYING → ROUND_OVER", () => {
  it("disables input and prediction", () => {
    const { options, inputGateChanges, predictionGateChanges } = makeRecordingCallbacks();
    const c = new MatchStateController(options);
    c.setServerState(RoundState.PLAYING);
    inputGateChanges.length = 0;
    predictionGateChanges.length = 0;
    c.setServerState(RoundState.ROUND_OVER);
    expect(c.state).toBe(RoundState.ROUND_OVER);
    expect(c.inputEnabled).toBe(false);
    expect(c.predictionActive).toBe(false);
    expect(inputGateChanges).toEqual([false]);
    expect(predictionGateChanges).toEqual([false]);
  });
});

describe("MatchStateController — ROUND_OVER → COUNTDOWN", () => {
  it("fires onRoundReset with null payload", () => {
    const { options, roundResetContexts } = makeRecordingCallbacks();
    const c = new MatchStateController(options);
    c.setServerState(RoundState.PLAYING);
    c.setServerState(RoundState.ROUND_OVER);
    c.setServerState(RoundState.COUNTDOWN);
    expect(roundResetContexts).toHaveLength(1);
    expect(roundResetContexts[0].payload).toBeNull();
  });

  it("fires onRoundReset with staged payload", () => {
    const { options, roundResetContexts } = makeRecordingCallbacks();
    const c = new MatchStateController(options);
    const payload = makeResetPayload({ spawnPosition: { x: 5, y: 2, z: -3 } });
    c.setServerState(RoundState.PLAYING);
    c.setServerState(RoundState.ROUND_OVER);
    c.stageResetPayload(payload);
    c.setServerState(RoundState.COUNTDOWN);
    expect(roundResetContexts).toHaveLength(1);
    expect(roundResetContexts[0].payload).toEqual(payload);
  });

  it("delivers payload passed to setServerState", () => {
    const { options, roundResetContexts } = makeRecordingCallbacks();
    const c = new MatchStateController(options);
    const payload = makeResetPayload();
    c.setServerState(RoundState.PLAYING);
    c.setServerState(RoundState.ROUND_OVER);
    c.setServerState(RoundState.COUNTDOWN, undefined, payload);
    expect(roundResetContexts).toHaveLength(1);
    expect(roundResetContexts[0].payload).toEqual(payload);
  });
});

describe("MatchStateController — ROUND_OVER → MATCH_OVER", () => {
  it("sets matchOver and fires onMatchOver once", () => {
    const { options, matchOverInfos } = makeRecordingCallbacks();
    const c = new MatchStateController(options);
    c.setServerState(RoundState.PLAYING);
    c.setServerState(RoundState.ROUND_OVER);
    c.setServerState(RoundState.MATCH_OVER, "winner-123");
    expect(c.matchOver).toBe(true);
    expect(matchOverInfos).toEqual([{ winnerId: "winner-123" }]);
  });

  it("does not fire onMatchOver again on re-send", () => {
    const { options, matchOverInfos } = makeRecordingCallbacks();
    const c = new MatchStateController(options);
    c.setServerState(RoundState.PLAYING);
    c.setServerState(RoundState.ROUND_OVER);
    c.setServerState(RoundState.MATCH_OVER, "w");
    c.setServerState(RoundState.MATCH_OVER, "w");
    expect(matchOverInfos).toHaveLength(1);
  });
});

describe("MatchStateController — no-op on same state", () => {
  it("does not fire callbacks on same state", () => {
    const { options, phaseChanges } = makeRecordingCallbacks();
    const c = new MatchStateController(options);
    c.setServerState(RoundState.PLAYING);
    phaseChanges.length = 0;
    c.setServerState(RoundState.PLAYING);
    expect(phaseChanges).toHaveLength(0);
  });
});

describe("MatchStateController — mid-match rejoin", () => {
  it("initialize to PLAYING without callbacks", () => {
    const { options, phaseChanges } = makeRecordingCallbacks();
    const c = new MatchStateController(options);
    c.initialize(RoundState.PLAYING);
    expect(c.inputEnabled).toBe(true);
    expect(c.predictionActive).toBe(true);
    expect(phaseChanges).toHaveLength(0);
  });

  it("initialize to MATCH_OVER fires onMatchOver", () => {
    const { options, matchOverInfos, phaseChanges } = makeRecordingCallbacks();
    const c = new MatchStateController(options);
    c.initialize(RoundState.MATCH_OVER, "rejoin-w");
    expect(c.matchOver).toBe(true);
    expect(matchOverInfos).toEqual([{ winnerId: "rejoin-w" }]);
    expect(phaseChanges).toHaveLength(0);
  });
});

describe("MatchStateController — resetPrediction()", () => {
  it("stops prediction and fires callback when active", () => {
    const { options, predictionGateChanges } = makeRecordingCallbacks();
    const c = new MatchStateController(options);
    c.setServerState(RoundState.PLAYING);
    predictionGateChanges.length = 0;
    expect(c.predictionActive).toBe(true);
    c.resetPrediction();
    expect(c.predictionActive).toBe(false);
    expect(predictionGateChanges).toEqual([false]);
  });

  it("does not fire callback when prediction already stopped", () => {
    const { options, predictionGateChanges } = makeRecordingCallbacks();
    const c = new MatchStateController(options);
    c.resetPrediction();
    expect(predictionGateChanges).toHaveLength(0);
  });

  it("does not modify input gate or match state", () => {
    const { options } = makeRecordingCallbacks();
    const c = new MatchStateController(options);
    c.setServerState(RoundState.PLAYING);
    c.resetPrediction();
    expect(c.inputEnabled).toBe(true);
    expect(c.state).toBe(RoundState.PLAYING);
    expect(c.matchOver).toBe(false);
  });

  it("is idempotent", () => {
    const { options, predictionGateChanges } = makeRecordingCallbacks();
    const c = new MatchStateController(options);
    c.setServerState(RoundState.PLAYING);
    predictionGateChanges.length = 0;
    c.resetPrediction();
    c.resetPrediction();
    c.resetPrediction();
    expect(predictionGateChanges).toEqual([false]);
  });
});

describe("MatchStateController — reset()", () => {
  it("restores initial state", () => {
    const { options } = makeRecordingCallbacks();
    const c = new MatchStateController(options);
    c.setServerState(RoundState.PLAYING);
    c.setServerState(RoundState.ROUND_OVER);
    c.setServerState(RoundState.MATCH_OVER, "w");
    c.reset();
    expect(c.state).toBe(RoundState.COUNTDOWN);
    expect(c.inputEnabled).toBe(false);
    expect(c.predictionActive).toBe(false);
    expect(c.matchOver).toBe(false);
  });

  it("does not fire callbacks", () => {
    const { options, inputGateChanges, predictionGateChanges, matchOverInfos, roundResetContexts } = makeRecordingCallbacks();
    const c = new MatchStateController(options);
    c.setServerState(RoundState.PLAYING);
    inputGateChanges.length = 0;
    predictionGateChanges.length = 0;
    matchOverInfos.length = 0;
    roundResetContexts.length = 0;
    c.reset();
    expect(inputGateChanges).toHaveLength(0);
    expect(predictionGateChanges).toHaveLength(0);
    expect(matchOverInfos).toHaveLength(0);
    expect(roundResetContexts).toHaveLength(0);
  });
});

describe("MatchStateController — full match lifecycle", () => {
  it("walks through a complete first-to-3 match", () => {
    const { options, inputGateChanges, roundResetContexts, matchOverInfos } = makeRecordingCallbacks();
    const c = new MatchStateController(options);
    // Round 1
    c.setServerState(RoundState.PLAYING);
    c.setServerState(RoundState.ROUND_OVER);
    c.setServerState(RoundState.COUNTDOWN);
    // Round 2
    c.setServerState(RoundState.PLAYING);
    c.setServerState(RoundState.ROUND_OVER);
    c.setServerState(RoundState.COUNTDOWN);
    // Round 3 (deciding)
    c.setServerState(RoundState.PLAYING);
    c.setServerState(RoundState.ROUND_OVER);
    c.setServerState(RoundState.MATCH_OVER, "player-b");
    expect(c.state).toBe(RoundState.MATCH_OVER);
    expect(c.matchOver).toBe(true);
    expect(roundResetContexts).toHaveLength(2);
    expect(matchOverInfos).toHaveLength(1);
    expect(matchOverInfos[0].winnerId).toBe("player-b");
    expect(inputGateChanges).toEqual([true, false, true, false, true, false]);
  });
});
