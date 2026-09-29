import type {
  PredictionInputBatcher,
  PredictionInputSample,
} from "./predictionInputBatcher";

/**
 * The narrow simulation boundary the prediction loop drives per substep.
 * `PlayerController` satisfies this structurally. It receives EXPLICIT
 * prediction input — it never reads browser input itself — so the same
 * `step()` can later replay historical samples (Stage 2C2B).
 */
export interface PredictionSimulation {
  step(deltaSeconds: number, input: PredictionSubstepInput): void;
}

/**
 * The per-substep view of one prediction sample handed to local simulation.
 *
 * `jumpPressed` is the RAW jump edge, forwarded to the simulation ONLY on the
 * first substep of a batch (the shared `JumpController` buffers/coyote-times
 * it). On the second substep it is always `false` — the edge must never be
 * replayed, matching the authoritative server's `advancePlayerSubstep`.
 */
export interface PredictionSubstepInput {
  moveX: number;
  moveZ: number;
  lookYaw: number;
  /** True only on the first substep of a batch; always false on the second. */
  jumpPressed: boolean;
}

/**
 * Drives one local 1/60 prediction substep from the shared
 * {@link PredictionInputBatcher} and returns the single action the runtime
 * must perform: send the active sample to the network exactly once per
 * prediction batch (`sendSample = true` on the first substep), or do nothing
 * on the second substep.
 *
 * Keeping this mapping in a pure, side-effect-free function is what makes the
 * 30 Hz ↔ 2×1/60 cadence unit-testable without a browser, engine, or network:
 * the batcher owns cadence/sample identity, this function owns "one sample →
 * one send + two simulation substeps", and the simulation owns the physics.
 */
export function runPredictionSubstep(args: {
  deltaSeconds: number;
  batcher: PredictionInputBatcher;
  simulation: PredictionSimulation;
}): { sendSample: boolean; sample: PredictionInputSample } {
  const { sample, firstSubstep } = args.batcher.nextSubstep();
  args.simulation.step(args.deltaSeconds, {
    moveX: sample.moveX,
    moveZ: sample.moveZ,
    lookYaw: sample.lookYaw,
    // Jump edge semantics: applied once per batch, on the first substep only.
    jumpPressed: firstSubstep ? sample.jump : false,
  });
  return { sendSample: firstSubstep, sample };
}
