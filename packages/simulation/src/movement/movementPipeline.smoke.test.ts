/**
 * Smoke test verifying the full shared movement pipeline is coherent and
 * deterministic: LocalMovementInput → movementInputToWorld → stepHorizontalMovement.
 *
 * This test wires together the shared types (types.ts), the simulation helpers
 * (movementInputToWorld, stepHorizontalMovement), and the game config
 * (PLAYER_MOVEMENT from @buildshift/game-config) in a single end-to-end path.
 */
import { describe, expect, it } from "vitest";
import { movementInputToWorld } from "./movementInputToWorld.js";
import { stepHorizontalMovement } from "./stepHorizontalMovement.js";
import type { LocalMovementInput } from "./types.js";
import { PLAYER_MOVEMENT } from "@buildshift/game-config";

describe("movement pipeline smoke test", () => {
  const FORWARD: LocalMovementInput = { x: 0, z: -1 };
  const dt = 1; // 1 second
  const startPos = { x: 0, z: 0 };

  it("moves forward along -Z at yaw zero with speed × time displacement", () => {
    const world = movementInputToWorld(FORWARD, 0);
    const result = stepHorizontalMovement(startPos, world, dt, PLAYER_MOVEMENT);

    // At yaw=0, forward local input maps to world -Z exactly.
    // Expected displacement: moveSpeed * dt = 6 in -Z direction.
    expect(result.x).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(-PLAYER_MOVEMENT.moveSpeed * dt);
  });

  it("moves along the correct rotated axis at yaw π/4", () => {
    const world = movementInputToWorld(FORWARD, Math.PI / 4);
    const result = stepHorizontalMovement(startPos, world, dt, PLAYER_MOVEMENT);

    // At yaw=π/4, forward local input maps to world direction (sin π/4, -cos π/4).
    // Expected displacement: moveSpeed * dt * (sin π/4, -cos π/4).
    const expected = PLAYER_MOVEMENT.moveSpeed * dt * Math.SQRT1_2;
    expect(result.x).toBeCloseTo(expected);
    expect(result.z).toBeCloseTo(-expected);
  });

  it("produces deterministic results for repeated identical inputs", () => {
    const yaw = Math.PI / 4;
    const world = movementInputToWorld(FORWARD, yaw);
    const a = stepHorizontalMovement(startPos, world, dt, PLAYER_MOVEMENT);
    const b = stepHorizontalMovement(startPos, world, dt, PLAYER_MOVEMENT);

    expect(a).toEqual(b);
  });
});
