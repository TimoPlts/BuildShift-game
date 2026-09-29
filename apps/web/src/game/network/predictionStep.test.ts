import { describe, expect, it } from "vitest";
import {
  PredictionInputBatcher,
  type PredictionInputSample,
} from "./predictionInputBatcher";
import {
  runPredictionSubstep,
  type PredictionSimulation,
  type PredictionSubstepInput,
} from "./predictionStep";

function sample(overrides: Partial<PredictionInputSample> = {}): PredictionInputSample {
  return {
    moveX: 0,
    moveZ: 0,
    lookYaw: 0,
    lookPitch: 0,
    jump: false,
    ...overrides,
  };
}

/** Records every substep input it is handed, in order. */
function createRecordingSimulation() {
  const inputs: PredictionSubstepInput[] = [];
  const simulation: PredictionSimulation = {
    step: (_dt, input) => {
      inputs.push(input);
    },
  };
  return { simulation, inputs };
}

describe("runPredictionSubstep", () => {
  it("issues exactly one network send opportunity per prediction batch", () => {
    const batcher = new PredictionInputBatcher(() => sample());
    const { simulation } = createRecordingSimulation();

    const first = runPredictionSubstep({
      deltaSeconds: 1 / 60,
      batcher,
      simulation,
    });
    const second = runPredictionSubstep({
      deltaSeconds: 1 / 60,
      batcher,
      simulation,
    });

    // Send only on the first substep of the batch; never on the second.
    expect(first.sendSample).toBe(true);
    expect(second.sendSample).toBe(false);
  });

  it("sends the active sample once per batch, not once per physics substep", () => {
    const live = { movement: { x: 1, z: 0 }, yaw: 0, pitch: 0, jump: false };
    const capture = () => ({
      moveX: live.movement.x,
      moveZ: live.movement.z,
      lookYaw: live.yaw,
      lookPitch: live.pitch,
      jump: live.jump,
    });
    const batcher = new PredictionInputBatcher(capture);
    const { simulation, inputs } = createRecordingSimulation();

    const a = runPredictionSubstep({ deltaSeconds: 1 / 60, batcher, simulation });
    const b = runPredictionSubstep({ deltaSeconds: 1 / 60, batcher, simulation });

    // The SAME sample drives both substeps and is the one sent to the network.
    expect(a.sendSample).toBe(true);
    expect(a.sample).toEqual(sample({ moveX: 1, moveZ: 0 }));
    expect(b.sample).toBe(a.sample);
    // Both substeps are handed identical movement + yaw.
    expect(inputs).toHaveLength(2);
    expect(inputs[0].moveX).toBe(1);
    expect(inputs[0].moveZ).toBe(0);
    expect(inputs[1].moveX).toBe(1);
    expect(inputs[1].moveZ).toBe(0);
    expect(inputs[0].lookYaw).toBe(0);
    expect(inputs[1].lookYaw).toBe(0);
  });

  it("forwards the jump edge to the simulation ONLY on the first substep", () => {
    const batcher = new PredictionInputBatcher(() =>
      sample({ jump: true }),
    );
    const { simulation, inputs } = createRecordingSimulation();

    runPredictionSubstep({ deltaSeconds: 1 / 60, batcher, simulation });
    runPredictionSubstep({ deltaSeconds: 1 / 60, batcher, simulation });

    // Substep 1 gets the raw edge; substep 2 must NOT replay it.
    expect(inputs[0].jumpPressed).toBe(true);
    expect(inputs[1].jumpPressed).toBe(false);
  });

  it("does not replay a jump on substep 2 even when the sample jumped", () => {
    const batcher = new PredictionInputBatcher(() => sample({ jump: true }));
    const { simulation, inputs } = createRecordingSimulation();

    runPredictionSubstep({ deltaSeconds: 1 / 60, batcher, simulation });
    runPredictionSubstep({ deltaSeconds: 1 / 60, batcher, simulation });
    runPredictionSubstep({ deltaSeconds: 1 / 60, batcher, simulation });

    // Fresh batch again jumps: substep pattern repeats [true, false, true].
    expect(inputs[0].jumpPressed).toBe(true);
    expect(inputs[1].jumpPressed).toBe(false);
    expect(inputs[2].jumpPressed).toBe(true);
  });

  it("passes a no-jump sample through as false on both substeps", () => {
    const batcher = new PredictionInputBatcher(() => sample({ jump: false }));
    const { simulation, inputs } = createRecordingSimulation();

    runPredictionSubstep({ deltaSeconds: 1 / 60, batcher, simulation });
    runPredictionSubstep({ deltaSeconds: 1 / 60, batcher, simulation });

    expect(inputs[0].jumpPressed).toBe(false);
    expect(inputs[1].jumpPressed).toBe(false);
  });

  it("lets a reset force the next substep to capture fresh input (no stale reuse)", () => {
    // Each capture returns a NEW sample; the second one deliberately has
    // jump:false so a stale (jump:true) sample's survival would be detectable.
    const captured: PredictionInputSample[] = [];
    const jumpSequence = [true, false];
    const batcher = new PredictionInputBatcher(() => {
      const s = sample({ moveX: 1, moveZ: 1, jump: jumpSequence[captured.length] });
      captured.push(s);
      return s;
    });
    const { simulation, inputs } = createRecordingSimulation();

    const first = runPredictionSubstep({ deltaSeconds: 1 / 60, batcher, simulation });
    // Mid-batch: discard the open batch (as input-clear does).
    batcher.reset();
    const after = runPredictionSubstep({ deltaSeconds: 1 / 60, batcher, simulation });

    // A NEW sample was captured, not the old mid-batch one.
    expect(captured).toHaveLength(2);
    expect(first.sample).toBe(captured[0]);
    expect(after.sample).toBe(captured[1]);
    expect(after.sample).not.toBe(first.sample);
    // The stale jump (true) did not survive into the fresh substep (false).
    expect(inputs[0].jumpPressed).toBe(true);
    expect(inputs[1].jumpPressed).toBe(false);
  });

  it("exposes the sendSample flag exactly on the batch boundary for repeated batches", () => {
    const batcher = new PredictionInputBatcher(() => sample());
    const { simulation } = createRecordingSimulation();

    const sends: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      const r = runPredictionSubstep({ deltaSeconds: 1 / 60, batcher, simulation });
      sends.push(r.sendSample);
    }
    // One send opportunity per batch: [T,F,T,F,T,F].
    expect(sends).toEqual([true, false, true, false, true, false]);
  });
});
