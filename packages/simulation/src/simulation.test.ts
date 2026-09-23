import { describe, expect, it } from "vitest";
import {
  SIMULATION_VERSION,
  gameConfigVersion,
  movementInputToWorld,
  stepHorizontalMovement,
  stepVerticalMovement,
} from "./index.js";
import {
  GAME_CONFIG_VERSION,
  PLAYER_MOVEMENT,
  PLAYER_PHYSICS,
} from "@buildshift/game-config";

describe("simulation scaffold", () => {
  it("exposes a simulation version", () => {
    expect(SIMULATION_VERSION).toBe("0.1.0");
  });

  it("resolves the shared game-config version across the workspace", () => {
    expect(gameConfigVersion()).toBe(GAME_CONFIG_VERSION);
  });
});

describe("stepHorizontalMovement", () => {
  it("leaves the position unchanged without movement input", () => {
    const position = { x: 2, z: -3 };
    const result = stepHorizontalMovement(
      position,
      { x: 0, z: 0 },
      1,
      PLAYER_MOVEMENT,
    );

    expect(result).toEqual(position);
    expect(result).not.toBe(position);
  });

  it("moves forward at the configured speed", () => {
    const result = stepHorizontalMovement(
      { x: 0, z: 0 },
      { x: 0, z: -1 },
      0.5,
      PLAYER_MOVEMENT,
    );

    expect(result).toEqual({ x: 0, z: -3 });
  });

  it("normalizes diagonal input to the straight-line speed", () => {
    const forward = stepHorizontalMovement(
      { x: 0, z: 0 },
      { x: 0, z: -1 },
      1,
      PLAYER_MOVEMENT,
    );
    const diagonal = stepHorizontalMovement(
      { x: 0, z: 0 },
      { x: 1, z: -1 },
      1,
      PLAYER_MOVEMENT,
    );

    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(
      Math.hypot(forward.x, forward.z),
    );
  });

  it("produces the same displacement across equivalent time steps", () => {
    const oneStep = stepHorizontalMovement(
      { x: 0, z: 0 },
      { x: 0.6, z: -0.8 },
      1,
      PLAYER_MOVEMENT,
    );
    let manySteps = { x: 0, z: 0 };

    for (let step = 0; step < 10; step += 1) {
      manySteps = stepHorizontalMovement(
        manySteps,
        { x: 0.6, z: -0.8 },
        0.1,
        PLAYER_MOVEMENT,
      );
    }

    expect(manySteps.x).toBeCloseTo(oneStep.x);
    expect(manySteps.z).toBeCloseTo(oneStep.z);
  });
});

describe("movementInputToWorld", () => {
  const forward = { x: 0, z: -1 };
  const right = { x: 1, z: 0 };

  it("keeps forward on -Z at yaw zero", () => {
    expect(movementInputToWorld(forward, 0)).toEqual({ x: 0, z: -1 });
  });

  it("rotates forward toward +X at positive 90-degree yaw", () => {
    const result = movementInputToWorld(forward, Math.PI / 2);

    expect(result.x).toBeCloseTo(1);
    expect(result.z).toBeCloseTo(0);
  });

  it("rotates forward toward +Z at 180-degree yaw", () => {
    const result = movementInputToWorld(forward, Math.PI);

    expect(result.x).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(1);
  });

  it("rotates right strafe consistently with camera yaw", () => {
    const result = movementInputToWorld(right, Math.PI / 2);

    expect(result.x).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(1);
  });

  it("preserves vector magnitude while rotating", () => {
    const input = { x: 0.6, z: -0.8 };
    const result = movementInputToWorld(input, 1.234);

    expect(Math.hypot(result.x, result.z)).toBeCloseTo(
      Math.hypot(input.x, input.z),
    );
  });

  it("retains normalized diagonal speed through movement stepping", () => {
    const worldDiagonal = movementInputToWorld({ x: 1, z: -1 }, Math.PI / 3);
    const result = stepHorizontalMovement(
      { x: 0, z: 0 },
      worldDiagonal,
      1,
      PLAYER_MOVEMENT,
    );

    expect(Math.hypot(result.x, result.z)).toBeCloseTo(
      PLAYER_MOVEMENT.moveSpeed,
    );
  });
});

describe("stepVerticalMovement", () => {
  it("integrates gravity into the velocity", () => {
    // No jump, airborne: pure gravity accumulation from rest.
    const result = stepVerticalMovement(
      0,
      false,
      false,
      1,
      PLAYER_PHYSICS,
    );

    expect(result).toBeCloseTo(PLAYER_PHYSICS.gravity * 1);
  });

  it("starts a grounded jump at the jump speed", () => {
    // dt = 0.1 keeps the post-jump velocity (9 - 2.5 = 6.5) positive, so the
    // grounded downward clamp does not kick in and the jump launch is visible.
    const dt = 0.1;
    const result = stepVerticalMovement(
      0,
      true,
      true,
      dt,
      PLAYER_PHYSICS,
    );

    expect(result).toBeCloseTo(PLAYER_PHYSICS.jumpSpeed + PLAYER_PHYSICS.gravity * dt);
  });

  it("rejects a jump while airborne", () => {
    // Aerial request leaves the velocity as pure gravity integration —
    // identical to a request that was never made.
    const airborne = stepVerticalMovement(
      2,
      true,
      false,
      0.5,
      PLAYER_PHYSICS,
    );
    const noRequest = stepVerticalMovement(
      2,
      false,
      false,
      0.5,
      PLAYER_PHYSICS,
    );

    expect(airborne).toBeCloseTo(noRequest);
    expect(airborne).toBeCloseTo(2 + PLAYER_PHYSICS.gravity * 0.5);
  });

  it("clamps downward velocity to zero while grounded", () => {
    // A grounded character never accumulates velocity into the floor, so
    // standing still stays at exactly zero.
    const result = stepVerticalMovement(
      -3,
      false,
      true,
      1,
      PLAYER_PHYSICS,
    );

    expect(result).toBe(0);
  });

  it("produces the same velocity change for equivalent elapsed time", () => {
    const oneStep = stepVerticalMovement(0, false, false, 1, PLAYER_PHYSICS);

    let velocity = 0;
    for (let step = 0; step < 10; step += 1) {
      velocity = stepVerticalMovement(
        velocity,
        false,
        false,
        0.1,
        PLAYER_PHYSICS,
      );
    }

    expect(velocity).toBeCloseTo(oneStep);
  });
});
