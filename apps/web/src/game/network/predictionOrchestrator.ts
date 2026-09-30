import {
  InputBatcher,
  type InputSample,
  type SubstepInput,
} from "./inputBatcher";
import { PredictionHistory } from "./predictionHistory";
import type { PredictionState } from "./predictionState";

/**
 * The browser-facing seam the {@link PredictionOrchestrator} drives. In the
 * real runtime these are wired to `InputManager` / `ThirdPersonCameraController`
 * (capture), `FoundationNetwork` (send), and `PlayerController` (simulate). In
 * tests they are fakes, which is what makes the whole prediction batch
 * behaviour unit-testable without a browser, WebGL, or Rapier.
 */
export interface PredictionOrchestratorDeps {
  /**
   * Capture ONE fresh input sample from the browser: movement axes, look yaw,
   * look pitch, and the raw jump edge. Called exactly once per prediction
   * batch (at the first 1/60 substep), never mid-batch.
   */
  captureInput(): InputSample;
  /**
   * Send one sample to the server. Returns the assigned input sequence, or
   * `null` when the connection is unavailable. Must never throw; a failed or
   * disconnected send must not block local prediction.
   */
  sendSample(sample: InputSample): number | null;
  /** Simulate one 1/60 substep from explicit input (drives the local player). */
  simulateSubstep(input: SubstepInput): void;
  /**
   * The prediction history a completed batch's checkpoint is recorded into.
   * Injected (not instantiated) so the orchestrator stays browser-independent
   * and unit-testable. Optional so the existing `GameRuntime` construction
   * (which supplies only the three original seams) still compiles unchanged;
   * Stage 2C2B-4 wires the real instance there. When absent, completed batches
   * are simply not recorded.
   */
  history?: PredictionHistory;
  /**
   * Capture the local player's prediction state as a value copy. Called exactly
   * once per COMPLETED two-substep batch (after substep B), and only when the
   * batch's send returned a sequence. In the runtime this is
   * `PlayerController.capturePredictionState()`. Optional (see `history`).
   */
  capturePredictionState?(): PredictionState;
}

/**
 * Drives the local prediction loop in two-substep batches so that ONE captured
 * input sample has exactly the same simulation meaning as one server
 * `PlayerInputFrame` (docs/TECHNICAL_ARCHITECTURE.md §11):
 *
 *     sample N
 *     ├── substep A (1/60, simulates with the sample, jump edge as captured)
 *     └── substep B (1/60, simulates with the SAME sample, jump edge forced false)
 *
 * Responsibilities, in order, per substep:
 *  1. if no batch is active, capture ONE sample and send it to the network
 *     exactly once (the single send opportunity for the batch);
 *  2. simulate the substep with the batch's explicit input — the second
 *     substep reuses the stored movement/yaw and gets `jumpPressed: false` so
 *     a Space press arriving mid-batch is left latched for the next batch;
 *  3. advance the batch (idle → first → second → idle).
 *
 * The class owns no browser state; all input I/O is injected, so it is pure
 * and deterministic. `resetBatch()` / `clearAndSendNeutral()` implement the
 * Stage 2C1 input-clear contract (no stale sample survives; one neutral
 * authoritative intent is sent while connected).
 */
export class PredictionOrchestrator {
  private readonly batcher = new InputBatcher();
  /**
   * The network sequence assigned to the currently-active batch (its single
   * send), retained until BOTH substeps complete. `null` when the connection
   * is down (the send returned null) or when no batch is active.
   */
  private activeSequence: number | null = null;

  public constructor(private readonly deps: PredictionOrchestratorDeps) {}

  /** True while a prediction batch has started but not finished both substeps. */
  public hasActiveBatch(): boolean {
    return this.batcher.hasActiveBatch();
  }

  /**
   * Advance the local prediction by one 1/60 substep. The caller (the
   * fixed-step runtime) invokes this once per physics substep.
   */
  public stepSubstep(): void {
    if (!this.batcher.hasActiveBatch()) {
      const sample = this.deps.captureInput();
      this.batcher.beginBatch(sample);
      // Exactly one send per 30 Hz prediction batch — never one per substep.
      // The returned sequence (or null when disconnected) is RETAINED for this
      // active batch and recorded only once BOTH substeps have completed.
      this.activeSequence = this.deps.sendSample(sample);
    }
    this.deps.simulateSubstep(this.batcher.currentSubstepInput());
    // The batch's sample + retained sequence are still readable while the batch
    // is active; capture both before finishSubstep() may close it.
    const batchSample = this.batcher.currentSample();
    const batchSequence = this.activeSequence;
    this.batcher.finishSubstep();
    // A history checkpoint exists ONLY after substep B (the batch is now idle)
    // AND the send returned a real sequence. After substep A the batch is still
    // active, so nothing is recorded yet (the sequence is retained for substep
    // B). A null send (disconnected) never records.
    if (!this.batcher.hasActiveBatch()) {
      // Record ONLY when a real sequence was assigned AND the history / capture
      // seams are wired (Stage 2C2B-4 provides them from the real PlayerController).
      const history = this.deps.history;
      const capture = this.deps.capturePredictionState;
      if (batchSequence !== null && history && capture) {
        history.append(batchSequence, batchSample, capture());
      }
      this.activeSequence = null;
    }
  }

  /**
   * Discard any active batch so the next substep starts a fresh capture. Used
   * by the spiral-of-death guard (a long hitch may leave a half-finished
   * batch) and by the input-clear path.
   */
  public resetBatch(): void {
    // Discard any half-finished batch, INCLUDING its retained sequence
    // bookkeeping, so the next substep starts a fresh capture/send. No history
    // entry is created for a batch that never completed substep B.
    this.batcher.reset();
    this.activeSequence = null;
  }

  /**
   * Input-clear path: drop any active batch and immediately send one neutral
   * authoritative intent so the server stops applying the last held movement.
   * After this, the next physics substep starts a FRESH prediction batch.
   */
  public clearAndSendNeutral(neutral: InputSample): void {
    // Discard any active partial batch and its retained sequence bookkeeping,
    // then send the neutral authoritative intent exactly once. The neutral
    // frame's own sequence is deliberately NOT recorded in the history — that
    // intentional missing sequence is the gap the ReconciliationEngine already
    // handles (docs/TECHNICAL_ARCHITECTURE.md §11 / Stage 2C2B).
    this.batcher.reset();
    this.activeSequence = null;
    this.deps.sendSample(neutral);
  }
}
