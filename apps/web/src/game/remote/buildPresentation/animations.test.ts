/**
 * Unit tests for buildPresentation animation timing utilities.
 */
import { describe, expect, it } from "vitest";
import {
  animationProgress,
  clamp01,
  createAnimation,
  easeInQuad,
  easeInOutCubic,
  easeOutBack,
} from "./animations";

describe("clamp01", () => {
  it("clamps values below 0 to 0", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(-0.5)).toBe(0);
  });

  it("clamps values above 1 to 1", () => {
    expect(clamp01(2)).toBe(1);
    expect(clamp01(1.5)).toBe(1);
  });

  it("passes through values in [0, 1]", () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
  });
});

describe("easeOutBack", () => {
  it("starts at 0", () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 5);
  });

  it("ends at 1", () => {
    expect(easeOutBack(1)).toBeCloseTo(1, 5);
  });

  it("overshoots past 1 mid-animation", () => {
    const mid = easeOutBack(0.7);
    expect(mid).toBeGreaterThan(1);
  });
});

describe("easeInQuad", () => {
  it("starts at 0", () => {
    expect(easeInQuad(0)).toBe(0);
  });

  it("ends at 1", () => {
    expect(easeInQuad(1)).toBe(1);
  });

  it("accelerates (second half covers more distance than first)", () => {
    const firstHalf = easeInQuad(0.5) - easeInQuad(0);
    const secondHalf = easeInQuad(1) - easeInQuad(0.5);
    expect(secondHalf).toBeGreaterThan(firstHalf);
  });
});

describe("easeInOutCubic", () => {
  it("starts at 0", () => {
    expect(easeInOutCubic(0)).toBe(0);
  });

  it("ends at 1", () => {
    expect(easeInOutCubic(1)).toBe(1);
  });

  it("is symmetric at midpoint", () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 5);
  });
});

describe("animationProgress", () => {
  it("returns 0 at start time", () => {
    const state = createAnimation(1000, 500);
    expect(animationProgress(state, 1000)).toBe(0);
    expect(state.done).toBe(false);
  });

  it("returns progress between 0 and 1 mid-animation", () => {
    const state = createAnimation(1000, 500);
    const progress = animationProgress(state, 1250);
    expect(progress).toBeCloseTo(0.5, 5);
    expect(state.done).toBe(false);
  });

  it("returns 1 and marks done at or past duration", () => {
    const state = createAnimation(1000, 500);
    expect(animationProgress(state, 1500)).toBe(1);
    expect(state.done).toBe(true);

    // Past duration
    expect(animationProgress(state, 2000)).toBe(1);
    expect(state.done).toBe(true);
  });

  it("returns 1 for negative elapsed (before start)", () => {
    const state = createAnimation(1000, 500);
    expect(animationProgress(state, 500)).toBe(0);
    expect(state.done).toBe(false);
  });
});
