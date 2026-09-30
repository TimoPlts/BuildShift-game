import type { InputSample } from "./inputBatcher";
import {
  clonePredictionState,
  type PredictionState,
} from "./predictionState";

/**
 * A single completed, successfully-sent prediction entry, keyed by the network
 * input sequence that was assigned when the sample was sent.
 *
 * - `sample` is the EXACT input sample that was sent to the server (the
 *   authoritative intent the server will apply over its two 1/60 substeps).
 * - `state` is the deterministic local predicted state AFTER both substeps for
 *   that sample. A later acknowledgement for `sequence` compares the server's
 *   authoritative position against `state.position`.
 */
export interface PredictionEntry {
  sequence: number;
  sample: InputSample;
  state: PredictionState;
}

/**
 * Documented client-only upper bound on retained history entries.
 *
 * Reconciliation discards entries as they are acknowledged, so under a healthy
 * server the live history is small (bounded by round-trip latency). The cap is
 * a guard against a broken / stalled server that never acknowledges inputs:
 * it bounds client memory growth even if `acknowledgedSequence` never advances.
 *
 * At 30 Hz, 256 entries ≈ ~8.5 s of inputs, which is far larger than any sane
 * RTT while still bounding memory to a few hundred small objects. When the cap
 * is reached the OLDEST (lowest-sequence) entry is evicted — exactly the entry
 * that reconciliation is least likely to need (old checkpoints are pruned
 * first anyway).
 */
export const PREDICTION_HISTORY_CAP = 256;

/**
 * Ordered, bounded history of completed prediction batches, keyed by input
 * sequence. Pure: no browser, physics, or network dependencies, so it is fully
 * node-testable.
 *
 * Ordering invariant: entries are always sorted by ascending `sequence`. Only
 * *successfully sent* frames have a sequence and therefore an entry —
 * disconnected local prediction never invents a sequence and therefore never
 * appends an entry.
 *
 * Sequence gaps are legitimate and tolerated: an input-clear sends a neutral
 * sequenced frame outside a normal two-substep batch, so the server may
 * acknowledge a sequence that has no stored entry. Reconciliation treats that
 * as "confirmed, nothing to roll back against" (see `reconciliation.ts`); this
 * structure simply stores whatever completed batches it is given.
 */
export class PredictionHistory {
  private readonly entries: PredictionEntry[] = [];

  /** Number of retained entries. */
  public get size(): number {
    return this.entries.length;
  }

  /** The highest retained sequence, or `null` when empty. */
  public get lastSequence(): number | null {
    const last = this.entries[this.entries.length - 1];
    return last ? last.sequence : null;
  }

  /**
   * Appends a completed prediction for a successfully-sent sequence.
   *
   * The state is deep-copied so later simulation cannot mutate the stored
   * checkpoint. Appending an already-present sequence is a no-op (a defensive
   * guard against a duplicate record); appending is expected to be in
   * ascending sequence order.
   */
  public append(sequence: number, sample: InputSample, state: PredictionState): void {
    if (this.entries.some((entry) => entry.sequence === sequence)) {
      return;
    }
    this.entries.push({
      sequence,
      sample: { ...sample },
      state: clonePredictionState(state),
    });
    // Keep ascending order (defensive: callers append in order).
    this.entries.sort((a, b) => a.sequence - b.sequence);
    if (this.entries.length > PREDICTION_HISTORY_CAP) {
      // Evict the oldest entry beyond the cap.
      this.entries.splice(0, this.entries.length - PREDICTION_HISTORY_CAP);
    }
  }

  /**
   * The entry for an exact sequence, or `null` when there is no entry for that
   * sequence (either it was never sent, was evicted by the cap, or is a
   * sequence gap from an input-clear).
   */
  public get(sequence: number): PredictionEntry | null {
    for (const entry of this.entries) {
      if (entry.sequence === sequence) {
        return entry;
      }
      if (entry.sequence > sequence) {
        break;
      }
    }
    return null;
  }

  /**
   * All retained entries with sequence STRICTLY greater than `acknowledgedSequence`,
   * in ascending sequence order — the inputs to replay after a correction.
   */
  public after(acknowledgedSequence: number): PredictionEntry[] {
    const result: PredictionEntry[] = [];
    for (const entry of this.entries) {
      if (entry.sequence > acknowledgedSequence) {
        result.push(entry);
      }
    }
    return result;
  }

  /**
   * Removes all entries with sequence <= `acknowledgedSequence`, returning the
   * number removed. This is the "discard confirmed history" step of
   * reconciliation.
   */
  public pruneUpTo(acknowledgedSequence: number): number {
    const first = this.entries.findIndex((entry) => entry.sequence > acknowledgedSequence);
    if (first === 0) {
      return 0;
    }
    const kept = first === -1 ? [] : this.entries.slice(first);
    const removed = this.entries.length - kept.length;
    this.entries.length = 0;
    for (const entry of kept) {
      this.entries.push(entry);
    }
    return removed;
  }

  /**
   * Replaces the stored checkpoint for an exact sequence with a new state
   * (deep-copied). Used after a replay so future acknowledgements compare
   * against the replayed prediction, not the stale pre-correction checkpoint.
   * Returns `true` when an entry was replaced, `false` when the sequence is not
   * present.
   */
  public replaceState(sequence: number, state: PredictionState): boolean {
    for (const entry of this.entries) {
      if (entry.sequence === sequence) {
        entry.state = clonePredictionState(state);
        return true;
      }
    }
    return false;
  }

  /** Drops all entries. */
  public clear(): void {
    this.entries.length = 0;
  }
}
