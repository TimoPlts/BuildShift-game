/**
 * Unit tests for the pure movement-feedback math.
 *
 * Pins the two properties the runtime relies on:
 *  - {@link MovementEventTracker} detects jump/land transitions from the
 *    existing predicted movement state alone (grounded + velocityY), reports
 *    the fall speed from the last AIRBORNE velocity (the landing tick itself
 *    zeroes velocityY), and remembers the last ground level;
 *  - {@link MovementCameraMotion} is bounded, self-clearing (exponential
 *    decay to exactly zero), and resets immediately.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOVEMENT_CAMERA_MOTION,
  MovementCameraMotion,
  MovementEventTracker,
  type MovementSample,
} from "./movementFeedbackModel";

const rest: MovementSample = { x: 0, y: 0, z: 0, grounded: true, velocityY: 0 };
const launch: MovementSample = { x: 0, y: 0.24, z: 0, grounded: false, velocityY: 7.33 };
const rising: MovementSample = { x: 0, y: 0.46, z: 0, grounded: false, velocityY: 6.0 };
const falling: MovementSample = { x: 0, y: 0.36, z: 0, grounded: false, velocityY: -2.0 };

describe("MovementEventTracker", () => {
  it("starts at rest: resting samples produce no events", () => {
    const tracker = new MovementEventTracker();
    expect(tracker.sample(rest)).toEqual({ jumped: false, landed: false, landingFallSpeed: 0 });
    expect(tracker.sample(rest)).toEqual({ jumped: false, landed: false, landingFallSpeed: 0 });
  });

  it("detects a jump launch exactly once (grounded true -> false)", () => {
    const tracker = new MovementEventTracker();
    tracker.sample(rest);
    expect(tracker.sample(launch).jumped).toBe(true);
    // Still airborne on the next samples: no repeat event.
    expect(tracker.sample(rising).jumped).toBe(false);
    expect(tracker.sample(falling).jumped).toBe(false);
  });

  it("detects a landing and reports the fall speed from the last airborne velocity", () => {
    const tracker = new MovementEventTracker();
    tracker.sample(rest);
    tracker.sample(launch);
    tracker.sample(rising);
    tracker.sample(falling); // last airborne velocity: -2.0

    const landed = tracker.sample({ x: 0, y: 0, z: 0, grounded: true, velocityY: 0 });
    expect(landed.landed).toBe(true);
    // The landing sample's own velocityY is 0 (the shared step zeroes it);
    // the fall speed must come from the tick before.
    expect(landed.landingFallSpeed).toBeCloseTo(2.0, 6);
    // A continued grounded sample does not re-fire the landing.
    expect(tracker.sample(rest).landed).toBe(false);
  });

  it("ignores an upward velocity at the (degenerate) landing tick", () => {
    const tracker = new MovementEventTracker();
    tracker.sample(rest);
    tracker.sample(launch);
    const events = tracker.sample({ x: 0, y: 0, z: 0, grounded: true, velocityY: 1.5 });
    expect(events.landed).toBe(true);
    expect(events.landingFallSpeed).toBe(0);
  });

  it("tracks the last ground level for takeoff dust placement", () => {
    const tracker = new MovementEventTracker();
    expect(tracker.lastGroundY).toBe(0);

    tracker.sample({ x: 0, y: 2.5, z: 0, grounded: true, velocityY: 0 });
    expect(tracker.lastGroundY).toBe(2.5);

    // Airborne: the ground level is remembered, not overwritten.
    tracker.sample(launch);
    expect(tracker.lastGroundY).toBe(2.5);
  });

  it("reset restores the resting baseline", () => {
    const tracker = new MovementEventTracker();
    tracker.sample(rest);
    tracker.sample(launch); // airborne
    tracker.reset();

    // After reset the baseline is grounded: a resting sample is a no-op and
    // the next launch ticks the jump exactly once.
    expect(tracker.sample(rest)).toEqual({ jumped: false, landed: false, landingFallSpeed: 0 });
    expect(tracker.sample(launch).jumped).toBe(true);
    expect(tracker.lastGroundY).toBe(0);
  });
});

describe("MovementCameraMotion", () => {
  it("starts neutral (no offset)", () => {
    expect(new MovementCameraMotion().currentOffsetMeters).toBe(0);
  });

  it("nudges up on jump and dips down on landing, scaled by fall speed", () => {
    const motion = new MovementCameraMotion();

    motion.onJump();
    expect(motion.currentOffsetMeters).toBeCloseTo(
      DEFAULT_MOVEMENT_CAMERA_MOTION.jumpOffsetMeters,
      6,
    );

    // A normal jump lands at ~8 m/s: a proportional (uncapped) dip.
    motion.onLanding(8);
    const expectedDip = 8 * DEFAULT_MOVEMENT_CAMERA_MOTION.landingOffsetMetersPerMeterPerSec;
    expect(motion.currentOffsetMeters).toBeCloseTo(
      DEFAULT_MOVEMENT_CAMERA_MOTION.jumpOffsetMeters - expectedDip,
      6,
    );
  });

  it("caps the landing dip at the configured maximum for long falls", () => {
    const motion = new MovementCameraMotion();
    motion.onLanding(100); // far beyond terminal velocity
    expect(motion.currentOffsetMeters).toBeCloseTo(
      -DEFAULT_MOVEMENT_CAMERA_MOTION.maxLandingOffsetMeters,
      6,
    );
  });

  it("never dips for a non-positive fall speed", () => {
    const motion = new MovementCameraMotion();
    motion.onLanding(0);
    motion.onLanding(-5);
    expect(motion.currentOffsetMeters).toBe(0);
  });

  it("decays the offset exponentially toward zero as render frames advance", () => {
    const motion = new MovementCameraMotion();
    motion.onJump();
    const start = motion.currentOffsetMeters;

    const afterFrame = motion.update(1 / 30);
    expect(afterFrame).toBeGreaterThan(0);
    expect(afterFrame).toBeLessThan(start);
    expect(afterFrame).toBeCloseTo(
      start * Math.exp(-DEFAULT_MOVEMENT_CAMERA_MOTION.decayRatePerSec / 30),
      6,
    );

    // After enough frames the offset settles fully back to neutral (exactly
    // zero, so the camera receives a clean 0).
    for (let i = 0; i < 120; i += 1) {
      motion.update(1 / 30);
    }
    expect(motion.currentOffsetMeters).toBe(0);
  });

  it("does not decay on a zero or negative frame delta", () => {
    const motion = new MovementCameraMotion();
    motion.onJump();
    const start = motion.currentOffsetMeters;

    expect(motion.update(0)).toBeCloseTo(start, 6);
    expect(motion.update(-1)).toBeCloseTo(start, 6);
    expect(motion.currentOffsetMeters).toBeCloseTo(start, 6);
  });

  it("reset clears the offset immediately", () => {
    const motion = new MovementCameraMotion();
    motion.onJump();
    motion.onLanding(20);
    expect(motion.currentOffsetMeters).not.toBe(0);

    motion.reset();
    expect(motion.currentOffsetMeters).toBe(0);
    expect(motion.update(1 / 30)).toBe(0);
  });

  it("honours a caller-supplied config", () => {
    const motion = new MovementCameraMotion({
      jumpOffsetMeters: 0.02,
      landingOffsetMetersPerMeterPerSec: 0.01,
      maxLandingOffsetMeters: 0.05,
      decayRatePerSec: 1,
    });

    motion.onJump();
    expect(motion.currentOffsetMeters).toBeCloseTo(0.02, 6);
    motion.onLanding(10); // 0.1 -> capped at 0.05
    expect(motion.currentOffsetMeters).toBeCloseTo(-0.03, 6);
    expect(motion.update(1)).toBeCloseTo(-0.03 * Math.exp(-1), 6);
  });
});
