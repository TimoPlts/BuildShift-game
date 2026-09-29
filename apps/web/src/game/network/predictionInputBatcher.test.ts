import { describe, expect, it, vi } from "vitest";
import {
  PredictionInputBatcher,
  type PredictionInputSample,
} from "./predictionInputBatcher";

function sample(overrides: Partial<PredictionInputSample> = {}): PredictionInputSample {
  return {
    moveX: 0,
    moveZ: 0,
    lookYaw: 0,
    lookPitch: 0,
    jump: false,
    ...overrides,
  };
}

/**
 * Wires a batcher to a mutable fake "browser input": the capture callback
 * reads the current live values and a polled jump edge, so tests can change
 * the live input between substeps and verify the active batch never sees it.
 */
function createLiveInput() {
  const live = {
    movement: { x: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    pendingJump: false,
  };
  const capture = vi.fn(() => {
    const jump = live.pendingJump;
    live.pendingJump = false;
    return {
      moveX: live.movement.x,
      moveZ: live.movement.z,
      lookYaw: live.yaw,
      lookPitch: live.pitch,
      jump,
    };
  });
  return { live, capture, batcher: new PredictionInputBatcher(capture) };
}

describe("PredictionInputBatcher", () => {
  it("captures a fresh sample on the first substep of a batch", () => {
    const { capture, batcher } = createLiveInput();
    const first = batcher.nextSubstep();
    expect(first.firstSubstep).toBe(true);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(first.sample).toEqual(sample());
  });

  it("reuses the stored sample on the second substep without re-capturing", () => {
    const { capture, batcher } = createLiveInput();
    const first = batcher.nextSubstep();
    const second = batcher.nextSubstep();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(second.firstSubstep).toBe(false);
    expect(second.sample).toBe(first.sample);
  });

  it("captures a new sample on the third substep (new batch)", () => {
    const { capture, live, batcher } = createLiveInput();
    const first = batcher.nextSubstep();
    batcher.nextSubstep();
    live.movement = { x: 1, z: -1 };
    live.yaw = 0.5;
    live.pitch = -0.25;
    const third = batcher.nextSubstep();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(third.firstSubstep).toBe(true);
    expect(third.sample).not.toBe(first.sample);
    expect(third.sample).toEqual(
      sample({ moveX: 1, moveZ: -1, lookYaw: 0.5, lookPitch: -0.25 }),
    );
  });

  it("invokes the capture callback exactly once per two substeps", () => {
    const { capture, batcher } = createLiveInput();
    for (let i = 0; i < 6; i++) {
      batcher.nextSubstep();
    }
    expect(capture).toHaveBeenCalledTimes(3);
  });

  it("reuses the same movement axes across the batch pair", () => {
    const { live, capture, batcher } = createLiveInput();
    live.movement = { x: 1, z: 0.5 };
    const first = batcher.nextSubstep();
    // Live movement changes mid-batch — the active sample must not mutate.
    live.movement = { x: -1, z: 1 };
    capture.mockClear();
    const second = batcher.nextSubstep();
    expect(capture).not.toHaveBeenCalled();
    expect(second.sample).toEqual(
      sample({ moveX: 1, moveZ: 0.5 }),
    );
    expect(second.sample).toBe(first.sample);
  });

  it("observes new movement only on the next batch", () => {
    const { live, batcher } = createLiveInput();
    batcher.nextSubstep();
    batcher.nextSubstep();
    live.movement = { x: -1, z: 1 };
    const next = batcher.nextSubstep();
    expect(next.sample).toEqual(sample({ moveX: -1, moveZ: 1 }));
  });

  it("reuses the same yaw/pitch across the batch pair", () => {
    const { live, batcher } = createLiveInput();
    live.yaw = 1.0;
    live.pitch = 0.3;
    const first = batcher.nextSubstep();
    live.yaw = 2.0;
    live.pitch = 0.9;
    const second = batcher.nextSubstep();
    expect(second.sample).toEqual(
      sample({ lookYaw: 1.0, lookPitch: 0.3 }),
    );
    expect(second.sample).toBe(first.sample);
  });

  it("uses updated yaw/pitch on the next batch", () => {
    const { live, batcher } = createLiveInput();
    live.yaw = 1.0;
    batcher.nextSubstep();
    batcher.nextSubstep();
    live.yaw = 2.0;
    live.pitch = 0.4;
    const next = batcher.nextSubstep();
    expect(next.sample).toEqual(sample({ lookYaw: 2.0, lookPitch: 0.4 }));
  });

  it("exposes a jump from a fresh batch only via that batch's first substep", () => {
    const { live, capture, batcher } = createLiveInput();
    live.pendingJump = true;
    const first = batcher.nextSubstep();
    expect(first.sample.jump).toBe(true);
    const second = batcher.nextSubstep();
    expect(second.sample).toBe(first.sample);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("does not consume a jump that lands mid-batch — it belongs to the next batch", () => {
    const { live, capture, batcher } = createLiveInput();
    batcher.nextSubstep();
    // Space goes down between substep 1 and substep 2 of batch 1.
    live.pendingJump = true;
    const second = batcher.nextSubstep();
    // The mid-batch press must NOT be captured for the active batch…
    expect(capture).toHaveBeenCalledTimes(1);
    expect(second.sample.jump).toBe(false);
    // …but it stays latched and is captured by the NEXT fresh batch.
    const next = batcher.nextSubstep();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(next.sample.jump).toBe(true);
  });

  it("reset() discards an open batch so the next substep captures fresh input", () => {
    const { live, capture, batcher } = createLiveInput();
    live.movement = { x: 1, z: 1 };
    const first = batcher.nextSubstep();
    live.movement = { x: 0, z: 0 };
    batcher.reset();
    const afterReset = batcher.nextSubstep();
    // A fresh capture ran after the reset (not a reuse of the open batch).
    expect(capture).toHaveBeenCalledTimes(2);
    expect(afterReset.firstSubstep).toBe(true);
    expect(afterReset.sample).not.toBe(first.sample);
    expect(afterReset.sample).toEqual(sample());
  });

  it("reset() also discards a mid-batch jump sample cleanly", () => {
    const { live, batcher } = createLiveInput();
    live.pendingJump = true;
    batcher.nextSubstep();
    batcher.reset();
    const next = batcher.nextSubstep();
    expect(next.sample.jump).toBe(false);
  });
});
