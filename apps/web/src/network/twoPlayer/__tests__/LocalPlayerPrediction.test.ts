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

function fwd(overrides: Partial<{ moveX: number; moveZ: number; yaw: number; pitch: number; jump: boolean; crouch: boolean }> = {}) {
  return { moveX: 0, moveZ: -1, yaw: 0, pitch: 0, jump: false, crouch: false, ...overrides };
}

function buf(seq: number, overrides: Partial<{ moveX: number; moveZ: number; lookYaw: number; lookPitch: number; jump: boolean; crouch: boolean }> = {}): BufferedInput {
  return {
    input: { sequence: seq, moveX: 0, moveZ: -1, lookYaw: 0, lookPitch: 0, jump: false, sprint: false, crouch: false, primaryFire: false, secondaryFire: false, ...overrides },
    predictedX: 0, predictedY: 0, predictedZ: 0,
    predictedVelocityY: 0, predictedGrounded: true,
  };
}

function predictN(p: LocalPlayerPrediction, n: number): PredictedState {
  let s: PredictedState;
  for (let i = 0; i < n; i++) s = p.predict(fwd());
  return s!;
}

const D = 6 * SIMULATION_TICK_SECONDS; // 0.2 m per tick

describe("LocalPlayerPrediction — Prediction", () => {
  it("starts at the initial spawn state (0, groundY=0, 0)", () => {
    const p = new LocalPlayerPrediction();
    const s = p.getCurrentState();
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
    expect(s.z).toBe(0);
    expect(s.yaw).toBe(0);
    expect(s.velocityY).toBe(0);
    expect(s.grounded).toBe(true);
  });

  it("predicts forward movement along -Z with yaw=0", () => {
    const p = new LocalPlayerPrediction();
    const s = predictN(p, 1);
    expect(s.x).toBeCloseTo(0, 10);
    expect(s.z).toBeCloseTo(-D, 10);
    expect(s.y).toBe(0);
    expect(s.grounded).toBe(true);
  });

  it("advances linearly over multiple ticks", () => {
    const p = new LocalPlayerPrediction();
    const s = predictN(p, 10);
    expect(s.z).toBeCloseTo(-D * 10, 8);
    expect(s.x).toBeCloseTo(0, 10);
    expect(s.y).toBe(0);
    expect(s.grounded).toBe(true);
  });

  it("predicts rightward movement along +X with yaw=π/2", () => {
    const p = new LocalPlayerPrediction();
    const s = p.predict(fwd({ yaw: Math.PI / 2 }));
    expect(s.x).toBeCloseTo(D, 10);
    expect(s.z).toBeCloseTo(0, 10);
    expect(s.y).toBe(0);
    expect(s.grounded).toBe(true);
  });

  it("does not advance position when no input is provided (idle)", () => {
    const p = new LocalPlayerPrediction();
    const s = p.predict(fwd({ moveX: 0, moveZ: 0 }));
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
    expect(s.y).toBe(0);
    expect(s.grounded).toBe(true);
  });

  it("resets to the initial state after reset()", () => {
    const p = new LocalPlayerPrediction();
    predictN(p, 5);
    expect(p.getCurrentState().z).toBeCloseTo(-D * 5, 8);
    p.reset();
    const s = p.getCurrentState();
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
    expect(s.z).toBe(0);
    expect(s.velocityY).toBe(0);
    expect(s.grounded).toBe(true);
    expect(p.lastAckSequence).toBe(-1);
  });
});

describe("LocalPlayerPrediction — Reconciliation", () => {
  it("reconciles with zero divergence when prediction matches the server", () => {
    const p = new LocalPlayerPrediction();
    predictN(p, 5);
    const server = { x: 0, y: 0, z: -D * 4, yaw: 0, velocityY: 0, grounded: true, sequence: 3 };
    const inputs = [0, 1, 2, 3, 4].map((i) => buf(i));
    const dist = p.onServerState(server, inputs);

    // (a) Inputs <= 3 discarded, (b) input 4 reapplied, (c) distance ~0
    const s = p.getCurrentState();
    expect(s.z).toBeCloseTo(-D * 5, 8);
    expect(s.x).toBeCloseTo(0, 10);
    expect(s.y).toBe(0);
    expect(dist).not.toBeNull();
    expect(dist!).toBeLessThan(0.001);
    expect(p.lastAckSequence).toBe(3);
  });

  it("reapplies only unacknowledged inputs on top of the authoritative position", () => {
    const p = new LocalPlayerPrediction();
    predictN(p, 7);
    const server = { x: 0, y: 0, z: -D * 6, yaw: 0, velocityY: 0, grounded: true, sequence: 5 };
    const inputs = Array.from({ length: 7 }, (_, i) => buf(i));
    p.onServerState(server, inputs);

    // Reapplied input 6: z = -1.2 + (-0.2) = -1.4
    expect(p.getCurrentState().z).toBeCloseTo(-D * 7, 8);
  });

  it("ignores stale server states (sequence <= lastAck)", () => {
    const p = new LocalPlayerPrediction();
    predictN(p, 5);
    const s1 = { x: 0, y: 0, z: -D * 4, yaw: 0, velocityY: 0, grounded: true, sequence: 3 };
    const inputs = [0, 1, 2, 3, 4].map((i) => buf(i));
    p.onServerState(s1, inputs);
    expect(p.lastAckSequence).toBe(3);

    const stale = { x: 99, y: 0, z: -0.5, yaw: 0, velocityY: 0, grounded: true, sequence: 2 };
    const result = p.onServerState(stale, inputs);
    expect(result).toBeNull();
    expect(p.lastAckSequence).toBe(3);
    expect(p.getCurrentState().z).toBeCloseTo(-D * 5, 8);
  });

  it("applies a smooth correction when divergence is small (< snap threshold)", () => {
    const p = new LocalPlayerPrediction();
    predictN(p, 5);
    const divergence = 0.1;
    const server = { x: divergence, y: 0, z: -D * 4, yaw: 0, velocityY: 0, grounded: true, sequence: 3 };
    const inputs = [0, 1, 2, 3, 4].map((i) => buf(i));
    const dist = p.onServerState(server, inputs);

    expect(dist!).toBeCloseTo(divergence, 8);
    expect(dist!).toBeLessThan(CORRECTION_SNAP_THRESHOLD);

    // First frame of smooth correction: t=0 → returns pre-reconcile x (0).
    expect(p.getCurrentState().x).toBeCloseTo(0, 10);

    // After CORRECTION_SMOOTH_FRAMES predict() calls, smoothing is complete.
    let s: PredictedState;
    for (let i = 0; i < CORRECTION_SMOOTH_FRAMES; i++) s = p.predict(fwd());
    expect(s!.x).toBeCloseTo(divergence, 8);
    expect(s!.z).toBeCloseTo(-D * 10, 8);
  });

  it("snaps immediately when divergence exceeds CORRECTION_SNAP_THRESHOLD", () => {
    const p = new LocalPlayerPrediction();
    predictN(p, 5);
    const big = 10;
    const server = { x: big, y: 0, z: -D * 4, yaw: 0, velocityY: 0, grounded: true, sequence: 3 };
    const inputs = [0, 1, 2, 3, 4].map((i) => buf(i));
    const dist = p.onServerState(server, inputs);

    const s = p.getCurrentState();
    expect(s.x).toBeCloseTo(big, 8);
    expect(s.z).toBeCloseTo(-D * 5, 8);
    expect(dist!).toBeGreaterThan(CORRECTION_SNAP_THRESHOLD);

    const next = p.predict(fwd());
    expect(next.x).toBeCloseTo(big, 8);
    expect(next.z).toBeCloseTo(-D * 6, 8);
  });

  it("clears stale predictions when the server diverges significantly", () => {
    const p = new LocalPlayerPrediction();
    predictN(p, 10);
    const server = { x: 50, y: 10, z: 20, yaw: 1.5, velocityY: 5, grounded: false, sequence: 9 };
    const inputs = Array.from({ length: 10 }, (_, i) => buf(i));
    const dist = p.onServerState(server, inputs);

    const s = p.getCurrentState();
    expect(s.x).toBeCloseTo(50, 10);
    expect(s.y).toBeCloseTo(10, 10);
    expect(s.z).toBeCloseTo(20, 10);
    expect(s.yaw).toBeCloseTo(1.5, 10);
    expect(dist!).toBeGreaterThan(CORRECTION_SNAP_THRESHOLD);

    const next = p.predict(fwd());
    expect(next.z).toBeCloseTo(20 - D, 8);
    expect(next.x).toBeCloseTo(50, 8);
  });

  it("handles reconciliation with all inputs acknowledged (nothing to reapply)", () => {
    const p = new LocalPlayerPrediction();
    predictN(p, 3);
    const server = { x: 0, y: 0, z: -D * 3, yaw: 0, velocityY: 0, grounded: true, sequence: 2 };
    const inputs = [0, 1, 2].map((i) => buf(i));
    const dist = p.onServerState(server, inputs);

    const s = p.getCurrentState();
    expect(s.z).toBeCloseTo(-D * 3, 10);
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
    expect(dist).not.toBeNull();
    expect(dist!).toBeLessThan(0.001);
  });

  it("handles multiple consecutive reconciliations correctly", () => {
    const p = new LocalPlayerPrediction();
    predictN(p, 5);

    // First reconcile: server acks seq 3.
    p.onServerState(
      { x: 0, y: 0, z: -D * 3, yaw: 0, velocityY: 0, grounded: true, sequence: 3 },
      [0, 1, 2, 3, 4].map((i) => buf(i)),
    );

    // Predict 2 more ticks.
    p.predict(fwd());
    p.predict(fwd());

    // Second reconcile: server acks seq 4, authoritative at -1.4.
    p.onServerState(
      { x: 0, y: 0, z: -D * 7, yaw: 0, velocityY: 0, grounded: true, sequence: 4 },
      [5, 6].map((i) => buf(i)),
    );

    // Reapplied inputs 5,6: z = -1.4 + (-0.4) = -1.8
    expect(p.getCurrentState().z).toBeCloseTo(-D * 9, 8);
    expect(p.lastAckSequence).toBe(4);
  });

  it("tracks lastCorrectionDistance accessor correctly", () => {
    const p = new LocalPlayerPrediction();
    predictN(p, 5);
    expect(p.lastCorrectionDistance).toBeNull();

    p.onServerState(
      { x: 0, y: 0, z: -D * 4, yaw: 0, velocityY: 0, grounded: true, sequence: 3 },
      [0, 1, 2, 3, 4].map((i) => buf(i)),
    );

    expect(p.lastCorrectionDistance).not.toBeNull();
    expect(p.lastCorrectionDistance!).toBeLessThan(0.001);
  });
});
