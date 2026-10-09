/**
 * Unit tests for the development-only movement smoothness metrics tracker.
 * The tracker must be pure and deterministic: rates are computed over a
 * fixed 1 s evaluation window, pending inputs track the ack horizon, and
 * `reset()` restores the pristine condition.
 */
import { describe, expect, it } from "vitest";
import { MovementSmoothnessMetrics } from "./movementMetrics";

function makeClock(): { clock: () => number; advance: (ms: number) => void } {
  let now = 0;
  return {
    clock: () => now,
    advance: (ms) => {
      now += ms;
    },
  };
}

describe("MovementSmoothnessMetrics", () => {
  it("starts in the pristine condition (nothing observed yet)", () => {
    const metrics = new MovementSmoothnessMetrics({
      clock: () => 0,
    });
    const reading = metrics.read();
    expect(reading).toEqual({
      frameMsAvg: 0,
      frameMsMax: 0,
      simTicksPerSec: 0,
      snapshotsPerSec: 0,
      snapshotGapMaxMs: 0,
      pendingInputs: 0,
      correctionsPerSec: 0,
      correctionMaxMeters: 0,
    });
    expect(metrics.pendingInputs).toBe(0);
  });

  it("averages render frame time with exponential smoothing and tracks the window max", () => {
    const { clock, advance } = makeClock();
    const metrics = new MovementSmoothnessMetrics({ clock });

    metrics.onRenderFrame(16); // seed: avg = 16
    advance(10);
    metrics.onRenderFrame(32); // avg = 16*0.9 + 32*0.1 = 17.6
    advance(10);
    const reading = metrics.read();
    expect(reading.frameMsAvg).toBeCloseTo(17.6, 5);
    expect(reading.frameMsMax).toBe(32);
  });

  it("ignores invalid frame times", () => {
    const metrics = new MovementSmoothnessMetrics({ clock: () => 0 });
    metrics.onRenderFrame(0);
    metrics.onRenderFrame(-5);
    metrics.onRenderFrame(Number.NaN);
    expect(metrics.read().frameMsAvg).toBe(0);
    expect(metrics.read().frameMsMax).toBe(0);
  });

  it("computes sim tick and snapshot rates over a completed 1 s window", () => {
    const { clock, advance } = makeClock();
    const metrics = new MovementSmoothnessMetrics({ clock });

    // Arm the window at t=0, then feed a full second of activity.
    metrics.onSnapshot(); // t=0
    advance(100);
    metrics.onSnapshot(); // t=100
    advance(100);
    metrics.onSnapshot(); // t=200
    for (let i = 0; i < 30; i++) metrics.onSimTick(); // 30 sim ticks in 1 s
    advance(800);
    metrics.onSnapshot(); // t=1000 -> window completes

    const reading = metrics.read();
    // Window = 1000 ms: 4 snapshots, 30 sim ticks.
    expect(reading.snapshotsPerSec).toBeCloseTo(4, 5);
    expect(reading.simTicksPerSec).toBeCloseTo(30, 5);
  });

  it("tracks the maximum gap between snapshot arrivals (jitter indicator)", () => {
    const { clock, advance } = makeClock();
    const metrics = new MovementSmoothnessMetrics({ clock });

    metrics.onSnapshot(); // t=0
    advance(45);
    metrics.onSnapshot(); // t=45  (45 ms gap)
    advance(70);
    metrics.onSnapshot(); // t=115 (70 ms gap)
    expect(metrics.read().snapshotGapMaxMs).toBe(70);
  });

  it("tracks pending inputs between sends and acks, clamped at zero", () => {
    const metrics = new MovementSmoothnessMetrics({ clock: () => 0 });

    metrics.onInputSent(0);
    metrics.onInputSent(1);
    metrics.onInputSent(2);
    expect(metrics.pendingInputs).toBe(3);

    metrics.onAck(1);
    expect(metrics.pendingInputs).toBe(1);

    // An ack beyond the last send must not go negative.
    metrics.onAck(10);
    expect(metrics.pendingInputs).toBe(0);

    // Out-of-order / stale sequences must not move the horizons backwards.
    metrics.onInputSent(20);
    metrics.onAck(5); // stale: the ack horizon stays at 10
    expect(metrics.pendingInputs).toBe(10);
  });

  it("counts corrections and tracks the maximum correction magnitude", () => {
    const metrics = new MovementSmoothnessMetrics({ clock: () => 0 });
    metrics.onCorrection(0.02);
    metrics.onCorrection(0.05);
    metrics.onCorrection(0.01);
    expect(metrics.read().correctionMaxMeters).toBeCloseTo(0.05, 5);

    // Invalid corrections are ignored entirely.
    metrics.onCorrection(Number.NaN);
    metrics.onCorrection(-1);

    const { clock, advance } = makeClock();
    const m2 = new MovementSmoothnessMetrics({ clock });
    m2.onSnapshot(); // arm the window at t=0
    m2.onCorrection(0.1);
    advance(1000);
    m2.onSnapshot(); // completes the 1 s window
    expect(m2.read().correctionsPerSec).toBeCloseTo(1, 5);
  });

  it("reset() restores the pristine condition", () => {
    const { clock, advance } = makeClock();
    const metrics = new MovementSmoothnessMetrics({ clock });
    metrics.onRenderFrame(16);
    metrics.onSimTick();
    metrics.onSnapshot();
    metrics.onInputSent(7);
    metrics.onCorrection(0.3);
    advance(2000);

    metrics.reset();
    expect(metrics.read()).toEqual({
      frameMsAvg: 0,
      frameMsMax: 0,
      simTicksPerSec: 0,
      snapshotsPerSec: 0,
      snapshotGapMaxMs: 0,
      pendingInputs: 0,
      correctionsPerSec: 0,
      correctionMaxMeters: 0,
    });
  });
});
