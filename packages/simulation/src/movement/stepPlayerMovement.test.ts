import { describe, expect, it } from "vitest";
import {
  stepPlayerMovement,
  type PlayerMovementConfig,
  type PlayerMovementState,
} from "./stepPlayerMovement.js";

/** A small, predictable config for unit testing. */
const config: PlayerMovementConfig = {
  moveSpeed: 6,
  gravity: -20,
  jumpVelocity: 8,
  terminalVelocity: -40,
  groundY: 0,
};

const dt = 1 / 60; // ~16.67 ms fixed timestep

/** A player at rest on the ground at the origin. */
function groundedState(overrides: Partial<PlayerMovementState> = {}): PlayerMovementState {
  return {
    x: 0,
    y: config.groundY,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    onGround: true,
    ...overrides,
  };
}

/** An airborne player above the ground. */
function airborneState(overrides: Partial<PlayerMovementState> = {}): PlayerMovementState {
  return {
    x: 0,
    y: 5,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    onGround: false,
    ...overrides,
  };
}

describe("stepPlayerMovement", () => {
  describe("falling under gravity", () => {
    it("applies downward acceleration to an airborne player with no input", () => {
      const state = airborneState({ vy: 0 });
      const result = stepPlayerMovement(state, { moveX: 0, moveZ: 0, jump: false }, dt, config);

      // vy = 0 + (-20) * (1/60) = -1/3 ≈ -0.333
      expect(result.vy).toBeCloseTo(config.gravity * dt, 10);
      // y should have decreased slightly
      expect(result.y).toBeLessThan(state.y);
      // Still airborne
      expect(result.onGround).toBe(false);
    });

    it("accumulates downward velocity over multiple free-fall steps", () => {
      let state = airborneState({ y: 10, vy: 0 });

      for (let i = 0; i < 30; i++) {
        state = stepPlayerMovement(state, { moveX: 0, moveZ: 0, jump: false }, dt, config);
      }

      // After 30 steps (0.5 s): vy ≈ -20 * 0.5 = -10
      expect(state.vy).toBeCloseTo(config.gravity * 0.5, 1);
      // Still well above ground
      expect(state.y).toBeGreaterThan(0);
      expect(state.onGround).toBe(false);
    });

    it("lands on the ground when falling from a small height", () => {
      let state = airborneState({ y: 0.5, vy: 0 });

      // Run until the player lands.
      for (let i = 0; i < 300; i++) {
        state = stepPlayerMovement(state, { moveX: 0, moveZ: 0, jump: false }, dt, config);
        if (state.onGround) break;
      }

      expect(state.onGround).toBe(true);
      expect(state.y).toBe(config.groundY);
      expect(state.vy).toBe(0);
    });
  });

  describe("jump impulse launching upward", () => {
    it("sets vy to jumpVelocity when grounded and jump is pressed", () => {
      const state = groundedState();
      const result = stepPlayerMovement(state, { moveX: 0, moveZ: 0, jump: true }, dt, config);

      // vy = jumpVelocity + gravity * dt = 8 + (-20/60) ≈ 7.667
      expect(result.vy).toBeCloseTo(config.jumpVelocity + config.gravity * dt, 10);
      expect(result.onGround).toBe(false);
      expect(result.y).toBeGreaterThan(config.groundY);
    });

    it("does not launch a jump while airborne", () => {
      const state = airborneState({ vy: 2 });
      const result = stepPlayerMovement(state, { moveX: 0, moveZ: 0, jump: true }, dt, config);

      // Should NOT have set vy to jumpVelocity; just gravity applies.
      expect(result.vy).toBeCloseTo(2 + config.gravity * dt, 10);
      expect(result.onGround).toBe(false);
    });

    it("completes a full jump arc and lands back on ground", () => {
      let state = groundedState();
      let maxHeight = 0;
      let landed = false;

      // Press jump on first step, then no more input.
      for (let i = 0; i < 300; i++) {
        const jump = i === 0;
        state = stepPlayerMovement(state, { moveX: 0, moveZ: 0, jump }, dt, config);

        if (state.y > maxHeight) maxHeight = state.y;
        if (state.onGround && i > 5) {
          landed = true;
          break;
        }
      }

      expect(landed).toBe(true);
      expect(maxHeight).toBeGreaterThan(1);
      expect(state.y).toBe(config.groundY);
      expect(state.vy).toBe(0);
      expect(state.onGround).toBe(true);
    });
  });

  describe("horizontal + jump combined step", () => {
    it("moves horizontally and launches vertically in the same step", () => {
      const state = groundedState();
      const result = stepPlayerMovement(
        state,
        { moveX: 1, moveZ: 0, jump: true },
        dt,
        config,
      );

      // Horizontal: x should have moved by moveSpeed * dt
      expect(result.x).toBeCloseTo(config.moveSpeed * dt, 10);
      expect(result.vx).toBeCloseTo(config.moveSpeed, 10);
      // Vertical: should have launched
      expect(result.vy).toBeCloseTo(config.jumpVelocity + config.gravity * dt, 10);
      expect(result.onGround).toBe(false);
      expect(result.y).toBeGreaterThan(config.groundY);
    });

    it("moves diagonally at the same speed as a straight line", () => {
      const straight = stepPlayerMovement(
        groundedState(),
        { moveX: 1, moveZ: 0, jump: false },
        dt,
        config,
      );
      const diagonal = stepPlayerMovement(
        groundedState(),
        { moveX: 1, moveZ: 1, jump: false },
        dt,
        config,
      );

      const straightDist = Math.hypot(straight.x, straight.z);
      const diagonalDist = Math.hypot(diagonal.x, diagonal.z);

      expect(diagonalDist).toBeCloseTo(straightDist, 10);
    });

    it("does not move horizontally when no input is given", () => {
      const state = groundedState({ x: 3, z: -2 });
      const result = stepPlayerMovement(state, { moveX: 0, moveZ: 0, jump: false }, dt, config);

      expect(result.x).toBe(3);
      expect(result.z).toBe(-2);
      expect(result.vx).toBe(0);
      expect(result.vz).toBe(0);
    });
  });

  describe("terminal velocity clamp", () => {
    it("clamps falling velocity to terminalVelocity", () => {
      // Start with a very large downward velocity that exceeds terminalVelocity.
      const state = airborneState({ y: 50, vy: -100 });
      const result = stepPlayerMovement(state, { moveX: 0, moveZ: 0, jump: false }, dt, config);

      // vy should be clamped to terminalVelocity, not -100 + gravity*dt.
      expect(result.vy).toBe(config.terminalVelocity);
    });

    it("allows normal falling speeds above terminalVelocity", () => {
      const state = airborneState({ y: 10, vy: -5 });
      const result = stepPlayerMovement(state, { moveX: 0, moveZ: 0, jump: false }, dt, config);

      // -5 + (-20)*(1/60) ≈ -5.333, which is > -40, so no clamp.
      expect(result.vy).toBeCloseTo(-5 + config.gravity * dt, 10);
      expect(result.vy).toBeGreaterThan(config.terminalVelocity);
    });

    it("never exceeds terminal velocity over many free-fall steps", () => {
      let state = airborneState({ y: 100, vy: 0 });

      for (let i = 0; i < 600; i++) {
        state = stepPlayerMovement(state, { moveX: 0, moveZ: 0, jump: false }, dt, config);
        expect(state.vy).toBeGreaterThanOrEqual(config.terminalVelocity);
        if (state.onGround) break;
      }
    });

    it("reaches terminal velocity during long free-fall before landing", () => {
      // Start very high so the player has time to accelerate to terminal
      // velocity before hitting the ground. Track the minimum (most negative)
      // velocity reached during the fall.
      let state = airborneState({ y: 500, vy: 0 });
      let minVy = 0;

      for (let i = 0; i < 6000; i++) {
        state = stepPlayerMovement(state, { moveX: 0, moveZ: 0, jump: false }, dt, config);
        if (state.vy < minVy) minVy = state.vy;
        if (state.onGround) break;
      }

      // The player should have reached (or nearly reached) terminal velocity
      // before landing. minVy should be very close to terminalVelocity.
      expect(minVy).toBeLessThanOrEqual(config.terminalVelocity + 0.5);
    });
  });

  describe("grounded at rest", () => {
    it("stays on the ground with zero velocity when no input is given", () => {
      let state = groundedState();

      for (let i = 0; i < 120; i++) {
        state = stepPlayerMovement(state, { moveX: 0, moveZ: 0, jump: false }, dt, config);
      }

      expect(state.y).toBe(config.groundY);
      expect(state.vy).toBe(0);
      expect(state.onGround).toBe(true);
      expect(state.x).toBe(0);
      expect(state.z).toBe(0);
    });

    it("does not drift below ground when stationary", () => {
      const state = groundedState();
      const result = stepPlayerMovement(state, { moveX: 0, moveZ: 0, jump: false }, dt, config);

      expect(result.y).toBe(config.groundY);
      expect(result.vy).toBe(0);
      expect(result.onGround).toBe(true);
    });
  });

  describe("purity and immutability", () => {
    it("returns a new object without mutating the input state", () => {
      const state = groundedState();
      const frozen = Object.freeze(state);

      const result = stepPlayerMovement(
        frozen,
        Object.freeze({ moveX: 1, moveZ: 0, jump: true }),
        dt,
        config,
      );

      expect(result).not.toBe(frozen);
      expect(state.x).toBe(0);
      expect(state.y).toBe(config.groundY);
      expect(state.vy).toBe(0);
    });
  });
});
