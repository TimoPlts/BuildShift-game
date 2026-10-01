/**
 * Sustained two-player movement integration test.
 *
 * Drives two independent player states through `stepPlayerMovement` for
 * 75+ frames at the fixed 60 Hz timestep and asserts that:
 *
 * 1. **Sustained displacement** — each player accumulates the expected
 *    total displacement in its input direction over the full simulation
 *    run.
 * 2. **Independence** — the two players do not influence each other;
 *    their state objects evolve purely from their own inputs.
 * 3. **Ground stability** — grounded players stay on the ground plane
 *    throughout (no gravity drift below groundY).
 * 4. **Determinism** — two identical simulation runs produce identical
 *    final states (bit-for-bit equality).
 *
 * This test protects the simulation contract that both the authoritative
 * server room and the client predictor rely on: given the same input
 * sequence, the simulation must produce the same displacement. A bug
 * here (e.g. a missing `deltaSeconds` multiplication, a sign error in the
 * normalisation path, or an unintended reset) would silently break
 * reconciliation in the real multiplayer loop.
 */
import { describe, expect, it } from "vitest";
import {
  stepPlayerMovement,
  type PlayerMovementConfig,
  type PlayerMovementState,
} from "./stepPlayerMovement.js";
import { PHYSICS_TIMING, PLAYER_MOVEMENT, VERTICAL_MOVEMENT } from "@buildshift/game-config";

/** Fixed timestep from shared game-config (60 Hz). */
const DT = PHYSICS_TIMING.fixedStepDurationSeconds;

/** Config assembled from the shared game-config constants. */
const CONFIG: PlayerMovementConfig = {
  moveSpeed: PLAYER_MOVEMENT.moveSpeed,
  gravity: VERTICAL_MOVEMENT.gravity,
  jumpVelocity: VERTICAL_MOVEMENT.jumpVelocity,
  terminalVelocity: VERTICAL_MOVEMENT.terminalVelocity,
  groundY: VERTICAL_MOVEMENT.groundY,
};

/** Number of simulation steps (75 frames > 60+ requirement). */
const TOTAL_FRAMES = 75;

/** Per-frame displacement at the configured speed (meters/frame). */
const DISPLACEMENT_PER_FRAME = PLAYER_MOVEMENT.moveSpeed * DT;

/** Minimum expected total displacement (using TOTAL_FRAMES / 4 as a
 *  generous lower bound so the assertion is robust to floating-point
 *  rounding over many steps). */
const MIN_TOTAL_DISPLACEMENT = (TOTAL_FRAMES / 4) * DISPLACEMENT_PER_FRAME;

/**
 * Creates a grounded player state at the given position.
 */
function makeGroundedPlayer(x: number, z: number): PlayerMovementState {
  return {
    x,
    y: CONFIG.groundY,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    onGround: true,
  };
}

describe("sustained two-player movement simulation (75+ frames)", () => {
  it("accumulates the expected sustained displacement for each player", () => {
    // Player A starts at x=-5, moves forward (−Z) every frame.
    const a0 = makeGroundedPlayer(-5, 0);
    // Player B starts at x=+5, moves in −X direction every frame.
    const b0 = makeGroundedPlayer(5, 0);

    let a = a0;
    let b = b0;

    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      // A: forward movement (local -Z → world -Z at yaw=0).
      a = stepPlayerMovement(
        a,
        { moveX: 0, moveZ: -1, jump: false },
        DT,
        CONFIG,
      );
      // B: left strafe (local -X → world +X at yaw=0, so use -1 for world -X).
      // At yaw 0, movementInputToWorld maps local X=1 to world X=-1,
      // so to move in world -X we need moveX=1 in local space.
      // But since we're passing world-space input directly to stepPlayerMovement,
      // we use moveX=-1 for world -X direction.
      b = stepPlayerMovement(
        b,
        { moveX: -1, moveZ: 0, jump: false },
        DT,
        CONFIG,
      );
    }

    // Player A should have moved in the −Z direction.
    expect(a.z).toBeLessThan(0);
    expect(a0.z - a.z).toBeGreaterThan(MIN_TOTAL_DISPLACEMENT);
    // A should be in the −Z direction relative to start.
    expect(a.z - a0.z).toBeLessThan(-MIN_TOTAL_DISPLACEMENT);

    // Player B should have moved in the −X direction (from +5 toward 0).
    expect(b.x).toBeLessThan(5);
    expect(b0.x - b.x).toBeGreaterThan(MIN_TOTAL_DISPLACEMENT);
    // B should be in the −X direction relative to start.
    expect(b.x - b0.x).toBeLessThan(-MIN_TOTAL_DISPLACEMENT);

    // Verify the exact expected displacement (within floating-point tolerance).
    const expectedADisplacement = TOTAL_FRAMES * DISPLACEMENT_PER_FRAME;
    expect(Math.abs(-(a.z - a0.z) - expectedADisplacement)).toBeLessThan(0.01);
    const expectedBDisplacement = TOTAL_FRAMES * DISPLACEMENT_PER_FRAME;
    expect(Math.abs(-(b.x - b0.x) - expectedBDisplacement)).toBeLessThan(0.01);
  });

  it("keeps both players on the ground throughout the simulation", () => {
    let a = makeGroundedPlayer(-5, 0);
    let b = makeGroundedPlayer(5, 0);

    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      a = stepPlayerMovement(
        a,
        { moveX: 0, moveZ: -1, jump: false },
        DT,
        CONFIG,
      );
      b = stepPlayerMovement(
        b,
        { moveX: -1, moveZ: 0, jump: false },
        DT,
        CONFIG,
      );

      // Both players should remain grounded at the ground level.
      expect(a.onGround).toBe(true);
      expect(a.y).toBe(CONFIG.groundY);
      expect(b.onGround).toBe(true);
      expect(b.y).toBe(CONFIG.groundY);

      // Vertical velocity should be zeroed each step (grounded clamp).
      expect(a.vy).toBe(0);
      expect(b.vy).toBe(0);
    }
  });

  it("preserves player independence — state changes do not cross-contaminate", () => {
    // Run two simulations:
    //   Run 1: both players active.
    //   Run 2: only player A active (B has zero input).
    // Player A's final state must be identical in both runs.
    let a1 = makeGroundedPlayer(-5, 0);
    let b1 = makeGroundedPlayer(5, 0);
    let a2 = makeGroundedPlayer(-5, 0);

    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      a1 = stepPlayerMovement(
        a1,
        { moveX: 0, moveZ: -1, jump: false },
        DT,
        CONFIG,
      );
      b1 = stepPlayerMovement(
        b1,
        { moveX: -1, moveZ: 0, jump: false },
        DT,
        CONFIG,
      );
      // In run 2, player B has zero input (simulating absence).
      a2 = stepPlayerMovement(
        a2,
        { moveX: 0, moveZ: -1, jump: false },
        DT,
        CONFIG,
      );
    }

    // Player A's state must be identical regardless of B's input.
    expect(a1.x).toBe(a2.x);
    expect(a1.y).toBe(a2.y);
    expect(a1.z).toBe(a2.z);
    expect(a1.vx).toBe(a2.vx);
    expect(a1.vy).toBe(a2.vy);
    expect(a1.vz).toBe(a2.vz);
    expect(a1.onGround).toBe(a2.onGround);
  });

  it("is deterministic — identical input sequences produce identical states", () => {
    const runSimulation = (): PlayerMovementState => {
      let state = makeGroundedPlayer(-5, 0);
      for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
        state = stepPlayerMovement(
          state,
          { moveX: 0, moveZ: -1, jump: false },
          DT,
          CONFIG,
        );
      }
      return state;
    };

    const run1 = runSimulation();
    const run2 = runSimulation();

    // Bit-for-bit equality (pure function, same inputs → same outputs).
    expect(run1).toEqual(run2);
    expect(run1.x).toBe(run2.x);
    expect(run1.y).toBe(run2.y);
    expect(run1.z).toBe(run2.z);
    expect(run1.vx).toBe(run2.vx);
    expect(run1.vy).toBe(run2.vy);
    expect(run1.vz).toBe(run2.vz);
    expect(run1.onGround).toBe(run2.onGround);
  });

  it("reaches the expected final position after exactly TOTAL_FRAMES steps", () => {
    const start = makeGroundedPlayer(-5, 0);
    let state = start;

    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      state = stepPlayerMovement(
        state,
        { moveX: 0, moveZ: -1, jump: false },
        DT,
        CONFIG,
      );
    }

    // Expected final Z: startZ - moveSpeed * totalSeconds
    const totalSeconds = TOTAL_FRAMES * DT;
    const expectedZ = start.z - PLAYER_MOVEMENT.moveSpeed * totalSeconds;
    // X should remain unchanged (no X input).
    const expectedX = start.x;

    expect(state.z).toBeCloseTo(expectedZ, 8);
    expect(state.x).toBeCloseTo(expectedX, 10);
    expect(state.y).toBe(CONFIG.groundY);
  });

  it("handles diagonal sustained movement with correct magnitude", () => {
    const start = makeGroundedPlayer(0, 0);
    let state = start;

    // Move in a 45° diagonal (forward-left in world space).
    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      state = stepPlayerMovement(
        state,
        { moveX: -1, moveZ: -1, jump: false },
        DT,
        CONFIG,
      );
    }

    // The total displacement should equal what a straight-line input would
    // produce (diagonal normalisation in stepHorizontalMovement ensures
    // equal speed in all directions).
    const totalSeconds = TOTAL_FRAMES * DT;
    const straightDistance = PLAYER_MOVEMENT.moveSpeed * totalSeconds;
    const diagonalDistance = Math.hypot(state.x - start.x, state.z - start.z);

    expect(diagonalDistance).toBeCloseTo(straightDistance, 6);
    // Both X and Z should have moved by ~ distance/sqrt(2).
    const perAxis = straightDistance / Math.SQRT2;
    expect(Math.abs(state.x - start.x)).toBeCloseTo(perAxis, 4);
    expect(Math.abs(state.z - start.z)).toBeCloseTo(perAxis, 4);
  });

  it("supports reconciliation: replaying from a snapshot reproduces the same state", () => {
    // Simulate 30 frames to create a "server snapshot" state.
    let state = makeGroundedPlayer(-5, 0);
    for (let frame = 0; frame < 30; frame++) {
      state = stepPlayerMovement(
        state,
        { moveX: 0, moveZ: -1, jump: false },
        DT,
        CONFIG,
      );
    }
    const snapshot = { ...state };

    // Continue from the snapshot for 45 more frames.
    let fromSnapshot = snapshot;
    for (let frame = 0; frame < 45; frame++) {
      fromSnapshot = stepPlayerMovement(
        fromSnapshot,
        { moveX: 0, moveZ: -1, jump: false },
        DT,
        CONFIG,
      );
    }

    // Compare with a continuous 75-frame run from the original start.
    let continuous = makeGroundedPlayer(-5, 0);
    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      continuous = stepPlayerMovement(
        continuous,
        { moveX: 0, moveZ: -1, jump: false },
        DT,
        CONFIG,
      );
    }

    // The results should match (within floating-point tolerance for
    // operations performed on already-accumulated values).
    expect(fromSnapshot.x).toBeCloseTo(continuous.x, 6);
    expect(fromSnapshot.y).toBeCloseTo(continuous.y, 6);
    expect(fromSnapshot.z).toBeCloseTo(continuous.z, 6);
  });
});
