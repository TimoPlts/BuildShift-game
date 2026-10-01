import { describe, expect, it } from "vitest";
import {
  stepFullMovement,
  stepVerticalMovement,
} from "./verticalMovement.js";
import type {
  FullMovementState,
  HorizontalMovementConfig,
  VerticalMovementConfig,
  VerticalState,
} from "./types.js";
import { VERTICAL_MOVEMENT } from "@buildshift/game-config";

/** A small, predictable config for unit testing. */
const config: VerticalMovementConfig = {
  gravity: -10,
  jumpSpeed: 5,
  jumpVelocity: 5,
  maxFallSpeed: -15,
  groundY: 0,
};

const horizontalConfig: HorizontalMovementConfig = {
  moveSpeed: 4,
};

const dt = 1 / 60; // ~16.67 ms fixed timestep

describe("stepVerticalMovement (full-state)", () => {
  describe("object at rest on ground stays on ground with no input", () => {
    it("keeps y, velocityY, and grounded unchanged over multiple steps", () => {
      let state: VerticalState = { y: 0, velocityY: 0, grounded: true };

      for (let i = 0; i < 120; i++) {
        state = stepVerticalMovement(state, { jump: false }, dt, config);
      }

      expect(state.y).toBe(0);
      expect(state.velocityY).toBe(0);
      expect(state.grounded).toBe(true);
    });

    it("does not drift below ground when stationary", () => {
      const state: VerticalState = { y: 0, velocityY: 0, grounded: true };
      const result = stepVerticalMovement(state, { jump: false }, dt, config);

      expect(result.y).toBe(config.groundY);
      expect(result.velocityY).toBe(0);
      expect(result.grounded).toBe(true);
    });
  });

  describe("jump sets velocityY to jumpVelocity and grounded to false", () => {
    it("launches with the configured jumpVelocity when grounded", () => {
      const state: VerticalState = { y: 0, velocityY: 0, grounded: true };
      const result = stepVerticalMovement(state, { jump: true }, dt, config);

      // velocityY = jumpVelocity + gravity * dt = 5 + (-10)*(1/60) ≈ 4.833
      expect(result.velocityY).toBeCloseTo(
        config.jumpVelocity! + config.gravity * dt,
        10,
      );
      expect(result.grounded).toBe(false);
      expect(result.y).toBeGreaterThan(0);
    });

    it("does not launch a jump while airborne", () => {
      const state: VerticalState = { y: 1, velocityY: 2, grounded: false };
      const result = stepVerticalMovement(state, { jump: true }, dt, config);

      // Should NOT have set velocity to jumpVelocity; just gravity applies.
      expect(result.velocityY).toBeCloseTo(
        2 + config.gravity * dt,
        10,
      );
      expect(result.grounded).toBe(false);
    });
  });

  describe("object rises then falls back to ground", () => {
    it("completes a full jump arc and lands on ground", () => {
      let state: VerticalState = { y: 0, velocityY: 0, grounded: true };
      let maxHeight = 0;
      let landed = false;
      let peakPassed = false;

      // Press jump on first frame.
      for (let i = 0; i < 300; i++) {
        const jump = i === 0;
        state = stepVerticalMovement(state, { jump }, dt, config);

        if (state.y > maxHeight) maxHeight = state.y;
        if (state.y > 0 && state.velocityY < 0) peakPassed = true;
        if (state.grounded && peakPassed) {
          landed = true;
          break;
        }
      }

      // Should have risen well above ground.
      expect(maxHeight).toBeGreaterThan(1);
      // Should have come back down to ground.
      expect(landed).toBe(true);
      expect(state.y).toBeCloseTo(0, 10);
      expect(state.velocityY).toBe(0);
      expect(state.grounded).toBe(true);
    });

    it("reaches approximately the expected peak height", () => {
      // With v0 = 5, g = -10: max height = v0² / (2*|g|) = 25/20 = 1.25
      // Euler integration will be slightly off but should be close.
      let state: VerticalState = { y: 0, velocityY: 0, grounded: true };
      let maxHeight = 0;

      for (let i = 0; i < 200; i++) {
        const jump = i === 0;
        state = stepVerticalMovement(state, { jump }, dt, config);
        if (state.y > maxHeight) maxHeight = state.y;
        if (state.grounded && i > 5) break;
      }

      // Euler method overestimates peak slightly; allow generous tolerance.
      expect(maxHeight).toBeGreaterThan(1.1);
      expect(maxHeight).toBeLessThan(1.35);
    });
  });

  describe("terminal velocity clamp is applied", () => {
    it("clamps falling velocity to maxFallSpeed", () => {
      // Start high with a large downward velocity that exceeds maxFallSpeed.
      const state: VerticalState = { y: 10, velocityY: -50, grounded: false };
      const result = stepVerticalMovement(state, { jump: false }, dt, config);

      // velocityY should be clamped to maxFallSpeed (-15), not -50 + gravity*dt.
      expect(result.velocityY).toBe(config.maxFallSpeed);
    });

    it("allows normal falling below maxFallSpeed", () => {
      const state: VerticalState = { y: 10, velocityY: -5, grounded: false };
      const result = stepVerticalMovement(state, { jump: false }, dt, config);

      // -5 + (-10)*(1/60) ≈ -5.167, which is > -15, so no clamp.
      expect(result.velocityY).toBeCloseTo(-5 + config.gravity * dt, 10);
      expect(result.velocityY).toBeGreaterThan(config.maxFallSpeed!);
    });

    it("never exceeds terminal velocity over many free-fall steps", () => {
      let state: VerticalState = { y: 100, velocityY: 0, grounded: false };

      for (let i = 0; i < 600; i++) {
        state = stepVerticalMovement(state, { jump: false }, dt, config);
        // Should never be more negative than maxFallSpeed.
        expect(state.velocityY).toBeGreaterThanOrEqual(config.maxFallSpeed!);
        if (state.grounded) break;
      }
    });
  });

  describe("does not mutate its arguments", () => {
    it("returns a new object and leaves the input state unchanged", () => {
      const state: VerticalState = { y: 1, velocityY: 3, grounded: false };
      const frozen = Object.freeze(state);
      const input = Object.freeze({ jump: false });

      const result = stepVerticalMovement(frozen, input, dt, config);

      expect(result).not.toBe(frozen);
      expect(state.y).toBe(1);
      expect(state.velocityY).toBe(3);
      expect(state.grounded).toBe(false);
    });
  });

  describe("works with the shared VERTICAL_MOVEMENT game-config", () => {
    it("launches with the shared config values", () => {
      const state: VerticalState = {
        y: VERTICAL_MOVEMENT.groundY,
        velocityY: 0,
        grounded: true,
      };
      const result = stepVerticalMovement(state, { jump: true }, dt, VERTICAL_MOVEMENT);

      expect(result.velocityY).toBeCloseTo(
        VERTICAL_MOVEMENT.jumpVelocity + VERTICAL_MOVEMENT.gravity * dt,
        10,
      );
      expect(result.grounded).toBe(false);
    });
  });
});

describe("stepFullMovement", () => {
  it("combines horizontal and vertical movement correctly", () => {
    const state: FullMovementState = {
      x: 0,
      y: 0,
      z: 0,
      yaw: Math.PI / 4,
      velocityY: 0,
      grounded: true,
    };

    const result = stepFullMovement(
      state,
      { x: 1, z: 0 },
      { jump: true },
      dt,
      horizontalConfig,
      config,
    );

    // Horizontal: x should have moved by moveSpeed * dt = 4/60
    expect(result.x).toBeCloseTo(4 * dt);
    expect(result.z).toBeCloseTo(0);
    // Vertical: should have launched
    expect(result.y).toBeGreaterThan(0);
    expect(result.velocityY).toBeCloseTo(
      config.jumpVelocity! + config.gravity * dt,
      10,
    );
    expect(result.grounded).toBe(false);
    // Yaw should pass through unchanged.
    expect(result.yaw).toBe(Math.PI / 4);
  });

  it("keeps yaw unchanged across multiple steps", () => {
    let state: FullMovementState = {
      x: 0,
      y: 0,
      z: 0,
      yaw: 0.731,
      velocityY: 0,
      grounded: true,
    };

    for (let i = 0; i < 30; i++) {
      state = stepFullMovement(
        state,
        { x: 0, z: -1 },
        { jump: i === 0 },
        dt,
        horizontalConfig,
        config,
      );
    }

    expect(state.yaw).toBe(0.731);
  });

  it("returns a new object without mutating the input state", () => {
    const state: FullMovementState = {
      x: 1,
      y: 2,
      z: 3,
      yaw: 0.5,
      velocityY: 4,
      grounded: false,
    };
    const frozen = Object.freeze(state);

    const result = stepFullMovement(
      frozen,
      { x: 0, z: 0 },
      { jump: false },
      dt,
      horizontalConfig,
      config,
    );

    expect(result).not.toBe(frozen);
    expect(state.x).toBe(1);
    expect(state.y).toBe(2);
    expect(state.z).toBe(3);
    expect(state.velocityY).toBe(4);
  });
});
