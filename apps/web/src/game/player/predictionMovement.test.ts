import { describe, expect, it } from "vitest";
import { PLAYER_MOVEMENT } from "@buildshift/game-config";
import {
  computePredictionTranslation,
  type PredictionMovementIntent,
} from "./predictionMovement";

const DT = 1 / 60;

/**
 * Proves the explicit-input boundary of `PlayerController`: movement is driven
 * by an EXPLICIT intent (moveX/moveZ/lookYaw), not by reading the browser
 * `InputManager`. The math must match the shared `movementInputToWorld` the
 * authoritative server uses, so local prediction and server authority replay
 * identical movement from the same sample.
 */
describe("computePredictionTranslation (explicit prediction input)", () => {
  it("converts a forward (−Z) intent into a forward world translation at yaw 0", () => {
    const intent: PredictionMovementIntent = { moveX: 0, moveZ: -1, lookYaw: 0 };
    const { x, z } = computePredictionTranslation(intent, DT);
    // movementInputToWorld: x = -x*cos - z*sin = -(-1)*1 = +? -> 0; z = x*sin + z*cos = -1.
    expect(x).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(-PLAYER_MOVEMENT.moveSpeed * DT, 12);
  });

  it("converts a right (+X) intent at yaw 0 into a right world translation", () => {
    const intent: PredictionMovementIntent = { moveX: 1, moveZ: 0, lookYaw: 0 };
    const { x, z } = computePredictionTranslation(intent, DT);
    // world x = -(1)*cos(0) = -1 (Babylon camera-right is world -X).
    expect(x).toBeCloseTo(-PLAYER_MOVEMENT.moveSpeed * DT, 12);
    expect(z).toBeCloseTo(0, 12);
  });

  it("rotates the translation by the facing yaw (same convention as the server)", () => {
    const yaw = Math.PI / 2; // facing +X
    const intent: PredictionMovementIntent = { moveX: 0, moveZ: -1, lookYaw: yaw };
    const { x, z } = computePredictionTranslation(intent, DT);
    // forward = (sin θ, -cos θ) → at θ=π/2: (1, 0) → moving forward means +X.
    expect(x).toBeCloseTo(PLAYER_MOVEMENT.moveSpeed * DT, 12);
    expect(z).toBeCloseTo(0, 12);
  });

  it("normalises diagonal input to unit length (no faster-than-strafe speed)", () => {
    const intent: PredictionMovementIntent = { moveX: 1, moveZ: -1, lookYaw: 0 };
    const { x, z } = computePredictionTranslation(intent, DT);
    const speed = Math.hypot(x, z);
    // Diagonal magnitude is normalised back to exactly moveSpeed * dt.
    expect(speed).toBeCloseTo(PLAYER_MOVEMENT.moveSpeed * DT, 12);
  });

  it("produces zero translation when no movement is held", () => {
    const intent: PredictionMovementIntent = { moveX: 0, moveZ: 0, lookYaw: 0.5 };
    const { x, z } = computePredictionTranslation(intent, DT);
    expect(x).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(0, 12);
  });

  it("scales the translation by the step duration", () => {
    const intent: PredictionMovementIntent = { moveX: 0, moveZ: -1, lookYaw: 0 };
    const short = computePredictionTranslation(intent, 1 / 60);
    const long = computePredictionTranslation(intent, 2 / 60);
    expect(long.z).toBeCloseTo(short.z * 2, 12);
  });
});
