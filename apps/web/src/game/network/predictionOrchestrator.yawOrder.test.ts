/**
 * PredictionOrchestrator yaw-ordering tests.
 *
 * The authoritative server consumes an input frame, steps the player using
 * the yaw it held BEFORE that frame, and only then updates its yaw to the
 * frame's lookYaw (room tick: step with `p.yaw`, then `p.yaw = frame.lookYaw`).
 * The client must mirror that exact ordering so that live prediction and the
 * reconciliation replay integrate to the same trajectory the server produces.
 *
 * These tests isolate the yaw-ordering variable: both sides use the SAME
 * deterministic single-step integration (`stepFullMovement` at 30 Hz) and the
 * SAME config, and only the yaw each step is rotated with differs. The
 * vertical axis is held at rest (grounded, no jump) so the comparison is a
 * pure horizontal-integration check.
 */
import { describe, expect, it } from "vitest";
import {
  movementInputToWorld,
  stepFullMovement,
  type FullMovementState,
  type HorizontalMovementConfig,
  type VerticalMovementConfig,
} from "@buildshift/simulation";
import { PLAYER_MOVEMENT, VERTICAL_MOVEMENT } from "@buildshift/game-config";
import { PredictionOrchestrator, SIMULATION_TICK_SECONDS } from "./predictionOrchestrator";

// Reconstruct the exact configs the orchestrator uses internally so the
// reference integration is bit-for-bit the same step.
const HORIZONTAL_CONFIG: Readonly<HorizontalMovementConfig> = {
  moveSpeed: PLAYER_MOVEMENT.moveSpeed,
};
const VERTICAL_CONFIG: Readonly<VerticalMovementConfig> = {
  gravity: VERTICAL_MOVEMENT.gravity,
  jumpVelocity: VERTICAL_MOVEMENT.jumpVelocity,
  maxFallSpeed: VERTICAL_MOVEMENT.maxFallSpeed,
  groundY: VERTICAL_MOVEMENT.groundY,
  jumpSpeed: VERTICAL_MOVEMENT.jumpVelocity,
};

const INITIAL: FullMovementState = {
  x: 0,
  y: VERTICAL_MOVEMENT.groundY,
  z: 0,
  yaw: 0,
  velocityY: 0,
  grounded: true,
};

const dt = SIMULATION_TICK_SECONDS;

/** The movement the player holds every tick: straight forward, no jump. */
const MOVE = { moveX: 0, moveZ: -1 };

/**
 * A yaw that rotates every tick (a strafe-and-turn). Index 0 is the yaw the
 * player holds at the first tick; each later tick adds `step` radians.
 */
function yawSequence(ticks: number, start = 0, step = 0.05): number[] {
  return Array.from({ length: ticks }, (_, i) => start + i * step);
}

/**
 * Integrate a yaw sequence the way the SERVER does: step tick N with the yaw
 * held before it, then adopt the tick's yaw. Returns the final state.
 */
function serverOrderReference(yaws: number[]): FullMovementState {
  let state: FullMovementState = { ...INITIAL };
  let refYaw = INITIAL.yaw;
  for (const frameYaw of yaws) {
    const worldInput = movementInputToWorld(
      { x: MOVE.moveX, z: MOVE.moveZ },
      refYaw,
    );
    state = stepFullMovement(state, worldInput, { jump: false }, dt, HORIZONTAL_CONFIG, VERTICAL_CONFIG);
    refYaw = frameYaw;
  }
  return state;
}

/**
 * Integrate a yaw sequence the way the OLD client did: step tick N with the
 * current frame's yaw (one tick out of order vs the server).
 */
function oldClientOrderReference(yaws: number[]): FullMovementState {
  let state: FullMovementState = { ...INITIAL };
  for (const frameYaw of yaws) {
    const worldInput = movementInputToWorld(
      { x: MOVE.moveX, z: MOVE.moveZ },
      frameYaw,
    );
    state = stepFullMovement(state, worldInput, { jump: false }, dt, HORIZONTAL_CONFIG, VERTICAL_CONFIG);
  }
  return state;
}

function distance(a: FullMovementState, b: FullMovementState): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

describe("PredictionOrchestrator yaw ordering (matches the server)", () => {
  it("live prediction integrates to the server's trajectory while turning", () => {
    const orchestrator = new PredictionOrchestrator();
    const yaws = yawSequence(30, 0, 0.05);

    for (const yaw of yaws) {
      orchestrator.predict({
        moveX: MOVE.moveX,
        moveZ: MOVE.moveZ,
        yaw,
        pitch: 0,
        jump: false,
        crouch: false,
      });
    }

    const predicted = orchestrator.getCurrentState();
    const reference = serverOrderReference(yaws);
    expect(distance(predicted, reference)).toBeLessThan(1e-9);
  });

  it("the old (current-yaw) ordering measurably diverges from the server", () => {
    const yaws = yawSequence(30, 0, 0.05);

    const serverRef = serverOrderReference(yaws);
    const oldRef = oldClientOrderReference(yaws);

    // The old ordering is off by one yaw sample every tick; over 30 ticks of
    // continuous turning this is a real, non-negligible lateral divergence —
    // the exact per-snapshot tug the 20 Hz reconciliation used to pull back.
    expect(distance(serverRef, oldRef)).toBeGreaterThan(0.02);
  });

  it("reconciliation replay continues from the server state with server ordering", () => {
    // Server processed 8 ticks; the client has 3 more buffered inputs in flight.
    const yaws = yawSequence(11, 0, 0.05);
    const ackIndex = 8; // server has consumed ticks 0..7 (sequence 0..7)
    const ackSequence = ackIndex - 1; // 7

    // Server state at the ack point (after consuming tick index 7).
    const serverStateAtAck = serverOrderReference(yaws.slice(0, ackIndex));

    // The orchestrator first predicts the whole sequence locally…
    const orchestrator = new PredictionOrchestrator();
    for (const yaw of yaws) {
      orchestrator.predict({
        moveX: MOVE.moveX,
        moveZ: MOVE.moveZ,
        yaw,
        pitch: 0,
        jump: false,
        crouch: false,
      });
    }

    // …then the authoritative snapshot for sequence 7 arrives with the 3
    // unacked inputs (sequence 8, 9, 10) still buffered.
    const buffered = yaws.slice(ackIndex).map((lookYaw, i) => ({
      input: {
        sequence: ackIndex + i,
        moveX: MOVE.moveX,
        moveZ: MOVE.moveZ,
        lookYaw,
        lookPitch: 0,
        jump: false,
        sprint: false,
        crouch: false,
        primaryFire: false,
        secondaryFire: false,
      },
      predictedX: 0,
      predictedY: 0,
      predictedZ: 0,
      predictedVelocityY: 0,
      predictedGrounded: true,
    }));

    orchestrator.onServerState(
      {
        x: serverStateAtAck.x,
        y: serverStateAtAck.y,
        z: serverStateAtAck.z,
        yaw: serverStateAtAck.yaw,
        velocityY: serverStateAtAck.velocityY,
        grounded: serverStateAtAck.grounded,
        sequence: ackSequence,
      },
      buffered,
    );

    // After replaying the in-flight inputs with the server's ordering, the
    // client must land on the same trajectory the server will produce.
    const reconciled = orchestrator.getCurrentState();
    const serverFull = serverOrderReference(yaws);
    expect(distance(reconciled, serverFull)).toBeLessThan(1e-9);
  });

  it("a straight-ahead run (constant yaw) is unchanged by the ordering fix", () => {
    const orchestrator = new PredictionOrchestrator();
    const yaws = yawSequence(30, 0, 0); // no turning

    for (const yaw of yaws) {
      orchestrator.predict({
        moveX: MOVE.moveX,
        moveZ: MOVE.moveZ,
        yaw,
        pitch: 0,
        jump: false,
        crouch: false,
      });
    }

    const predicted = orchestrator.getCurrentState();
    // Constant yaw => old and server orderings coincide; only forward motion.
    expect(predicted.x).toBeCloseTo(0, 6);
    expect(predicted.z).toBeLessThan(-1);
  });
});
