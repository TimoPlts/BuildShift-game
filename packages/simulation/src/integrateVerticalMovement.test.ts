import { describe, expect, it } from "vitest";
import { integrateVerticalMovement } from "./movement/integrateVerticalMovement.js";
import type { IntegrateVerticalConfig } from "./movement/types.js";
import { VERTICAL_MOVEMENT } from "@buildshift/game-config";

/** A small, predictable config for unit testing. */
const config: IntegrateVerticalConfig = {
  gravity: -10,
  jumpVelocity: 5,
  groundY: 0,
};

const dt = 1 / 60; // ~16.67 ms fixed timestep

describe("integrateVerticalMovement", () => {
  describe("stationary on ground (no drift)", () => {
    it("keeps position and velocity at zero when no jump is pressed", () => {
      let y = 0;
      let velocity = 0;

      for (let i = 0; i < 120; i++) {
        const result = integrateVerticalMovement(y, velocity, false, dt, config);
        y = result.y;
        velocity = result.velocity;
      }

      expect(y).toBe(0);
      expect(velocity).toBe(0);
    });

    it("reports landed = true while stationary on ground", () => {
      const result = integrateVerticalMovement(0, 0, false, dt, config);
      expect(result.landed).toBe(true);
    });
  });

  describe("single jump arc", () => {
    it("rises above ground and returns to ground", () => {
      let y = 0;
      let velocity = 0;
      let maxHeight = 0;
      let landed = false;
      let peakPassed = false;

      // Press jump on first frame.
      for (let i = 0; i < 300; i++) {
        const jumpPressed = i === 0;
        const result = integrateVerticalMovement(y, velocity, jumpPressed, dt, config);
        y = result.y;
        velocity = result.velocity;

        if (y > maxHeight) maxHeight = y;
        if (y > 0 && velocity < 0) peakPassed = true;
        if (result.landed && peakPassed) {
          landed = true;
          break;
        }
      }

      // Should have risen well above ground.
      expect(maxHeight).toBeGreaterThan(1);
      // Should have come back down to ground.
      expect(landed).toBe(true);
      expect(y).toBeCloseTo(0, 10);
      expect(velocity).toBe(0);
    });

    it("reaches approximately the expected peak height", () => {
      // With v0 = 5, g = -10: max height = v0² / (2*|g|) = 25/20 = 1.25
      // Euler integration will be slightly off but should be close.
      let y = 0;
      let velocity = 0;
      let maxHeight = 0;

      for (let i = 0; i < 200; i++) {
        const jumpPressed = i === 0;
        const result = integrateVerticalMovement(y, velocity, jumpPressed, dt, config);
        y = result.y;
        velocity = result.velocity;

        if (y > maxHeight) maxHeight = y;
        if (result.landed && i > 5) break;
      }

      // Euler method overestimates peak slightly; allow generous tolerance.
      expect(maxHeight).toBeGreaterThan(1.1);
      expect(maxHeight).toBeLessThan(1.35);
    });
  });

  describe("jump pressed while airborne does nothing", () => {
    it("does not change velocity when jump is pressed mid-air", () => {
      // Simulate being airborne: y > groundY, velocity = 3 (going up).
      const y = 2;
      const velocity = 3;

      const result = integrateVerticalMovement(y, velocity, true, dt, config);

      // The velocity should be 3 + gravity*dt, NOT jumpVelocity + gravity*dt.
      const expectedVelocity = velocity + config.gravity * dt;
      expect(result.velocity).toBeCloseTo(expectedVelocity, 10);
      // It should NOT have been set to jumpVelocity.
      const ifJumped = config.jumpVelocity + config.gravity * dt;
      expect(result.velocity).not.toBeCloseTo(ifJumped, 5);
    });

    it("does not launch from a high position with zero velocity", () => {
      // At the very peak of a jump, velocity is 0 but we're airborne.
      const y = 1.2;
      const velocity = 0;

      const result = integrateVerticalMovement(y, velocity, true, dt, config);

      // Should NOT have set velocity to jumpVelocity; just gravity applies.
      expect(result.velocity).toBeCloseTo(config.gravity * dt, 10);
    });
  });

  describe("clamping at ground level", () => {
    it("clamps position to groundY and zeros velocity when falling below", () => {
      // Airborne, moving downward fast enough to pass through ground this step.
      // y=0.1, v=-10, dt=1/60, g=-10:
      //   newV = -10 + (-10)*(1/60) ≈ -10.167
      //   newY = 0.1 + (-10.167)*(1/60) ≈ -0.0694 → below ground
      const y = 0.1;
      const velocity = -10;

      const result = integrateVerticalMovement(y, velocity, false, dt, config);

      expect(result.y).toBe(config.groundY);
      expect(result.velocity).toBe(0);
      expect(result.landed).toBe(true);
    });

    it("clamps to a non-zero ground reference", () => {
      const elevated: IntegrateVerticalConfig = {
        ...config,
        groundY: 5,
      };
      const y = 5.05;
      const velocity = -10;

      const result = integrateVerticalMovement(y, velocity, false, dt, elevated);

      // newY = 5.05 + (-10.167)*(1/60) ≈ 4.88 → below 5, so clamp
      expect(result.y).toBe(5);
      expect(result.velocity).toBe(0);
      expect(result.landed).toBe(true);
    });

    it("does not clamp when approaching ground but staying above", () => {
      // Small downward velocity that keeps us above ground this step.
      const y = 0.5;
      const velocity = -1;

      const result = integrateVerticalMovement(y, velocity, false, dt, config);

      // newY = 0.5 + (-1.167)*(1/60) ≈ 0.481 > 0
      expect(result.y).toBeGreaterThan(0);
      expect(result.landed).toBe(false);
    });
  });

  describe("pure function guarantees", () => {
    it("does not mutate its inputs", () => {
      const inputConfig = { gravity: -10, jumpVelocity: 5, groundY: 0 };
      const frozenConfig = Object.freeze(inputConfig);

      // No error should be thrown; function should not attempt mutation.
      const result = integrateVerticalMovement(0, 0, true, dt, frozenConfig);
      expect(result.y).toBeGreaterThanOrEqual(0);
      expect(frozenConfig.gravity).toBe(-10);
    });
  });

  describe("config from game-config package", () => {
    it("works with the shared VERTICAL_MOVEMENT config", () => {
      // VERTICAL_MOVEMENT has gravity=-20, jumpVelocity=8, groundY=0.
      const result = integrateVerticalMovement(
        VERTICAL_MOVEMENT.groundY,
        0,
        true,
        dt,
        VERTICAL_MOVEMENT,
      );

      // Should launch upward: velocity = 8 + (-20)*dt ≈ 7.667
      expect(result.velocity).toBeGreaterThan(0);
      expect(result.velocity).toBeCloseTo(
        VERTICAL_MOVEMENT.jumpVelocity + VERTICAL_MOVEMENT.gravity * dt,
        10,
      );
    });
  });
});
