import type { PlayerInputFrame } from "@buildshift/protocol";

/**
 * One authoritative input sample — the exact client meaning of one server
 * `PlayerInputFrame` (docs/TECHNICAL_ARCHITECTURE.md §11):
 *
 *     sample N
 *     ├── physics substep A (1/60, uses this sample)
 *     └── physics substep B (1/60, uses the SAME sample; jump edge = false)
 *
 * The runtime captures ONE sample at the start of every batch of two 1/60
 * physics substeps and feeds that *same* sample to both local prediction and
 * the single network send. Stage 2C2B will later store these samples keyed
 * by the sequence assigned at send time.
 */
export type InputSample = Omit<PlayerInputFrame, "sequence">;

/**
 * The explicit per-substep input handed to the local simulation. `jumpPressed`
 * is the *edge* for this substep only: `true` on the first substep of a batch
 * whose captured sample has `jump: true`, always `false` on the second
 * substep — so a Space press that arrives between the two substeps is never
 * consumed on substep B (the browser latch stays intact for the next batch).
 */
export interface SubstepInput {
  moveX: number;
  moveZ: number;
  lookYaw: number;
  jumpPressed: boolean;
}

/**
 * Pure two-substep batch tracker for prediction input samples.
 *
 * The runtime drives it once per 1/60 physics substep:
 *
 * 1. if `hasActiveBatch()` is false, capture a fresh sample (movement axes,
 *    yaw, pitch, and the raw jump edge — each polled ONCE), call
 *    `beginBatch(sample)`, and send the sample to the network exactly once;
 * 2. read `currentSubstepInput()` and feed it to the local simulation;
 * 3. call `finishSubstep()`.
 *
 * State machine: idle → first substep → second substep → idle → …
 *
 * The object holds no browser state and never reads input itself, so it is
 * deterministic and unit-testable. `reset()` discards any active batch so the
 * next substep starts a fresh capture (Stage 2C1 input-clear contract: no
 * stale sample may survive).
 */
export class InputBatcher {
  /** The sample captured at the start of the active batch, if any. */
  private active: InputSample | null = null;
  /** Which substep of the active batch is currently running. */
  private substep: "first" | "second" = "first";

  /** True while a batch has started but not yet completed both substeps. */
  public hasActiveBatch(): boolean {
    return this.active !== null;
  }

  /**
   * Starts a fresh batch with the sample the runtime just captured. Must be
   * called from the idle state (no active batch).
   */
  public beginBatch(sample: InputSample): void {
    if (this.active !== null) {
      throw new Error(
        "InputBatcher.beginBatch() called while a batch is still active.",
      );
    }
    this.active = { ...sample };
    this.substep = "first";
  }

  /**
   * The explicit input for the substep currently running. The movement axes
   * and yaw are reused from the captured sample on BOTH substeps; only the
   * jump edge differs (first substep only).
   */
  public currentSubstepInput(): SubstepInput {
    const sample = this.requireActiveBatch();
    return {
      moveX: sample.moveX,
      moveZ: sample.moveZ,
      lookYaw: sample.lookYaw,
      jumpPressed: sample.jump && this.substep === "first",
    };
  }

  /** The raw captured sample (as sent to the network) for the active batch. */
  public currentSample(): InputSample {
    return this.requireActiveBatch();
  }

  /**
   * Marks the current substep as finished and advances the batch:
   * first → second, second → idle (fresh capture on the next substep).
   */
  public finishSubstep(): void {
    this.requireActiveBatch();
    if (this.substep === "first") {
      this.substep = "second";
      return;
    }
    this.active = null;
    this.substep = "first";
  }

  /**
   * Discards any active batch. The next substep starts a fresh first substep,
   * so no stale sample can survive an input-clear event (unlock / blur /
   * hidden tab / disposal).
   */
  public reset(): void {
    this.active = null;
    this.substep = "first";
  }

  private requireActiveBatch(): InputSample {
    if (this.active === null) {
      throw new Error(
        "InputBatcher: no active batch; call beginBatch() before reading a substep.",
      );
    }
    return this.active;
  }
}
