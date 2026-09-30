import {
  InputBatcher,
  type InputSample,
  type SubstepInput,
} from "./inputBatcher";

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
      // The returned sequence is ignored here; Stage 2C2B will store the
      // sample keyed by it for reconciliation.
      this.deps.sendSample(sample);
    }
    this.deps.simulateSubstep(this.batcher.currentSubstepInput());
    this.batcher.finishSubstep();
  }

  /**
   * Discard any active batch so the next substep starts a fresh capture. Used
   * by the spiral-of-death guard (a long hitch may leave a half-finished
   * batch) and by the input-clear path.
   */
  public resetBatch(): void {
    this.batcher.reset();
  }

  /**
   * Input-clear path: drop any active batch and immediately send one neutral
   * authoritative intent so the server stops applying the last held movement.
   * After this, the next physics substep starts a FRESH prediction batch.
   */
  public clearAndSendNeutral(neutral: InputSample): void {
    this.batcher.reset();
    this.deps.sendSample(neutral);
  }
}
