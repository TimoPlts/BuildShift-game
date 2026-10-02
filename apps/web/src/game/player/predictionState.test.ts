import { describe, expect, it } from "vitest";
import { clonePredictionState, type PredictionState } from "./predictionState";

function sampleState(overrides: Partial<PredictionState> = {}): PredictionState {
  return {
    position: { x: 1, y: 2, z: 3 },
    verticalVelocity: 4,
    lastGrounded: true,
    jump: { jumpBufferRemaining: 0.1, coyoteRemaining: 0.2 },
    facingYaw: 0.5,
    ...overrides,
  };
}

describe("clonePredictionState", () => {
  it("deep-copies every field, including nested objects", () => {
    const original = sampleState();
    const clone = clonePredictionState(original);

    // Equal by value.
    expect(clone.position).toEqual(original.position);
    expect(clone.jump).toEqual(original.jump);
    expect(clone.verticalVelocity).toBe(original.verticalVelocity);
    expect(clone.lastGrounded).toBe(original.lastGrounded);
    expect(clone.facingYaw).toBe(original.facingYaw);

    // But not referentially equal to any nested object (independent copies).
    expect(clone.position).not.toBe(original.position);
    expect(clone.jump).not.toBe(original.jump);
  });

  it("mutating the clone does not affect the original", () => {
    const original = sampleState();
    const clone = clonePredictionState(original);

    clone.position.x = 99;
    clone.jump.coyoteRemaining = 77;
    clone.verticalVelocity = 11;
    clone.lastGrounded = false;

    expect(original.position.x).toBe(1);
    expect(original.jump.coyoteRemaining).toBe(0.2);
    expect(original.verticalVelocity).toBe(4);
    expect(original.lastGrounded).toBe(true);
  });

  it("mutating the original after cloning does not affect the clone", () => {
    const original = sampleState();
    const clone = clonePredictionState(original);

    original.position.z = -5;
    original.jump.jumpBufferRemaining = 0;

    expect(clone.position.z).toBe(3);
    expect(clone.jump.jumpBufferRemaining).toBe(0.1);
  });
});
