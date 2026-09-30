import { describe, expect, it } from "vitest";
import {
  PREDICTION_HISTORY_CAP,
  PredictionHistory,
} from "./predictionHistory";
import type { PredictionState } from "./predictionState";

function stateAt(x: number): PredictionState {
  return {
    position: { x, y: 0, z: 0 },
    verticalVelocity: 0,
    lastGrounded: true,
    jump: { jumpBufferRemaining: 0, coyoteRemaining: 0 },
    facingYaw: 0,
  };
}

const sample = (jump = false) => ({
  moveX: 1,
  moveZ: 0,
  lookYaw: 0,
  lookPitch: 0,
  jump,
});

describe("PredictionHistory — append / lookup", () => {
  it("stores sequence + sample + state and retrieves by exact sequence", () => {
    const h = new PredictionHistory();
    h.append(7, sample(), stateAt(7));

    expect(h.size).toBe(1);
    expect(h.lastSequence).toBe(7);
    const entry = h.get(7);
    expect(entry).not.toBeNull();
    expect(entry?.sequence).toBe(7);
    expect(entry?.sample).toEqual(sample());
    expect(entry?.state.position.x).toBe(7);
  });

  it("deep-copies the appended state so later mutation cannot corrupt the checkpoint", () => {
    const h = new PredictionHistory();
    const state = stateAt(3);
    h.append(3, sample(), state);

    // Mutate the source state after appending.
    state.position.x = 123;
    state.jump.coyoteRemaining = 0.9;

    expect(h.get(3)!.state.position.x).toBe(3);
    expect(h.get(3)!.state.jump.coyoteRemaining).toBe(0);
  });

  it("is a no-op when appending a duplicate sequence", () => {
    const h = new PredictionHistory();
    h.append(5, sample(), stateAt(5));
    h.append(5, sample(true), stateAt(99));

    expect(h.size).toBe(1);
    // The first entry wins; the duplicate is ignored.
    expect(h.get(5)!.state.position.x).toBe(5);
    expect(h.get(5)!.sample.jump).toBe(false);
  });

  it("returns null for a missing sequence (including gaps)", () => {
    const h = new PredictionHistory();
    h.append(1, sample(), stateAt(1));
    h.append(3, sample(), stateAt(3)); // gap at 2

    expect(h.get(2)).toBeNull();
    expect(h.get(0)).toBeNull();
    expect(h.get(4)).toBeNull();
  });
});

describe("PredictionHistory — ordered replay", () => {
  it("returns entries after an ack in ascending sequence order", () => {
    const h = new PredictionHistory();
    h.append(1, sample(), stateAt(1));
    h.append(2, sample(), stateAt(2));
    h.append(3, sample(), stateAt(3));
    h.append(4, sample(), stateAt(4));

    const after = h.after(2);
    expect(after.map((e) => e.sequence)).toEqual([3, 4]);
    expect(after[0].state.position.x).toBe(3);
    expect(after[1].state.position.x).toBe(4);
  });

  it("excludes entries at or below the ack", () => {
    const h = new PredictionHistory();
    h.append(4, sample(), stateAt(4));
    h.append(5, sample(), stateAt(5));

    expect(h.after(4).map((e) => e.sequence)).toEqual([5]);
    expect(h.after(5)).toEqual([]);
    expect(h.after(3).map((e) => e.sequence)).toEqual([4, 5]);
  });
});

describe("PredictionHistory — prune", () => {
  it("prunes entries with sequence <= ack and keeps the rest", () => {
    const h = new PredictionHistory();
    for (const seq of [1, 2, 3, 4, 5]) {
      h.append(seq, sample(), stateAt(seq));
    }

    const removed = h.pruneUpTo(3);

    expect(removed).toBe(3);
    expect(h.size).toBe(2);
    expect(h.get(3)).toBeNull();
    expect(h.get(4)!.state.position.x).toBe(4);
    expect(h.get(5)!.state.position.x).toBe(5);
  });

  it("returns 0 when there is nothing to prune", () => {
    const h = new PredictionHistory();
    h.append(3, sample(), stateAt(3));
    expect(h.pruneUpTo(2)).toBe(0);
    expect(h.size).toBe(1);
  });

  it("empties the history when the ack is at or above every entry", () => {
    const h = new PredictionHistory();
    h.append(1, sample(), stateAt(1));
    h.append(2, sample(), stateAt(2));

    expect(h.pruneUpTo(99)).toBe(2);
    expect(h.size).toBe(0);
    expect(h.lastSequence).toBeNull();
  });
});

describe("PredictionHistory — sequence gaps", () => {
  it("tolerates gaps: prune keeps entries above the gapped ack", () => {
    const h = new PredictionHistory();
    h.append(1, sample(), stateAt(1));
    h.append(3, sample(), stateAt(3)); // no entry at 2 (input-clear gap)

    // Ack 2 prunes entry 1 but leaves the gap and entry 3 intact.
    expect(h.pruneUpTo(2)).toBe(1);
    expect(h.get(2)).toBeNull();
    expect(h.get(3)!.state.position.x).toBe(3);
    expect(h.after(2).map((e) => e.sequence)).toEqual([3]);
  });
});

describe("PredictionHistory — bounded cap", () => {
  it("evicts the oldest entry once the cap is exceeded", () => {
    const h = new PredictionHistory();
    const total = PREDICTION_HISTORY_CAP + 10;

    for (let seq = 1; seq <= total; seq += 1) {
      h.append(seq, sample(), stateAt(seq));
    }

    expect(h.size).toBe(PREDICTION_HISTORY_CAP);
    // The oldest 10 (1..10) were evicted; 11 is the first retained.
    expect(h.get(10)).toBeNull();
    expect(h.get(11)!.state.position.x).toBe(11);
    // The newest is retained.
    expect(h.get(total)!.state.position.x).toBe(total);
    expect(h.lastSequence).toBe(total);
  });

  it("keeps exactly the cap entries with no eviction under the cap", () => {
    const h = new PredictionHistory();
    for (let seq = 1; seq <= PREDICTION_HISTORY_CAP; seq += 1) {
      h.append(seq, sample(), stateAt(seq));
    }
    expect(h.size).toBe(PREDICTION_HISTORY_CAP);
    expect(h.get(1)!.state.position.x).toBe(1);
  });
});

describe("PredictionHistory — safe behaviour for an evicted checkpoint", () => {
  it("get() for an evicted (or never-present) sequence returns null, not a crash", () => {
    const h = new PredictionHistory();
    // Fill beyond the cap so the oldest entries are evicted.
    for (let seq = 1; seq <= PREDICTION_HISTORY_CAP + 1; seq += 1) {
      h.append(seq, sample(), stateAt(seq));
    }
    // Sequence 1 has been evicted.
    expect(h.get(1)).toBeNull();
    // after()/pruneUpTo still work on the retained window.
    expect(h.after(PREDICTION_HISTORY_CAP).map((e) => e.sequence)).toEqual([
      PREDICTION_HISTORY_CAP + 1,
    ]);
    expect(h.pruneUpTo(PREDICTION_HISTORY_CAP)).toBe(PREDICTION_HISTORY_CAP - 1);
  });
});

describe("PredictionHistory — replaceState / clear", () => {
  it("replaceState swaps the checkpoint for a sequence (deep-copied)", () => {
    const h = new PredictionHistory();
    h.append(4, sample(), stateAt(4));

    expect(h.replaceState(4, stateAt(40))).toBe(true);
    expect(h.get(4)!.state.position.x).toBe(40);

    // Mutating the replacement source must not corrupt the stored entry.
    const src = stateAt(50);
    h.replaceState(4, src);
    src.position.x = 999;
    expect(h.get(4)!.state.position.x).toBe(50);
  });

  it("replaceState returns false for an absent sequence", () => {
    const h = new PredictionHistory();
    expect(h.replaceState(99, stateAt(99))).toBe(false);
    expect(h.size).toBe(0);
  });

  it("clear() drops every entry", () => {
    const h = new PredictionHistory();
    h.append(1, sample(), stateAt(1));
    h.append(2, sample(), stateAt(2));
    h.clear();
    expect(h.size).toBe(0);
    expect(h.lastSequence).toBeNull();
  });
});
