import { describe, expect, it } from "vitest";
import { InputBatcher, type InputSample } from "./inputBatcher";

/**
 * Drives one 1/60 substep through the batcher exactly the way the runtime
 * does: if idle, capture a fresh sample and begin the batch (this is also the
 * single network-send opportunity); then read the substep input and finish.
 */
function runSubstep(
  batcher: InputBatcher,
  fresh: InputSample,
): {
  /** The sample active for this substep (the one sent on the first substep). */
  sample: InputSample;
  substepInput: {
    moveX: number;
    moveZ: number;
    lookYaw: number;
    jumpPressed: boolean;
  };
  /** True when this substep started a fresh batch (= one send opportunity). */
  beganBatch: boolean;
} {
  const beganBatch = !batcher.hasActiveBatch();
  if (beganBatch) {
    batcher.beginBatch(fresh);
  }
  const sample = batcher.currentSample();
  const substepInput = batcher.currentSubstepInput();
  batcher.finishSubstep();
  return { sample, substepInput, beganBatch };
}

const sample = (
  moveX: number,
  moveZ: number,
  lookYaw = 0,
  lookPitch = 0,
  jump = false,
): InputSample => ({ moveX, moveZ, lookYaw, lookPitch, jump });

describe("InputBatcher — batching cadence", () => {
  it("starts idle, becomes active mid-batch, and is idle after two substeps", () => {
    const batcher = new InputBatcher();
    expect(batcher.hasActiveBatch()).toBe(false);

    batcher.beginBatch(sample(1, 0));
    expect(batcher.hasActiveBatch()).toBe(true);
    batcher.finishSubstep();
    expect(batcher.hasActiveBatch()).toBe(true);
    batcher.finishSubstep();
    expect(batcher.hasActiveBatch()).toBe(false);
  });

  it("captures fresh on substep 1, reuses on substep 2, fresh again on substep 3", () => {
    const batcher = new InputBatcher();

    const r1 = runSubstep(batcher, sample(1, 0, 0.5, 0.1));
    expect(r1.beganBatch).toBe(true);
    expect(r1.sample).toEqual(sample(1, 0, 0.5, 0.1));

    const r2 = runSubstep(batcher, sample(0, -1, 0.9, 0.2));
    expect(r2.beganBatch).toBe(false);
    expect(r2.sample).toEqual(sample(1, 0, 0.5, 0.1));

    const r3 = runSubstep(batcher, sample(-1, 0, 1.1, 0.3));
    expect(r3.beganBatch).toBe(true);
    expect(r3.sample).toEqual(sample(-1, 0, 1.1, 0.3));
  });

  it("captures exactly once per two substeps (one send opportunity per batch)", () => {
    const batcher = new InputBatcher();
    let captures = 0;
    for (let i = 1; i <= 6; i += 1) {
      if (runSubstep(batcher, sample(i, 0)).beganBatch) {
        captures += 1;
      }
    }
    expect(captures).toBe(3);
  });
});

describe("InputBatcher — movement / yaw / pitch", () => {
  it("reuses the first-batch movement axes and yaw exactly on the second substep", () => {
    const batcher = new InputBatcher();
    batcher.beginBatch(sample(0.75, -1, 0.4, 0.1));

    const first = batcher.currentSubstepInput();
    batcher.finishSubstep();
    const second = batcher.currentSubstepInput();

    expect(second.moveX).toBe(first.moveX);
    expect(second.moveZ).toBe(first.moveZ);
    expect(second.lookYaw).toBe(first.lookYaw);
  });

  it("a live movement change between the two substeps does not alter the active sample", () => {
    // The runtime captures once at batch start. The batcher never re-reads
    // input mid-batch, so held-key changes between substep A and B are
    // irrelevant to the active sample.
    const batcher = new InputBatcher();
    batcher.beginBatch(sample(1, 0, 0, 0));

    batcher.currentSubstepInput();
    batcher.finishSubstep();
    const second = batcher.currentSubstepInput();
    expect(second.moveX).toBe(1);
    expect(second.moveZ).toBe(0);
  });

  it("the next batch observes new movement and yaw", () => {
    const batcher = new InputBatcher();
    batcher.beginBatch(sample(1, 0, 0, 0));
    batcher.currentSubstepInput();
    batcher.finishSubstep();
    batcher.currentSubstepInput();
    batcher.finishSubstep();

    batcher.beginBatch(sample(-1, 1, 2.2, -0.3));
    const next = batcher.currentSubstepInput();
    expect(next.moveX).toBe(-1);
    expect(next.moveZ).toBe(1);
    expect(next.lookYaw).toBe(2.2);
  });
});

describe("InputBatcher — jump edge", () => {
  it("jump=true reaches the local simulation only on the batch's first substep", () => {
    const batcher = new InputBatcher();
    batcher.beginBatch(sample(0, 0, 0, 0, true));

    expect(batcher.currentSubstepInput().jumpPressed).toBe(true);
    batcher.finishSubstep();
    expect(batcher.currentSubstepInput().jumpPressed).toBe(false);
  });

  it("a jump arriving later belongs to the next batch, not the active one", () => {
    // Batch 1 was captured with no jump. The raw edge is latched in the
    // browser between batches and only the NEXT batch's fresh capture sees it.
    const batcher = new InputBatcher();
    batcher.beginBatch(sample(0, 0, 0, 0, false));
    expect(batcher.currentSubstepInput().jumpPressed).toBe(false);
    batcher.finishSubstep();
    expect(batcher.currentSubstepInput().jumpPressed).toBe(false);
    batcher.finishSubstep();
    expect(batcher.hasActiveBatch()).toBe(false);

    batcher.beginBatch(sample(0, 0, 0, 0, true));
    expect(batcher.currentSubstepInput().jumpPressed).toBe(true);
    batcher.finishSubstep();
    expect(batcher.currentSubstepInput().jumpPressed).toBe(false);
  });

  it("reset mid-batch discards the active sample so no stale jump survives", () => {
    const batcher = new InputBatcher();
    batcher.beginBatch(sample(0, 0, 0, 0, true));
    batcher.currentSubstepInput();
    batcher.finishSubstep(); // second substep still pending
    expect(batcher.hasActiveBatch()).toBe(true);

    batcher.reset();
    expect(batcher.hasActiveBatch()).toBe(false);
    // The next substep starts a FRESH batch; the old jump=true cannot be reused.
    batcher.beginBatch(sample(0, 0, 0, 0, false));
    expect(batcher.currentSubstepInput().jumpPressed).toBe(false);
  });

  it("throws when a substep is read without an active batch (wiring guard)", () => {
    const batcher = new InputBatcher();
    expect(() => batcher.currentSubstepInput()).toThrow();
    expect(() => batcher.finishSubstep()).toThrow();
  });
});

describe("InputBatcher — one source of input per batch", () => {
  it("currentSample is the raw captured frame (jump intact) for the network send", () => {
    const batcher = new InputBatcher();
    const raw = sample(0.5, -1, 0.7, -0.2, true);
    batcher.beginBatch(raw);

    expect(batcher.currentSample()).toEqual(raw);
    // The substep input masks the jump edge on the second substep, but the
    // raw sample — what the network frame carries — keeps jump=true.
    batcher.finishSubstep();
    expect(batcher.currentSample()).toEqual(raw);
    expect(batcher.currentSubstepInput().jumpPressed).toBe(false);
  });

  it("beginBatch rejects a second begin while a batch is active", () => {
    const batcher = new InputBatcher();
    batcher.beginBatch(sample(0, 0));
    expect(() => batcher.beginBatch(sample(0, 0))).toThrow();
  });
});
