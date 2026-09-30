import { describe, expect, it } from "vitest";
import { PredictionHistory } from "./predictionHistory";
import type { PredictionState } from "./predictionState";
import {
  CORRECTION_EPSILON_METERS,
  ReconciliationEngine,
  type AuthoritativeLocalSnapshot,
  type ReconciliationEngineDeps,
} from "./reconciliation";
import type { InputSample, SubstepInput } from "./inputBatcher";

/**
 * A controllable, recording fake for the ReconciliationEngine deps. No
 * Babylon / Rapier / browser — pure objects only.
 */
class EngineHarness {
  readonly history = new PredictionHistory();

  /** Every state the fake "controller" restores. */
  readonly restoredStates: PredictionState[] = [];
  /** Every authoritative (position, yaw) the fake applies. */
  readonly appliedAuthoritative: { position: { x: number; y: number; z: number }; yaw: number }[] = [];
  /** Every substep input the fake simulated (in order). */
  readonly simulated: SubstepInput[] = [];
  /** When set, the matching dep throws on first use (fail-safe test). */
  throwOn: keyof Pick<ReconciliationEngineDeps, "restorePredictionState" | "setAuthoritativePosition" | "simulateSubstep" | "capturePredictionState"> | null = null;

  /** A simple, deterministic "world" so replay is observable. */
  world = { x: 0, y: 0, z: 0, vy: 0, grounded: true, jumpBuffer: 0, coyote: 0, yaw: 0 };

  /** The single engine instance for this harness (stable across calls). */
  private engineInstance: ReconciliationEngine | null = null;

  get engine(): ReconciliationEngine {
    if (this.engineInstance) {
      return this.engineInstance;
    }
    const self = this;
    const deps: ReconciliationEngineDeps = {
      history: this.history,
      capturePredictionState: () => {
        self.guard("capturePredictionState");
        return {
          position: { x: self.world.x, y: self.world.y, z: self.world.z },
          verticalVelocity: self.world.vy,
          lastGrounded: self.world.grounded,
          jump: { jumpBufferRemaining: self.world.jumpBuffer, coyoteRemaining: self.world.coyote },
          facingYaw: self.world.yaw,
        };
      },
      restorePredictionState: (state) => {
        self.guard("restorePredictionState");
        self.world = {
          x: state.position.x,
          y: state.position.y,
          z: state.position.z,
          vy: state.verticalVelocity,
          grounded: state.lastGrounded,
          jumpBuffer: state.jump.jumpBufferRemaining,
          coyote: state.jump.coyoteRemaining,
          yaw: state.facingYaw,
        };
        self.restoredStates.push(state);
      },
      setAuthoritativePosition: (position, yaw) => {
        self.guard("setAuthoritativePosition");
        self.world.x = position.x;
        self.world.y = position.y;
        self.world.z = position.z;
        self.world.yaw = yaw;
        self.appliedAuthoritative.push({
          position: { x: position.x, y: position.y, z: position.z },
          yaw,
        });
      },
      simulateSubstep: (input) => {
        self.guard("simulateSubstep");
        // A tiny, deterministic "physics" so replay movement is observable and
        // monotonic: each substep shifts x by moveX (unit intent) and applies
        // the jump edge as a +y bump. This is test-only, not real sim math.
        self.world.x += input.moveX * 0.5;
        self.world.z += input.moveZ * 0.5;
        if (input.jumpPressed) {
          self.world.vy = 1;
        } else {
          self.world.vy = Math.max(0, self.world.vy - 0.5);
        }
        self.world.y += self.world.vy * 0.1;
        self.simulated.push(input);
      },
    };
    this.engineInstance = new ReconciliationEngine(deps);
    return this.engineInstance;
  }

  private guard(name: string): void {
    if (this.throwOn === name) {
      this.throwOn = null; // throw once
      throw new Error(`boom:${name}`);
    }
  }
}

function stateAt(x: number, z = 0): PredictionState {
  return {
    position: { x, y: 0, z },
    verticalVelocity: 0,
    lastGrounded: true,
    jump: { jumpBufferRemaining: 0, coyoteRemaining: 0 },
    facingYaw: 0,
  };
}

const sample = (over: Partial<InputSample> = {}): InputSample => ({
  moveX: 1,
  moveZ: 0,
  lookYaw: 0,
  lookPitch: 0,
  jump: false,
  ...over,
});

/** Seed the history with entries 1..n at predictable positions. */
function seed(h: EngineHarness, n: number): void {
  for (let seq = 1; seq <= n; seq += 1) {
    h.history.append(seq, sample(), stateAt(seq));
  }
}

const snap = (
  ack: number,
  pos: { x: number; y: number; z: number },
  yaw = 0.3,
): AuthoritativeLocalSnapshot => ({
  position: pos,
  yaw,
  acknowledgedSequence: ack,
});

describe("ReconciliationEngine — ACK handling", () => {
  it("ignores ack < 0 (nothing processed yet)", () => {
    const h = new EngineHarness();
    seed(h, 3);
    const r = h.engine.reconcile(snap(-1, { x: 0, y: 0, z: 0 }));

    expect(r.action).toBe("ignored");
    expect(r.lastReconciledAck).toBe(-1);
    expect(h.restoredStates).toHaveLength(0);
    expect(h.simulated).toHaveLength(0);
    expect(h.history.size).toBe(3); // nothing pruned
  });

  it("accepts a first valid ack that matches within epsilon", () => {
    const h = new EngineHarness();
    seed(h, 3);
    const r = h.engine.reconcile(snap(1, { x: 1, y: 0, z: 0 }));

    expect(r.action).toBe("accepted");
    expect(r.lastReconciledAck).toBe(1);
    expect(h.history.size).toBe(2); // entry 1 pruned
  });

  it("ignores a duplicate ack (same as lastReconciledAck)", () => {
    const h = new EngineHarness();
    seed(h, 3);
    h.engine.reconcile(snap(2, { x: 2, y: 0, z: 0 }));
    const r = h.engine.reconcile(snap(2, { x: 2, y: 0, z: 0 }));

    expect(r.action).toBe("ignored");
    expect(r.pruned).toBe(0);
    expect(r.lastReconciledAck).toBe(2);
  });

  it("ignores an older ack (less than lastReconciledAck) without re-pruning", () => {
    const h = new EngineHarness();
    seed(h, 5);
    const first = h.engine.reconcile(snap(4, { x: 4, y: 0, z: 0 }));
    expect(first.pruned).toBe(4); // 1..4 confirmed
    const r = h.engine.reconcile(snap(2, { x: 2, y: 0, z: 0 }));

    expect(r.action).toBe("ignored");
    expect(r.lastReconciledAck).toBe(4);
    expect(r.pruned).toBe(0); // older ack prunes nothing new
    // The still-unconfirmed entry 5 is untouched by the ignored older ack.
    expect(h.history.get(5)).not.toBeNull();
    expect(h.restoredStates).toHaveLength(0);
  });

  it("lastReconciledAck never decreases across mixed acks", () => {
    const h = new EngineHarness();
    seed(h, 10);
    const seen: number[] = [];
    for (const ack of [1, 3, 2, 5, 4, 7, 6, 9]) {
      const r = h.engine.reconcile(snap(ack, { x: ack, y: 0, z: 0 }));
      seen.push(r.lastReconciledAck);
    }
    // The reported lastReconciledAck must be monotonically non-decreasing.
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
    expect(h.engine.lastReconciledAck).toBe(9);
  });
});

describe("ReconciliationEngine — NO correction (within epsilon)", () => {
  it("does not restore or replay when within epsilon, but does prune confirmed history", () => {
    const h = new EngineHarness();
    seed(h, 3);
    // Tiny drift, comfortably under epsilon.
    const r = h.engine.reconcile(snap(2, { x: 2 + 0.01, y: 0.005, z: 0.01 }));

    expect(r.action).toBe("accepted");
    expect(r.correctionDistance).toBeGreaterThan(0);
    expect(r.correctionDistance).toBeLessThanOrEqual(CORRECTION_EPSILON_METERS);
    expect(h.restoredStates).toHaveLength(0);
    expect(h.appliedAuthoritative).toHaveLength(0);
    expect(h.simulated).toHaveLength(0);
    expect(r.pruned).toBe(2);
    expect(h.history.get(2)).toBeNull();
    expect(h.history.get(3)).not.toBeNull();
  });

  it("accepts an exact-match (zero-distance) snapshot without rollback", () => {
    const h = new EngineHarness();
    seed(h, 2);
    const r = h.engine.reconcile(snap(1, { x: 1, y: 0, z: 0 }));
    expect(r.action).toBe("accepted");
    expect(r.correctionDistance).toBe(0);
    expect(h.restoredStates).toHaveLength(0);
    expect(h.simulated).toHaveLength(0);
  });
});

describe("ReconciliationEngine — CORRECTION", () => {
  it("triggers a correction when the authoritative position is outside epsilon", () => {
    const h = new EngineHarness();
    seed(h, 3);
    // Server says we're far from where entry 2 predicted.
    const r = h.engine.reconcile(snap(2, { x: 99, y: 0, z: 0 }));

    expect(r.action).toBe("corrected");
    expect(h.restoredStates).toHaveLength(1);
    expect(h.simulated.length).toBeGreaterThan(0);
  });

  it("restores the checkpoint AT the ack and applies authoritative position + yaw", () => {
    const h = new EngineHarness();
    seed(h, 3);
    h.engine.reconcile(snap(2, { x: 99, y: 0, z: 0 }, 0.9));

    // Restored state is entry 2's checkpoint (position.x === 2, yaw 0).
    expect(h.restoredStates[0].position.x).toBe(2);
    // Authoritative position + yaw were applied after the restore.
    const last = h.appliedAuthoritative[0];
    expect(last.position.x).toBe(99);
    expect(last.yaw).toBe(0.9);
    expect(h.world.yaw).toBe(0.9);
  });

  it("replays only the entries with sequence > ack, in ascending order", () => {
    const h = new EngineHarness();
    seed(h, 5);
    const r = h.engine.reconcile(snap(3, { x: 99, y: 0, z: 0 }));

    expect(r.replayedSequences).toEqual([4, 5]);
  });

  it("simulates exactly two substeps per replayed input", () => {
    const h = new EngineHarness();
    seed(h, 4);
    h.engine.reconcile(snap(2, { x: 99, y: 0, z: 0 })); // replays 3, 4

    expect(h.simulated.length).toBe(4); // 2 substeps x 2 inputs
  });

  it("applies the jump edge ONLY on replay substep A (first substep) of a jumping input", () => {
    const h = new EngineHarness();
    // Entry 3 is a jump sample; entries 1,2,4 are not.
    h.history.append(1, sample(), stateAt(1));
    h.history.append(2, sample(), stateAt(2));
    h.history.append(3, sample({ jump: true }), stateAt(3));
    h.history.append(4, sample(), stateAt(4));

    h.engine.reconcile(snap(2, { x: 99, y: 0, z: 0 })); // replays 3, 4

    // Replay order: 3a, 3b, 4a, 4b.
    expect(h.simulated[0].jumpPressed).toBe(true); // 3a — jump edge
    expect(h.simulated[1].jumpPressed).toBe(false); // 3b — forced false
    expect(h.simulated[2].jumpPressed).toBe(false); // 4a — no jump
    expect(h.simulated[3].jumpPressed).toBe(false); // 4b — forced false
  });

  it("replays every substep with the same movement axes + yaw as the stored sample", () => {
    const h = new EngineHarness();
    const moving = sample({ moveX: 0, moveZ: -1, lookYaw: 0.4 });
    h.history.append(1, sample(), stateAt(1));
    h.history.append(2, moving, stateAt(2));
    h.engine.reconcile(snap(1, { x: 99, y: 0, z: 0 })); // replays 2

    expect(h.simulated[0].moveX).toBe(0);
    expect(h.simulated[0].moveZ).toBe(-1);
    expect(h.simulated[0].lookYaw).toBe(0.4);
    expect(h.simulated[1].moveX).toBe(0);
    expect(h.simulated[1].moveZ).toBe(-1);
    expect(h.simulated[1].lookYaw).toBe(0.4);
  });

  it("sends ZERO network frames during replay (no network dependency is invoked)", () => {
    // ReconciliationEngineDeps has no network send member at all — replay is
    // purely local simulation. We assert no authoritative re-apply beyond the
    // single correction point, and no extra restore happens per replayed input.
    const h = new EngineHarness();
    seed(h, 5);
    h.engine.reconcile(snap(3, { x: 99, y: 0, z: 0 })); // replays 4,5

    // Exactly ONE restore (the checkpoint at ack) and ONE authoritative apply.
    expect(h.restoredStates).toHaveLength(1);
    expect(h.appliedAuthoritative).toHaveLength(1);
    // 2 inputs x 2 substeps of local simulation, nothing else.
    expect(h.simulated.length).toBe(4);
  });

  it("replaces the stored checkpoints of replayed inputs with the new predicted states", () => {
    const h = new EngineHarness();
    seed(h, 4);
    h.engine.reconcile(snap(2, { x: 99, y: 0, z: 0 })); // replays 3,4

    // Entry 3's old checkpoint was position.x===3; after replay it must be a
    // NEW state (the replayed world position), no longer the stale 3.
    const entry3 = h.history.get(3)!;
    expect(entry3.state.position.x).not.toBe(3);
    // Entry 4 likewise updated.
    const entry4 = h.history.get(4)!;
    expect(entry4.state.position.x).not.toBe(4);
    // The samples are preserved (only the state is replaced).
    expect(entry3.sample).toEqual(sample());
    expect(entry4.sample).toEqual(sample());
  });
});

describe("ReconciliationEngine — GAPS", () => {
  it("does not throw when an ack has no stored checkpoint", () => {
    const h = new EngineHarness();
    // Only entry 1 exists; ack 2 is a gap (e.g. an input-clear frame).
    h.history.append(1, sample(), stateAt(1));

    expect(() => h.engine.reconcile(snap(2, { x: 50, y: 0, z: 0 }))).not.toThrow();
  });

  it("advances lastReconciledAck even when the ack itself is a gap", () => {
    const h = new EngineHarness();
    h.history.append(1, sample(), stateAt(1));

    const r = h.engine.reconcile(snap(2, { x: 50, y: 0, z: 0 })); // gap at 2

    expect(r.action).toBe("no-checkpoint");
    expect(r.lastReconciledAck).toBe(2);
    expect(h.engine.lastReconciledAck).toBe(2);
  });

  it("returns 'no-checkpoint' (not a crash, no rollback) for a true gap ack", () => {
    const h = new EngineHarness();
    h.history.append(1, sample(), stateAt(1));
    h.history.append(2, sample(), stateAt(2));

    const r = h.engine.reconcile(snap(3, { x: 50, y: 0, z: 0 })); // no entry 3

    expect(r.action).toBe("no-checkpoint");
    expect(r.lastReconciledAck).toBe(3);
    expect(r.pruned).toBe(2); // entries 1,2 confirmed + pruned
    expect(h.restoredStates).toHaveLength(0);
    expect(h.simulated).toHaveLength(0);
  });

  it("a later matching checkpoint can reconcile normally after a gap", () => {
    const h = new EngineHarness();
    h.history.append(1, sample(), stateAt(1));
    h.history.append(4, sample(), stateAt(4)); // 2,3 are gaps

    const gap = h.engine.reconcile(snap(3, { x: 50, y: 0, z: 0 }));
    expect(gap.action).toBe("no-checkpoint");

    // Now entry 4 exists and is a genuine mismatch -> corrected.
    const r = h.engine.reconcile(snap(4, { x: 99, y: 0, z: 0 }));
    expect(r.action).toBe("corrected");
    expect(h.restoredStates[0].position.x).toBe(4);
  });
});

describe("ReconciliationEngine — EVICTION", () => {
  it("does not crash when the ack's checkpoint was evicted by the history cap", () => {
    const h = new EngineHarness();
    // Fill beyond the cap so the earliest sequences (1..10) are evicted.
    for (let seq = 1; seq <= 266; seq += 1) {
      h.history.append(seq, sample(), stateAt(seq));
    }
    expect(h.history.get(1)).toBeNull(); // evicted

    // Ack 1 (evicted): must not throw; treated as no-checkpoint.
    let r: ReturnType<ReconciliationEngine["reconcile"]>;
    expect(() => {
      r = h.engine.reconcile(snap(1, { x: 99, y: 0, z: 0 }));
    }).not.toThrow();
    expect(r!.action).toBe("no-checkpoint");
    expect(r!.lastReconciledAck).toBe(1);
  });
});

describe("ReconciliationEngine — FAIL SAFE", () => {
  it("a throwing dependency does not crash the caller", () => {
    const h = new EngineHarness();
    seed(h, 3);
    h.throwOn = "setAuthoritativePosition";

    let r: ReturnType<ReconciliationEngine["reconcile"]>;
    expect(() => {
      r = h.engine.reconcile(snap(2, { x: 99, y: 0, z: 0 }));
    }).not.toThrow();

    expect(r!.error).toBe("boom:setAuthoritativePosition");
    // The ack still advanced (fail-safe: no re-processing / backwards ack).
    expect(r!.lastReconciledAck).toBe(2);
  });

  it("history remains in a safe, usable state after a failed correction", () => {
    const h = new EngineHarness();
    seed(h, 3);
    h.throwOn = "simulateSubstep"; // throws mid-replay

    h.engine.reconcile(snap(2, { x: 99, y: 0, z: 0 }));

    // History must still be queryable: the pruned entry is gone, unacked kept.
    expect(h.history.get(2)).toBeNull();
    expect(h.history.get(3)).not.toBeNull();
    expect(() => h.engine.reconcile(snap(3, { x: 3, y: 0, z: 0 }))).not.toThrow();
  });
});

describe("ReconciliationEngine — EPSILON boundary", () => {
  it("a distance exactly AT the epsilon does NOT correct", () => {
    const h = new EngineHarness();
    seed(h, 2);
    // Entry 2 predicted (2,0,0); place the server exactly epsilon away.
    const r = h.engine.reconcile(
      snap(2, { x: 2 + CORRECTION_EPSILON_METERS, y: 0, z: 0 }),
    );
    expect(r.action).toBe("accepted");
    expect(h.simulated).toHaveLength(0);
  });

  it("a distance just INSIDE the epsilon does NOT correct", () => {
    const h = new EngineHarness();
    seed(h, 2);
    const r = h.engine.reconcile(
      snap(2, { x: 2 + CORRECTION_EPSILON_METERS - 0.001, y: 0, z: 0 }),
    );
    expect(r.action).toBe("accepted");
    expect(h.simulated).toHaveLength(0);
  });

  it("a distance clearly OUTSIDE the epsilon DOES correct", () => {
    const h = new EngineHarness();
    seed(h, 3); // entry 3 exists so a correction replays something
    const r = h.engine.reconcile(
      snap(2, { x: 2 + CORRECTION_EPSILON_METERS + 0.5, y: 0, z: 0 }),
    );
    expect(r.action).toBe("corrected");
    expect(r.correctionDistance).toBeGreaterThan(CORRECTION_EPSILON_METERS);
    expect(h.restoredStates).toHaveLength(1);
    expect(h.appliedAuthoritative).toHaveLength(1);
    expect(h.simulated.length).toBeGreaterThan(0); // entry 3 replayed
  });
});
