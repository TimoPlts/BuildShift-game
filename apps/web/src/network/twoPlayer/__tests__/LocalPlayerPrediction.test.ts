/**
 * Unit tests for LocalPlayerPrediction — the client-side prediction and
 * reconciliation engine for the two-player movement system.
 *
 * These tests exercise the module's public API directly:
 *  - predict(): advance local prediction with a sequence of inputs
 *  - onServerState(): reconciliation (discard acknowledged, reapply unacknowledged)
 *  - getCurrentState(): the exposed predicted state
 *  - reset(): back to the initial spawn state
 *
 * The shared simulation step (stepFullMovement from @buildshift/simulation)
 * is used internally by the predictor, so the tests verify that positions
 * advance correctly with known input sequences.
 */
import { describe, expect, it } from "vitest";
import {
  LocalPlayerPrediction,
  SIMULATION_TICK_SECONDS,
  CORRECTION_SNAP_THRESHOLD,
  CORRECTION_SMOOTH_FRAMES,
  type PredictedState,
} from "../index";
import type { BufferedInput } from "../index";

function forwardInput(overrides: Partial<{
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  crouch: boolean;
}> = {}) {
  return {
    moveX: 0,
    moveZ: -1,
    yaw: 0,
    pitch: 0,
    jump: false,
    crouch: false,
    ...overrides,
  };
}

function makeBufferedInput(
  sequence: number,
  overrides: Partial<{
    moveX: number;
    moveZ: number;
    yaw: number;
    pitch: number;
    jump: boolean;
    crouch: boolean;
  }> = {},
): BufferedInput {
  return {
    input: {
      sequence,
      moveX: 0,
      moveZ: -1,
      yaw: 0,
      pitch: 0,
      jump: false,
      crouch: false,
      ...overrides,
    },
    predictedX: 0,
    predictedY: 0,
    predictedZ: 0,
    predictedVelocityY: 0,
    predictedGrounded: true,
  };
}

function predictForward(predictor: LocalPlayerPrediction, n: number): PredictedState {
  let state: PredictedState;
  for (let i = 0; i < n; i++) {
    state = predictor.predict(forwardInput());
  }
  return state!;
}

const DIST_PER_TICK = 6 * SIMULATION_TICK_SECONDS; // 0.2

describe("LocalPlayerPrediction — Prediction", () => {
  it("starts at the initial spawn state (0, groundY=0, 0)", () => {
    const predictor = new LocalPlayerPrediction();
    const state = predictor.getCurrentState();
    expect(state.x).toBe(0);
    expect(state.y).toBe(0);
    expect(state.z).toBe(0);
    expect(state.yaw).toBe(0);
    expect(state.velocityY).toBe(0);
    expect(state.grounded).toBe(true);
  });

  it("predicts forward movement along -Z with yaw=0", () => {
    const predictor = new LocalPlayerPrediction();
    const state = predictForward(predictor, 1);

    expect(state.x).toBeCloseTo(0, 10);
    expect(state.z).toBeCloseTo(-DIST_PER_TICK, 10);
    expect(state.y).toBe(0);
    expect(state.grounded).toBe(true);
  });

  it("advances linearly over multiple ticks", () => {
    const predictor = new LocalPlayerPrediction();
    const ticks = 10;
    const state = predictForward(predictor, ticks);

    expect(state.z).toBeCloseTo(-DIST_PER_TICK * ticks, 8);
    expect(state.x).toBeCloseTo(0, 10);
    expect(state.y).toBe(0);
    expect(state.grounded).toBe(true);
  });

  it("resets to the initial state after reset()", () => {
    const predictor = new LocalPlayerPrediction();
    predictForward(predictor, 5);
    expect(predictor.getCurrentState().z).toBeCloseTo(-DIST_PER_TICK * 5, 8);

    predictor.reset();
    const state = predictor.getCurrentState();
    expect(state.x).toBe(0);
    expect(state.y).toBe(0);
    expect(state.z).toBe(0);
    expect(state.velocityY).toBe(0);
    expect(state.grounded).toBe(true);
    expect(predictor.lastAckSequence).toBe(-1);
  });
});

describe("LocalPlayerPrediction — Reconciliation", () => {
  it("reconciles with zero divergence when prediction matches the server", () => {
    const predictor = new LocalPlayerPrediction();

    predictForward(predictor, 5);

    const serverState = {
      x: 0,
      y: 0,
      z: -DIST_PER_TICK * 4,
      yaw: 0,
      velocityY: 0,
      grounded: true,
      sequence: 3,
    };

    const bufferedInputs: BufferedInput[] = [0, 1, 2, 3, 4].map((seq) =>
      makeBufferedInput(seq),
    );

    const correctionDistance = predictor.onServerState(serverState, bufferedInputs);

    // (a) Inputs <= 3 are discarded (only input 4 is reapplied).
    // (b) Input 4 is reapplied on top of authoritative (0, 0, -0.8):
    //     z = -0.8 + (-0.2) = -1.0
    // (c) Correction distance ~0 (prediction matched the server).
    const final = predictor.getCurrentState();
    expect(final.z).toBeCloseTo(-DIST_PER_TICK * 5, 8);
    expect(final.x).toBeCloseTo(0, 10);
    expect(final.y).toBe(0);

    expect(correctionDistance).not.toBeNull();
    expect(correctionDistance!).toBeLessThan(0.001);
    expect(predictor.lastAckSequence).toBe(3);
  });

  it("reapplies only unacknowledged inputs on top of the authoritative position", () => {
    const predictor = new LocalPlayerPrediction();

    predictForward(predictor, 7);

    const serverState = {
      x: 0,
      y: 0,
      z: -DIST_PER_TICK * 6,
      yaw: 0,
      velocityY: 0,
      grounded: true,
      sequence: 5,
    };

    const bufferedInputs: BufferedInput[] = Array.from({ length: 7 }, (_, i) =>
      makeBufferedInput(i),
    );

    predictor.onServerState(serverState, bufferedInputs);

    // After reapplying input 6 (seq=6) on top of authoritative:
    // z = -1.2 + (-0.2) = -1.4
    const final = predictor.getCurrentState();
    expect(final.z).toBeCloseTo(-DIST_PER_TICK * 7, 8);
  });

  it("ignores stale server states (sequence <= lastAck)", () => {
    const predictor = new LocalPlayerPrediction();
    predictForward(predictor, 5);

    const serverState1 = {
      x: 0, y: 0, z: -DIST_PER_TICK * 4,
      yaw: 0, velocityY: 0, grounded: true,
      sequence: 3,
    };
    const bufferedInputs: BufferedInput[] = [0, 1, 2, 3, 4].map(makeBufferedInput);

    predictor.onServerState(serverState1, bufferedInputs);
    expect(predictor.lastAckSequence).toBe(3);

    const staleState = {
      x: 99, y: 0, z: -0.5,
      yaw: 0, velocityY: 0, grounded: true,
      sequence: 2,
    };

    const result = predictor.onServerState(staleState, bufferedInputs);
    expect(result).toBeNull();
    expect(predictor.lastAckSequence).toBe(3);

    const state = predictor.getCurrentState();
    expect(state.z).toBeCloseTo(-DIST_PER_TICK * 5, 8);
  });

  it("applies a smooth correction when divergence is small (< snap threshold)", () => {
    const predictor = new LocalPlayerPrediction();

    predictForward(predictor, 5);

    const divergence = 0.1;
    const serverState = {
      x: divergence,
      y: 0,
      z: -DIST_PER_TICK * 4,
      yaw: 0,
      velocityY: 0,
      grounded: true,
      sequence: 3,
    };

    const bufferedInputs: BufferedInput[] = [0, 1, 2, 3, 4].map(makeBufferedInput);
    const correctionDistance = predictor.onServerState(serverState, bufferedInputs);

    // The correction distance should be ~0.1 (the X divergence).
    expect(correctionDistance!).toBeCloseTo(divergence, 8);
    expect(correctionDistance!).toBeLessThan(CORRECTION_SNAP_THRESHOLD);

    // With a smooth correction active, getCurrentState() lerps from the
    // pre-reconcile position toward the corrected position.
    // correctionRemaining starts at CORRECTION_SMOOTH_FRAMES (5).
    // t = 1 - correctionRemaining / CORRECTION_SMOOTH_FRAMES
    // At the first frame: t = 1 - 5/5 = 0 → returns pre-reconcile x (0).
    const firstFrame = predictor.getCurrentState();
    expect(firstFrame.x).toBeCloseTo(0, 10);

    // After CORRECTION_SMOOTH_FRAMES predict() calls, the smoothing is
    // complete and the position matches the corrected value.
    let final: PredictedState;
    for (let i = 0; i < CORRECTION_SMOOTH_FRAMES; i++) {
      final = predictor.predict(forwardInput());
    }
    // Internal x = divergence. After 5 more forward ticks:
    // z = -1.0 + (-0.2 * 5) = -2.0
    expect(final!.x).toBeCloseTo(divergence, 8);
    expect(final!.z).toBeCloseTo(-DIST_PER_TICK * 10, 8);
  });

  it("snaps immediately when divergence exceeds CORRECTION_SNAP_THRESHOLD", () => {
    const predictor = new LocalPlayerPrediction();

    predictForward(predictor, 5);

    const largeDivergence = 10;
    const serverState = {
      x: largeDivergence,
      y: 0,
      z: -DIST_PER_TICK * 4,
      yaw: 0,
      velocityY: 0,
      grounded: true,
      sequence: 3,
    };

    const bufferedInputs: BufferedInput[] = [0, 1, 2, 3, 4].map(makeBufferedInput);
    const correctionDistance = predictor.onServerState(serverState, bufferedInputs);

    // After reapplying input 4: x ≈ 10, z ≈ -1.0
    // Snap: correctionFrom = null → getCurrentState() returns internal state.
    const final = predictor.getCurrentState();
    expect(final.x).toBeCloseTo(largeDivergence, 8);
    expect(final.z).toBeCloseTo(-DIST_PER_TICK * 5, 8);

    expect(correctionDistance!).toBeGreaterThan(CORRECTION_SNAP_THRESHOLD);

    const afterPredict = predictor.predict(forwardInput());
    expect(afterPredict.x).toBeCloseTo(largeDivergence, 8);
    expect(afterPredict.z).toBeCloseTo(-DIST_PER_TICK * 6, 8);
  });

  it("clears stale predictions when the server diverges significantly", () => {
    const predictor = new LocalPlayerPrediction();

    predictForward(predictor, 10);

    const serverState = {
      x: 50,
      y: 10,
      z: 20,
      yaw: 1.5,
      velocityY: 5,
      grounded: false,
      sequence: 9,
    };

    const bufferedInputs: BufferedInput[] = Array.from({ length: 10 }, (_, i) =>
      makeBufferedInput(i),
    );

    const correctionDistance = predictor.onServerState(serverState, bufferedInputs);

    // All inputs are acknowledged (<= 9), nothing reapplied.
    const final = predictor.getCurrentState();
    expect(final.x).toBeCloseTo(50, 10);
    expect(final.y).toBeCloseTo(10, 10);
    expect(final.z).toBeCloseTo(20, 10);
    expect(final.yaw).toBeCloseTo(1.5, 10);

    expect(correctionDistance!).toBeGreaterThan(CORRECTION_SNAP_THRESHOLD);

    // Subsequent predictions continue from the new state, not the old one.
    const next = predictor.predict(forwardInput());
    expect(next.z).toBeCloseTo(20 - DIST_PER_TICK, 8);
    expect(next.x).toBeCloseTo(50, 8);
  });
});
