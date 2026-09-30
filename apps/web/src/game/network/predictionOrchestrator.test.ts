import { describe, expect, it } from "vitest";
import {
  PredictionOrchestrator,
  type PredictionOrchestratorDeps,
} from "./predictionOrchestrator";
import type { InputSample, SubstepInput } from "./inputBatcher";

/** Records every dependency call so tests can assert cadence and content. */
class Harness {
  readonly sent: InputSample[] = [];
  readonly simulated: SubstepInput[] = [];
  /** Samples the fake "browser" returns, in capture order. */
  private readonly queue: InputSample[] = [];
  /** When true, sendSample reports a disconnected connection (returns null). */
  disconnected = false;
  captures = 0;

  constructor() {
    this.deps = {
      captureInput: () => {
        this.captures += 1;
        return this.queue.length > 0 ? this.queue.shift()! : neutral(0);
      },
      sendSample: (sample) => {
        if (this.disconnected) {
          return null;
        }
        this.sent.push(sample);
        return this.sent.length - 1;
      },
      simulateSubstep: (input) => {
        this.simulated.push(input);
      },
    };
  }

  enqueue(...samples: InputSample[]): this {
    this.queue.push(...samples);
    return this;
  }

  /** Build the orchestrator wired to this harness. */
  orchestrator(): PredictionOrchestrator {
    return new PredictionOrchestrator(this.deps);
  }

  private readonly deps: PredictionOrchestratorDeps;
}

const neutral = (lookYaw = 0, lookPitch = 0): InputSample => ({
  moveX: 0,
  moveZ: 0,
  lookYaw,
  lookPitch,
  jump: false,
});

describe("PredictionOrchestrator — network send timing", () => {
  it("sends exactly one sample per 30 Hz batch, never one per substep", () => {
    const h = new Harness().enqueue(
      { moveX: 1, moveZ: 0, lookYaw: 0, lookPitch: 0, jump: false },
      { moveX: 0, moveZ: -1, lookYaw: 0, lookPitch: 0, jump: false },
    );
    const o = h.orchestrator();

    // 4 substeps = 2 batches.
    o.stepSubstep();
    o.stepSubstep();
    o.stepSubstep();
    o.stepSubstep();

    expect(h.sent.length).toBe(2);
    expect(h.simulated.length).toBe(4);
  });

  it("never consumes a send when disconnected, but still simulates locally", () => {
    const h = new Harness().enqueue(
      { moveX: 1, moveZ: 0, lookYaw: 0, lookPitch: 0, jump: false },
    );
    h.disconnected = true;
    const o = h.orchestrator();

    o.stepSubstep();
    o.stepSubstep();

    expect(h.sent.length).toBe(0);
    // Local prediction must continue regardless of network state.
    expect(h.simulated.length).toBe(2);
  });
});

describe("PredictionOrchestrator — one source of input per batch", () => {
  it("feeds the captured sample to both local simulation and the network frame", () => {
    const captured = { moveX: 0.5, moveZ: -1, lookYaw: 0.7, lookPitch: -0.2, jump: false };
    const h = new Harness().enqueue(captured);
    const o = h.orchestrator();

    o.stepSubstep();
    o.stepSubstep();

    // The network frame carries the raw captured sample.
    expect(h.sent[0]).toEqual(captured);
    // Both substeps simulated with the same movement axes + yaw.
    expect(h.simulated[0].moveX).toBe(0.5);
    expect(h.simulated[0].moveZ).toBe(-1);
    expect(h.simulated[0].lookYaw).toBe(0.7);
    expect(h.simulated[1].moveX).toBe(0.5);
    expect(h.simulated[1].moveZ).toBe(-1);
    expect(h.simulated[1].lookYaw).toBe(0.7);
  });

  it("captures input exactly once per two substeps", () => {
    const h = new Harness();
    const o = h.orchestrator();
    for (let i = 0; i < 6; i += 1) {
      o.stepSubstep();
    }
    expect(h.captures).toBe(3);
  });

  it("does not re-capture mid-batch even if live input changes", () => {
    // The browser would report *different* axes on a second capture, but the
    // orchestrator only captures at batch start, so the active batch keeps the
    // original axes on substep B.
    const h = new Harness().enqueue(
      { moveX: 1, moveZ: 0, lookYaw: 0, lookPitch: 0, jump: false },
      { moveX: -1, moveZ: 1, lookYaw: 9, lookPitch: 9, jump: false },
    );
    const o = h.orchestrator();

    o.stepSubstep(); // batch 1 substep A (captures moveX=1)
    o.stepSubstep(); // batch 1 substep B (must still use moveX=1)
    o.stepSubstep(); // batch 2 substep A (captures moveX=-1)

    expect(h.simulated[0].moveX).toBe(1);
    expect(h.simulated[1].moveX).toBe(1);
    expect(h.simulated[2].moveX).toBe(-1);
  });
});

describe("PredictionOrchestrator — jump edge", () => {
  it("delivers the jump edge to the local simulation on substep A only", () => {
    const h = new Harness().enqueue({
      moveX: 0,
      moveZ: 0,
      lookYaw: 0,
      lookPitch: 0,
      jump: true,
    });
    const o = h.orchestrator();

    o.stepSubstep();
    o.stepSubstep();

    expect(h.simulated[0].jumpPressed).toBe(true);
    expect(h.simulated[1].jumpPressed).toBe(false);
    // The network frame still reports the captured jump intent.
    expect(h.sent[0].jump).toBe(true);
  });

  it("a jump captured in a later batch only affects that later batch", () => {
    const h = new Harness().enqueue(
      { moveX: 0, moveZ: 0, lookYaw: 0, lookPitch: 0, jump: false },
      { moveX: 0, moveZ: 0, lookYaw: 0, lookPitch: 0, jump: true },
    );
    const o = h.orchestrator();

    o.stepSubstep(); // batch 1 A
    o.stepSubstep(); // batch 1 B
    o.stepSubstep(); // batch 2 A (jump)
    o.stepSubstep(); // batch 2 B

    expect(h.simulated[0].jumpPressed).toBe(false);
    expect(h.simulated[1].jumpPressed).toBe(false);
    expect(h.simulated[2].jumpPressed).toBe(true);
    expect(h.simulated[3].jumpPressed).toBe(false);
  });
});

describe("PredictionOrchestrator — input clear", () => {
  it("clearAndSendNeutral discards the active batch and sends one neutral frame", () => {
    const h = new Harness().enqueue({
      moveX: 1,
      moveZ: 0,
      lookYaw: 0.4,
      lookPitch: 0.1,
      jump: false,
    });
    const o = h.orchestrator();

    o.stepSubstep(); // start batch, send captured sample
    expect(o.hasActiveBatch()).toBe(true);

    o.clearAndSendNeutral({ moveX: 0, moveZ: 0, lookYaw: 0.4, lookPitch: 0.1, jump: false });

    // The neutral frame is sent immediately...
    expect(h.sent[h.sent.length - 1]).toEqual({
      moveX: 0,
      moveZ: 0,
      lookYaw: 0.4,
      lookPitch: 0.1,
      jump: false,
    });
    // ...and the half-finished batch is gone, so the next substep is fresh.
    expect(o.hasActiveBatch()).toBe(false);
  });

  it("the substep after a clear captures a fresh sample (no stale reuse)", () => {
    const h = new Harness().enqueue(
      { moveX: 1, moveZ: 0, lookYaw: 0, lookPitch: 0, jump: false }, // batch 1
      { moveX: 0.25, moveZ: 0.75, lookYaw: 1.3, lookPitch: 0.2, jump: false }, // post-clear
    );
    const o = h.orchestrator();

    o.stepSubstep(); // batch 1 A (simulated[0], moveX=1)
    o.clearAndSendNeutral(neutral());
    o.stepSubstep(); // fresh batch A (simulated[1]) — must use the NEW capture,
    // not the stale moveX=1

    expect(h.simulated[0].moveX).toBe(1);
    expect(h.simulated[1].moveX).toBe(0.25);
    expect(h.simulated[1].moveZ).toBe(0.75);
    expect(h.simulated[1].lookYaw).toBe(1.3);
  });

  it("resetBatch discards a half-finished batch without sending", () => {
    const h = new Harness().enqueue({
      moveX: 1,
      moveZ: 0,
      lookYaw: 0,
      lookPitch: 0,
      jump: false,
    });
    const o = h.orchestrator();

    o.stepSubstep(); // start batch (1 send)
    const sentBefore = h.sent.length;
    o.resetBatch(); // spiral-of-death guard path
    expect(o.hasActiveBatch()).toBe(false);
    expect(h.sent.length).toBe(sentBefore); // resetBatch sends nothing
  });
});
