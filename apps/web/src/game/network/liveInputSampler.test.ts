import { describe, expect, it } from "vitest";
import { LiveInputSampler } from "./liveInputSampler";

const movement = { x: 0.25, z: -1 };

function step(
  sampler: LiveInputSampler,
  jumpPressed = false,
) {
  return sampler.observeFixedStep(jumpPressed, movement, 1.25, -0.4);
}

describe("LiveInputSampler", () => {
  it("does not send after one fixed substep", () => {
    const sampler = new LiveInputSampler();

    expect(step(sampler)).toBe(null);
  });

  it("sends exactly one sample after two fixed substeps", () => {
    const sampler = new LiveInputSampler();

    expect(step(sampler)).toBe(null);
    expect(step(sampler)).toEqual({
      moveX: 0.25,
      moveZ: -1,
      lookYaw: 1.25,
      lookPitch: -0.4,
      jump: false,
    });
  });

  it("sends exactly two samples after four fixed substeps", () => {
    const sampler = new LiveInputSampler();

    expect(step(sampler)).toBe(null);
    expect(step(sampler)).not.toBe(null);
    expect(step(sampler)).toBe(null);
    expect(step(sampler)).not.toBe(null);
  });

  it("preserves local movement axes without world-space conversion", () => {
    const sampler = new LiveInputSampler();

    step(sampler);
    expect(step(sampler)).toMatchObject({ moveX: 0.25, moveZ: -1 });
  });

  it("includes yaw and pitch in the sample", () => {
    const sampler = new LiveInputSampler();

    step(sampler);
    expect(step(sampler)).toMatchObject({ lookYaw: 1.25, lookPitch: -0.4 });
  });

  it("latches a jump edge from the first substep", () => {
    const sampler = new LiveInputSampler();

    expect(step(sampler, true)).toBe(null);
    expect(step(sampler)?.jump).toBe(true);
  });

  it("latches a jump edge from the second substep", () => {
    const sampler = new LiveInputSampler();

    expect(step(sampler)).toBe(null);
    expect(step(sampler, true)?.jump).toBe(true);
  });

  it("clears the jump latch after a send", () => {
    const sampler = new LiveInputSampler();

    step(sampler, true);
    expect(step(sampler)?.jump).toBe(true);
    expect(step(sampler)).toBe(null);
    expect(step(sampler)?.jump).toBe(false);
  });

  it("clears cadence and pending jump on reset", () => {
    const sampler = new LiveInputSampler();

    step(sampler, true);
    sampler.reset();
    expect(step(sampler)).toBe(null);
    expect(step(sampler)?.jump).toBe(false);
  });
});