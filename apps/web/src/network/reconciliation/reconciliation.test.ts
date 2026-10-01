import { describe, expect, it } from "vitest";
import {
  movementInputToWorld,
  stepHorizontalMovement,
} from "@buildshift/simulation";
import {
  ReconciliationPipeline,
  RECONCILIATION_MAX_BUFFERED_INPUTS,
  RECONCILIATION_TICK_SECONDS,
  type AuthoritativeSnapshot,
  type BufferedLocalInput,
  type Vec3,
} from "./reconciliation";

// Pure, deterministic tests for the snapshot-based local-player reconciliation
// pipeline. The network layer is never touched (snapshots are delivered straight
// to `reconcile`), and the expected corrected position is computed independently
// with the SAME pure `stepHorizontalMovement` step the pipeline uses.

const TICK = RECONCILIATION_TICK_SECONDS; // 1/30 s
const MOVE_SPEED = 6;

const forward = (sequence: number): BufferedLocalInput => ({
  sequence,
  moveX: 0,
  moveZ: -1, // camera-forward
  lookYaw: 0,
});

const right = (sequence: number): BufferedLocalInput => ({
  sequence,
  moveX: 1,
  moveZ: 0,
  lookYaw: 0,
});

function stateAt(x: number, y = 0, z = 0) {
  return { position: { x, y, z }, velocity: { x: 0, y: 0, z: 0 } };
}

/** Oracle: start at `start`, replay `inputs` in order with the shared step. */
function oracleReplay(start: Vec3, inputs: BufferedLocalInput[]): Vec3 {
  let position: Vec3 = { x: start.x, y: start.y, z: start.z };
  for (const input of inputs) {
    const world = movementInputToWorld(
      { x: input.moveX, z: input.moveZ },
      input.lookYaw,
    );
    const stepped = stepHorizontalMovement(
      { x: position.x, z: position.z },
      world,
      TICK,
      { moveSpeed: MOVE_SPEED },
    );
    position = { x: stepped.x, y: position.y, z: stepped.z };
  }
  return position;
}

function assertPositionClose(actual: Vec3, expected: Vec3, label: string): void {
  expect(actual.x, `${label}: x`).toBeCloseTo(expected.x, 9);
  expect(actual.y, `${label}: y`).toBeCloseTo(expected.y, 9);
  expect(actual.z, `${label}: z`).toBeCloseTo(expected.z, 9);
}

describe("ReconciliationPipeline — DIVERGENCE correction", () => {
  it("replays unacknowledged inputs on top of the snapshot position after the prediction has drifted", () => {
    // Local prediction has drifted badly (a missed input / divergent step).
    const pipeline = new ReconciliationPipeline(stateAt(50, 0, -40), {
      moveSpeed: MOVE_SPEED,
      tickSeconds: TICK,
    });
    for (let seq = 1; seq <= 6; seq += 1) {
      pipeline.recordInput(forward(seq));
    }
    expect(pipeline.bufferedInputCount).toBe(6);

    // Authoritative up to seq 3, at a very different position. Inputs 4,5,6 are
    // still unacknowledged (ack is BEHIND the local buffer).
    const snapshot: AuthoritativeSnapshot = {
      position: { x: 0.5, y: 0, z: -2 },
      velocity: { x: 0, y: 0, z: 1 },
      lastProcessedSequence: 3,
    };

    const outcome = pipeline.reconcile(snapshot);

    expect(outcome.reconciled).toBe(true);
    expect(outcome.reason).toBe("reconciled");
    expect(outcome.replayedSequences).toEqual([4, 5, 6]);

    // Corrected position == snapshot position + replay of 4,5,6.
    const expected = oracleReplay(snapshot.position, [
      forward(4),
      forward(5),
      forward(6),
    ]);
    const final = pipeline.getState().position;
    assertPositionClose(final, expected, "reconciled");
    // The drifted pre-reconcile position is gone; velocity adopted from snapshot.
    expect(final.x).not.toBeCloseTo(50, 0);
    expect(final.z).not.toBeCloseTo(-40, 0);
    expect(pipeline.getState().velocity).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("replays nothing and adopts the snapshot when the ack is at the buffer's head", () => {
    const pipeline = new ReconciliationPipeline(stateAt(99, 0, 99), {
      moveSpeed: MOVE_SPEED,
      tickSeconds: TICK,
    });
    pipeline.recordInput(forward(1));
    const outcome = pipeline.reconcile({
      position: { x: 4, y: 0, z: 4 },
      velocity: { x: 0, y: 0, z: 0 },
      lastProcessedSequence: 1,
    });
    expect(outcome.reconciled).toBe(true);
    expect(outcome.replayedSequences).toEqual([]);
    assertPositionClose(pipeline.getState().position, { x: 4, y: 0, z: 4 }, "adopt");
  });
});

describe("ReconciliationPipeline — LATE / stale snapshot", () => {
  it("ignores a snapshot whose ack is behind the reconciled ack (no-op, state untouched)", () => {
    const pipeline = new ReconciliationPipeline(stateAt(0, 0, 0), {
      moveSpeed: MOVE_SPEED,
      tickSeconds: TICK,
    });
    for (let seq = 1; seq <= 5; seq += 1) {
      pipeline.recordInput(right(seq));
    }
    const good = pipeline.reconcile({
      position: { x: 3, y: 0, z: 0 },
      velocity: { x: 2, y: 0, z: 0 },
      lastProcessedSequence: 5,
    });
    expect(good.reconciled).toBe(true);
    const afterGood = pipeline.getState();

    // A LATE snapshot with an OLDER ack (2) and a very different position.
    const late = pipeline.reconcile({
      position: { x: 999, y: 0, z: 999 },
      velocity: { x: 0, y: 0, z: 0 },
      lastProcessedSequence: 2,
    });
    expect(late.reconciled).toBe(false);
    expect(late.reason).toBe("ignored-stale");
    expect(late.replayedSequences).toEqual([]);

    // State is EXACTLY what the good snapshot produced — untouched.
    const afterLate = pipeline.getState();
    expect(afterLate.position).toEqual(afterGood.position);
    expect(afterLate.velocity).toEqual(afterGood.velocity);
    expect(pipeline.lastReconciledSequence).toBe(5);
  });

  it("is idempotent for a duplicate (same-ack) snapshot", () => {
    const pipeline = new ReconciliationPipeline(stateAt(0, 0, 0), {
      moveSpeed: MOVE_SPEED,
      tickSeconds: TICK,
    });
    pipeline.recordInput(forward(1));
    const snap = { position: { x: 1, y: 0, z: 1 }, velocity: { x: 0, y: 0, z: 0 }, lastProcessedSequence: 1 };
    expect(pipeline.reconcile(snap).reconciled).toBe(true);
    const afterFirst = pipeline.getState();
    const duplicate = pipeline.reconcile(snap);
    expect(duplicate.reconciled).toBe(false);
    expect(duplicate.reason).toBe("ignored-stale");
    expect(pipeline.getState().position).toEqual(afterFirst.position);
  });
});

describe("ReconciliationPipeline — OUT-OF-ORDER snapshot", () => {
  it("reconciles only the highest-ack snapshot when snapshots arrive out of order", () => {
    const pipeline = new ReconciliationPipeline(stateAt(0, 0, 0), {
      moveSpeed: MOVE_SPEED,
      tickSeconds: TICK,
    });
    for (let seq = 1; seq <= 8; seq += 1) {
      pipeline.recordInput(forward(seq));
    }

    // Snapshot B (higher ack = 6) arrives FIRST.
    const b = pipeline.reconcile({
      position: { x: 10, y: 0, z: -12 },
      velocity: { x: 0, y: 0, z: 0 },
      lastProcessedSequence: 6,
    });
    expect(b.reconciled).toBe(true);
    expect(b.reason).toBe("reconciled");
    expect(b.replayedSequences).toEqual([7, 8]);
    const afterB = pipeline.getState();

    // Snapshot A (lower ack = 4) arrives SECOND — older than B.
    const a = pipeline.reconcile({
      position: { x: -50, y: 0, z: 50 },
      velocity: { x: 0, y: 0, z: 0 },
      lastProcessedSequence: 4,
    });
    expect(a.reconciled).toBe(false);
    expect(a.reason).toBe("ignored-stale");
    expect(a.replayedSequences).toEqual([]);

    // State is exactly what B produced — A did not roll it back.
    const final = pipeline.getState();
    expect(final.position).toEqual(afterB.position);
    expect(final.velocity).toEqual(afterB.velocity);
    expect(pipeline.lastReconciledSequence).toBe(6);
    const expectedB = oracleReplay({ x: 10, y: 0, z: -12 }, [forward(7), forward(8)]);
    assertPositionClose(final.position, expectedB, "out-of-order final");
  });

  it("a later higher-ack snapshot still advances after an out-of-order one is ignored", () => {
    const pipeline = new ReconciliationPipeline(stateAt(0, 0, 0), {
      moveSpeed: MOVE_SPEED,
      tickSeconds: TICK,
    });
    for (let seq = 1; seq <= 10; seq += 1) {
      pipeline.recordInput(forward(seq));
    }
    pipeline.reconcile({ position: { x: 1, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, lastProcessedSequence: 8 });
    pipeline.reconcile({ position: { x: 2, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, lastProcessedSequence: 3 });
    const advancing = pipeline.reconcile({ position: { x: 5, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, lastProcessedSequence: 10 });
    expect(advancing.reconciled).toBe(true);
    expect(advancing.replayedSequences).toEqual([]);
    expect(pipeline.lastReconciledSequence).toBe(10);
  });
});

describe("ReconciliationPipeline — INPUT BUFFER", () => {
  it("prunes acknowledged inputs (sequence <= ack) after a reconciliation", () => {
    const pipeline = new ReconciliationPipeline(stateAt(0, 0, 0), {
      moveSpeed: MOVE_SPEED,
      tickSeconds: TICK,
    });
    for (let seq = 1; seq <= 5; seq += 1) {
      pipeline.recordInput(forward(seq));
    }
    const outcome = pipeline.reconcile({ position: { x: 2, y: 0, z: 2 }, velocity: { x: 0, y: 0, z: 0 }, lastProcessedSequence: 3 });
    // Inputs 1,2,3 confirmed + pruned; 4,5 remain.
    expect(outcome.replayedSequences).toEqual([4, 5]);
    expect(pipeline.bufferedInputCount).toBe(2);
  });

  it("drops the oldest buffered input when the buffer overflows the cap", () => {
    const pipeline = new ReconciliationPipeline(stateAt(0, 0, 0), {
      moveSpeed: MOVE_SPEED,
      tickSeconds: TICK,
      maxBufferedInputs: 3,
    });
    for (let seq = 1; seq <= 5; seq += 1) {
      pipeline.recordInput(forward(seq));
    }
    // Cap 3: only the three newest (3,4,5) survive; 1,2 evicted on overflow.
    expect(pipeline.bufferedInputCount).toBe(3);
    const outcome = pipeline.reconcile({ position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, lastProcessedSequence: 2 });
    expect(outcome.replayedSequences).toEqual([3, 4, 5]);
  });

  it("defaults to a 120-input buffer and a 1/30s tick", () => {
    expect(RECONCILIATION_MAX_BUFFERED_INPUTS).toBe(120);
    expect(RECONCILIATION_TICK_SECONDS).toBeCloseTo(1 / 30, 12);
    const pipeline = new ReconciliationPipeline(stateAt(0, 0, 0));
    expect(pipeline.bufferedInputCount).toBe(0);
    expect(pipeline.lastReconciledSequence).toBe(-1);
  });

  it("resets to the supplied state, clearing the buffer and the recorded ack", () => {
    const pipeline = new ReconciliationPipeline(stateAt(1, 0, 1), {
      moveSpeed: MOVE_SPEED,
      tickSeconds: TICK,
    });
    pipeline.recordInput(forward(1));
    pipeline.reconcile({ position: { x: 7, y: 0, z: 7 }, velocity: { x: 0, y: 0, z: 0 }, lastProcessedSequence: 1 });
    expect(pipeline.lastReconciledSequence).toBe(1);
    pipeline.reset(stateAt(0, 0, 0));
    expect(pipeline.getState().position).toEqual({ x: 0, y: 0, z: 0 });
    expect(pipeline.getState().velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(pipeline.bufferedInputCount).toBe(0);
    expect(pipeline.lastReconciledSequence).toBe(-1);
  });
});
