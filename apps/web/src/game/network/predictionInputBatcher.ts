/**
 * One prediction input sample: the exact intent the client simulates for the
 * next two 1/60 local physics substeps AND sends (once) to the authoritative
 * server as one sequenced `PlayerInputFrame` at 30 Hz.
 *
 * The shape matches `PlayerInputFrame` minus its `sequence` (sequence
 * ownership stays in `FoundationNetwork.sendSequencedPlayerInput`).
 */
export interface PredictionInputSample {
  moveX: number;
  moveZ: number;
  lookYaw: number;
  lookPitch: number;
  jump: boolean;
}

/**
 * Captures one fresh sample from the live browser input (held movement keys,
 * camera yaw/pitch, and one polled jump edge). Invoked by the batcher exactly
 * once per prediction batch — never mid-batch.
 */
export type PredictionInputCapture = () => PredictionInputSample;

/** The result of advancing the batcher by one local 1/60 substep. */
export interface PredictionSubstepResult {
  /** The active prediction sample for the current batch. */
  sample: PredictionInputSample;
  /** `true` on the first substep of a batch, `false` on the second. */
  firstSubstep: boolean;
}

/**
 * A pure, testable two-substep prediction batcher.
 *
 * One prediction batch is one 30 Hz input sample expanded into two local 1/60
 * physics substeps — the exact inverse of the Stage 2C1 authoritative server,
 * which consumes at most one `PlayerInputFrame` per tick and applies it to two
 * physics substeps (the jump edge on the first substep only). Keeping the
 * client on the same "one sample → two substeps" cadence is what makes local
 * prediction replayable and sequence-aligned (Stage 2C2A):
 *
 *   CLIENT                                        SERVER
 *   sample N (captured + sent ONCE at 30 Hz)      PlayerInputFrame N
 *   ├── local substep A @ 1/60                    ├── authoritative substep A
 *   └── local substep B @ 1/60                    └── authoritative substep B
 *
 * The batcher owns only the *cadence and identity* of the active sample:
 *
 * - the first call of a batch invokes {@link PredictionInputCapture} once and
 *   returns the fresh sample with `firstSubstep = true`;
 * - the second call does NOT capture again and returns the SAME stored
 *   sample with `firstSubstep = false`;
 * - the third call begins a new batch and captures fresh input again.
 *
 * The batcher has no engine, input, or network dependency: the runtime hands
 * it a capture callback and consumes the results (local simulation + the one
 * network send per batch).
 */
export class PredictionInputBatcher {
  private batchOpen = false;
  private activeSample: PredictionInputSample | null = null;

  public constructor(private readonly capture: PredictionInputCapture) {}

  /**
   * Advances the batcher by one local 1/60 substep and returns the sample that
   * must drive that substep (plus whether it is the batch's first substep).
   */
  public nextSubstep(): PredictionSubstepResult {
    if (!this.batchOpen) {
      // Fresh batch: capture live input exactly once for the whole pair.
      this.activeSample = this.capture();
      this.batchOpen = true;
      return { sample: this.activeSample, firstSubstep: true };
    }
    // Second substep of the batch: reuse the stored sample, no re-capture —
    // a jump key-down that happened in between stays latched in the
    // InputManager for the NEXT batch, matching the server's edge semantics.
    this.batchOpen = false;
    return { sample: this.activeSample!, firstSubstep: false };
  }

  /**
   * Discards any open/partial batch so the next substep captures a fresh
   * sample. The runtime calls this on input clear (pointer unlock, window
   * blur, tab hidden, disposal) so no stale movement or jump sample survives
   * the reset.
   */
  public reset(): void {
    this.batchOpen = false;
    this.activeSample = null;
  }
}
