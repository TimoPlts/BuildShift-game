import { describe, expect, it } from "vitest";
import {
  SIMULATION_VERSION,
  gameConfigVersion,
  movementInputToWorld,
  stepHorizontalMovement,
} from "./index.js";
import { GAME_CONFIG_VERSION, PLAYER_MOVEMENT } from "@buildshift/game-config";

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
