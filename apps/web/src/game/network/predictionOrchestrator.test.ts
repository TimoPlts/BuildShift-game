import { describe, expect, it } from "vitest";
import {
  PredictionOrchestrator,
  type PredictionOrchestratorDeps,
} from "./predictionOrchestrator";
import type { InputSample, SubstepInput } from "./inputBatcher";
import { PredictionHistory } from "./predictionHistory";
import type { PredictionState } from "./predictionState";

/** A deterministic fake state whose position encodes the simulation tick. */
function fakeState(tick: number): PredictionState {
  return {
    position: { x: tick, y: 0, z: 0 },
    verticalVelocity: 0,
    lastGrounded: true,
    jump: { jumpBufferRemaining: 0, coyoteRemaining: 0 },
    facingYaw: 0,
  };
}

/**
 * Records every dependency call so tests can assert cadence, content, and
 * history recording. `history` is the real (pure) `PredictionHistory`;
 * `capturePredictionState` returns a state whose x-position encodes the tick at
 * which it was captured (i.e. after how many substeps have run).
 */
class Harness {
  readonly sent: InputSample[] = [];
  readonly simulated: SubstepInput[] = [];
  /** The real history the orchestrator records completed batches into. */
  readonly history = new PredictionHistory();
  /** The exact state objects returned by capturePredictionState, in order. */
  readonly capturedStates: PredictionState[] = [];
  /** Samples the fake "browser" returns, in capture order. */
  private readonly queue: InputSample[] = [];
  /** When true, sendSample reports a disconnected connection (returns null). */
  disconnected = false;
  captures = 0;
  private tick = 0;

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
        this.tick += 1;
        this.simulated.push(input);
      },
      history: this.history,
      capturePredictionState: () => {
        const state = fakeState(this.tick);
        this.capturedStates.push(state);
        return state;
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

describe("PredictionOrchestrator — history recording", () => {
  it("records sequence N ONLY after substep B, with the exact sent sample and the post-B state", () => {
    const sample = { moveX: 1, moveZ: 0, lookYaw: 0.2, lookPitch: 0.1, jump: false };
    const h = new Harness().enqueue(sample);
    const o = h.orchestrator();

    o.stepSubstep(); // substep A
    expect(h.history.size).toBe(0); // no checkpoint after one substep
    expect(h.history.get(0)).toBeNull();

    o.stepSubstep(); // substep B → batch complete, sequence 0 recorded
    expect(h.history.size).toBe(1);
    expect(h.history.lastSequence).toBe(0);
    const entry = h.history.get(0);
    expect(entry).not.toBeNull();
    // The stored sample equals the exact captured / sent sample.
    expect(entry!.sample).toEqual(sample);
    expect(h.sent[0]).toEqual(sample);
    // The stored state is the one captured AFTER substep B (after 2 substeps),
    // and it is deep-copied (later simulation can't mutate the checkpoint).
    expect(entry!.state.position.x).toBe(2);
    expect(h.capturedStates).toHaveLength(1);
    expect(entry!.state.position.x).toBe(h.capturedStates[0].position.x);
  });

  it("keeps each sequence associated with its own exact sample, in sequence order", () => {
    const s0 = { moveX: 1, moveZ: 0, lookYaw: 0, lookPitch: 0, jump: false };
    const s1 = { moveX: 0, moveZ: -1, lookYaw: 0.5, lookPitch: 0, jump: false };
    const s2 = { moveX: -1, moveZ: 0, lookYaw: 1, lookPitch: 0, jump: false };
    const h = new Harness().enqueue(s0, s1, s2);
    const o = h.orchestrator();
    for (let i = 0; i < 6; i += 1) {
      o.stepSubstep(); // 3 batches
    }
    expect(h.history.size).toBe(3);
    expect(h.history.get(0)!.sample).toEqual(s0);
    expect(h.history.get(1)!.sample).toEqual(s1);
    expect(h.history.get(2)!.sample).toEqual(s2);
    // Checkpoints recorded in ascending sequence order.
    expect(h.history.after(0)!.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it("does not record when disconnected, but both substeps still simulate", () => {
    const h = new Harness().enqueue({
      moveX: 1,
      moveZ: 0,
      lookYaw: 0,
      lookPitch: 0,
      jump: false,
    });
    h.disconnected = true;
    const o = h.orchestrator();

    o.stepSubstep();
    o.stepSubstep();

    expect(h.sent.length).toBe(0);
    expect(h.simulated.length).toBe(2); // local prediction continues
    expect(h.history.size).toBe(0); // no sequence → no checkpoint
    expect(h.capturedStates).toHaveLength(0); // state never captured
  });

  it("does not record a sequence whose batch is reset before substep B, then records the next normally", () => {
    const h = new Harness().enqueue(
      { moveX: 1, moveZ: 0, lookYaw: 0, lookPitch: 0, jump: false }, // batch 1 (reset)
      { moveX: 0.5, moveZ: 0.5, lookYaw: 0, lookPitch: 0, jump: false }, // batch 2 (complete)
    );
    const o = h.orchestrator();

    o.stepSubstep(); // batch 1 substep A → send returns sequence 0
    o.resetBatch(); // discard before substep B
    expect(h.history.size).toBe(0); // sequence 0 NOT recorded
    expect(o.hasActiveBatch()).toBe(false);

    o.stepSubstep(); // batch 2 substep A → send returns sequence 1
    o.stepSubstep(); // batch 2 substep B → recorded
    expect(h.history.size).toBe(1);
    expect(h.history.lastSequence).toBe(1);
    expect(h.history.get(0)).toBeNull(); // 0 was never recorded
  });

  it("input-clear discards the partial batch, sends neutral, and leaves a legitimate gap", () => {
    const h = new Harness().enqueue(
      { moveX: 1, moveZ: 0, lookYaw: 0.3, lookPitch: 0, jump: false }, // batch 1
      { moveX: 0.25, moveZ: 0, lookYaw: 0, lookPitch: 0, jump: false }, // post-clear
    );
    const o = h.orchestrator();

    o.stepSubstep(); // batch 1 substep A → sequence 0
    o.clearAndSendNeutral({ moveX: 0, moveZ: 0, lookYaw: 0.3, lookPitch: 0, jump: false });
    // The neutral frame consumes the next sequence (1) but records nothing.
    expect(h.sent.length).toBe(2);
    expect(h.history.size).toBe(0); // neither 0 (reset) nor 1 (neutral) recorded
    expect(o.hasActiveBatch()).toBe(false);

    o.stepSubstep(); // fresh batch A → sequence 2
    o.stepSubstep(); // fresh batch B → recorded
    expect(h.history.size).toBe(1);
    expect(h.history.lastSequence).toBe(2);
    expect(h.history.get(1)).toBeNull(); // neutral sequence 1 → the gap
  });

  it("preserves jump edge semantics (A = captured edge, B = forced false) alongside recording", () => {
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

    expect(h.simulated[0].jumpPressed).toBe(true); // A
    expect(h.simulated[1].jumpPressed).toBe(false); // B
    expect(h.sent[0].jump).toBe(true); // network frame keeps captured intent
    expect(h.history.get(0)).not.toBeNull();
  });
});
