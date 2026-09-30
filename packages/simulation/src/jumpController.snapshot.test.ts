import { describe, expect, it } from "vitest";
import { JumpController } from "./index.js";
import type { JumpControllerState } from "./index.js";

/**
 * Focused tests for the deterministic snapshot/restore API on JumpController.
 *
 * These prove the controller's internal timing state can be captured, restored,
 * and replayed — the foundation the client reconciliation system needs to roll
 * predicted state back to an acknowledged input and replay later inputs.
 */

const config = { jumpBufferTime: 0.12, coyoteTime: 0.1 };
const dt = 1 / 60;

/** One step of the controller's input timeline. */
interface Step {
  grounded: boolean;
  jumpPressed: boolean;
}

/** Runs a list of steps, recording the launch decision of each. */
function runSteps(
  jc: JumpController,
  steps: readonly Step[],
): boolean[] {
  const launches: boolean[] = [];
  for (const step of steps) {
    launches.push(jc.step(dt, step.grounded, step.jumpPressed));
  }
  return launches;
}

const g = (jumpPressed = false): Step => ({ grounded: true, jumpPressed });
const a = (jumpPressed = false): Step => ({ grounded: false, jumpPressed });

describe("JumpController snapshot/restore", () => {
  describe("SNAPSHOT COPY", () => {
    it("returns the current internal values", () => {
      const jc = new JumpController(config);
      // Grounded, no press, no buffered press: no launch, so the coyote window
      // refreshes to its full configured value and the buffer stays empty.
      jc.step(dt, true, false);

      const state = jc.captureState();
      expect(state).toMatchObject({
        jumpBufferRemaining: 0,
        coyoteRemaining: config.coyoteTime,
      });
    });

    it("returns a copy: mutating the result does not mutate the controller", () => {
      const jc = new JumpController(config);
      jc.step(dt, false, true); // buffer active

      const state = jc.captureState();
      const capturedValues = jc.captureState();
      // Deliberately corrupt the returned object well past its configured
      // maximum (999 > jumpBufferTime and > coyoteTime).
      state.jumpBufferRemaining = 999;
      state.coyoteRemaining = 999;

      // The controller must be untouched by the mutation.
      const after = jc.captureState();
      expect(after).toEqual(capturedValues);
      expect(after.jumpBufferRemaining).toBe(capturedValues.jumpBufferRemaining);
      expect(after.coyoteRemaining).toBe(capturedValues.coyoteRemaining);

      // Attempting to restore the impossible (mutated) snapshot is rejected,
      // and the original controller stays exactly as it was.
      expect(() => jc.restoreState(state)).toThrow(RangeError);
      expect(jc.captureState()).toEqual(capturedValues);
    });

    it("does not share object identity across captures", () => {
      const jc = new JumpController(config);
      const first = jc.captureState();
      const second = jc.captureState();

      expect(first).not.toBe(second);
    });
  });

  describe("ROUND TRIP", () => {
    it("restores behavior from the captured point exactly (A vs B)", () => {
      // Prefix: seed the controller into a non-trivial internal state.
      const prefix: Step[] = [
        g(), // grounded, no press
        a(true), // press while airborne -> buffered
        a(), // still airborne, buffer decaying
      ];

      // Suffix: a sequence whose launch decisions depend on the captured state.
      const suffix: Step[] = [
        g(), // grounded -> buffered press should launch
        a(),
        a(true),
        a(),
        g(),
        g(true),
        a(),
        a(),
        a(),
        g(),
      ];

      const aCtrl = new JumpController(config);
      runSteps(aCtrl, prefix);
      const captured = aCtrl.captureState();
      const aSuffix = runSteps(aCtrl, suffix);

      const bCtrl = new JumpController(config);
      bCtrl.restoreState(captured);
      const bSuffix = runSteps(bCtrl, suffix);

      expect(bSuffix).toEqual(aSuffix);
    });

    it("restoring captured state reproduces the exact internal values", () => {
      const jc = new JumpController(config);
      jc.step(dt, false, true); // buffer active
      const captured = jc.captureState();

      const restored = new JumpController(config);
      restored.restoreState(captured);

      expect(restored.captureState()).toEqual(captured);
    });
  });

  describe("BUFFER RESTORE", () => {
    it("restores an active jump buffer so the pending press still launches", () => {
      const jc = new JumpController(config);
      jc.step(dt, false, true); // press while airborne -> buffered
      const captured = jc.captureState();
      expect(captured.jumpBufferRemaining).toBeGreaterThan(0);

      const restored = new JumpController(config);
      restored.restoreState(captured);

      // The restored controller is airborne but holds the pending press; the
      // next grounded step must launch, exactly as the original would.
      expect(restored.step(dt, true, false)).toBe(true);
      // ...and the press is now consumed.
      expect(restored.step(dt, true, false)).toBe(false);
    });

    it("restores a buffer that has decayed partway (not just a fresh press)", () => {
      const jc = new JumpController(config);
      jc.step(dt, false, true); // press
      jc.step(dt, false, false); // decay one step
      const captured = jc.captureState();
      expect(captured.jumpBufferRemaining).toBeGreaterThan(0);
      expect(captured.jumpBufferRemaining).toBeLessThan(config.jumpBufferTime);

      const restored = new JumpController(config);
      restored.restoreState(captured);

      // The decayed buffer must expire after the same remaining steps.
      const remainingSteps = Math.ceil(
        captured.jumpBufferRemaining / dt + 1e-6,
      );
      for (let i = 0; i < remainingSteps - 1; i += 1) {
        expect(restored.step(dt, false, false)).toBe(false);
      }
      expect(restored.step(dt, true, false)).toBe(false);
    });
  });

  describe("COYOTE RESTORE", () => {
    it("restores an active coyote window so a fresh press still launches", () => {
      const jc = new JumpController(config);
      jc.step(dt, true, false); // grounded -> coyote refreshed
      jc.step(dt, false, false); // airborne -> coyote decaying, still active
      const captured = jc.captureState();
      expect(captured.coyoteRemaining).toBeGreaterThan(0);
      expect(captured.coyoteRemaining).toBeLessThan(config.coyoteTime);

      const restored = new JumpController(config);
      restored.restoreState(captured);

      // A press within the restored coyote window still launches.
      expect(restored.step(dt, false, true)).toBe(true);
    });

    it("restores a coyote window that is already expired", () => {
      const jc = new JumpController(config);
      jc.step(dt, true, false); // seed coyote
      for (let i = 0; i < 12; i += 1) {
        jc.step(dt, false, false); // decay well past coyoteTime
      }
      const captured = jc.captureState();
      expect(captured.coyoteRemaining).toBe(0);

      const restored = new JumpController(config);
      restored.restoreState(captured);

      // No coyote, no buffer -> a press while airborne must NOT launch.
      expect(restored.step(dt, false, true)).toBe(false);
    });
  });

  describe("CONSUMED JUMP", () => {
    it("does not reintroduce an already-consumed jump", () => {
      const jc = new JumpController(config);
      jc.step(dt, true, true); // grounded press -> launch (consumes buffer+coyote)
      const captured = jc.captureState();

      // After a launch the buffer and coyote are both zero.
      expect(captured.jumpBufferRemaining).toBe(0);
      expect(captured.coyoteRemaining).toBe(0);

      const restored = new JumpController(config);
      restored.restoreState(captured);

      // Restoring the consumed state must not resurrect a launch: an airborne
      // step with a press must not launch, since both aids are gone.
      expect(restored.step(dt, false, true)).toBe(false);
    });
  });

  describe("INVALID STATE", () => {
    it("rejects negative remaining times", () => {
      const jc = new JumpController(config);
      const before = jc.captureState();

      expect(() =>
        jc.restoreState({ jumpBufferRemaining: -0.1, coyoteRemaining: 0 }),
      ).toThrow(RangeError);
      expect(() =>
        jc.restoreState({ jumpBufferRemaining: 0, coyoteRemaining: -0.1 }),
      ).toThrow(RangeError);

      // A failed restore is all-or-nothing: controller is unchanged.
      expect(jc.captureState()).toEqual(before);
    });

    it("rejects NaN", () => {
      const jc = new JumpController(config);
      const before = jc.captureState();

      expect(() =>
        jc.restoreState({ jumpBufferRemaining: Number.NaN, coyoteRemaining: 0 }),
      ).toThrow(RangeError);
      expect(() =>
        jc.restoreState({ jumpBufferRemaining: 0, coyoteRemaining: Number.NaN }),
      ).toThrow(RangeError);

      expect(jc.captureState()).toEqual(before);
    });

    it("rejects Infinity and -Infinity", () => {
      const jc = new JumpController(config);
      const before = jc.captureState();

      expect(() =>
        jc.restoreState({
          jumpBufferRemaining: Number.POSITIVE_INFINITY,
          coyoteRemaining: 0,
        }),
      ).toThrow(RangeError);
      expect(() =>
        jc.restoreState({ jumpBufferRemaining: 0, coyoteRemaining: 1e999 }),
      ).toThrow(RangeError);

      expect(jc.captureState()).toEqual(before);
    });

    it("accepts the zeroed state without error", () => {
      const jc = new JumpController(config);
      jc.step(dt, true, true); // consume into a clean-ish state
      expect(() =>
        jc.restoreState({ jumpBufferRemaining: 0, coyoteRemaining: 0 }),
      ).not.toThrow();
      expect(jc.captureState()).toEqual({
        jumpBufferRemaining: 0,
        coyoteRemaining: 0,
      });
    });
  });

  describe("UPPER BOUND", () => {
    it("accepts a jumpBufferRemaining exactly equal to jumpBufferTime", () => {
      const jc = new JumpController(config);
      expect(() =>
        jc.restoreState({
          jumpBufferRemaining: config.jumpBufferTime,
          coyoteRemaining: 0,
        }),
      ).not.toThrow();
      expect(jc.captureState()).toEqual({
        jumpBufferRemaining: config.jumpBufferTime,
        coyoteRemaining: 0,
      });
    });

    it("accepts a coyoteRemaining exactly equal to coyoteTime", () => {
      const jc = new JumpController(config);
      expect(() =>
        jc.restoreState({
          jumpBufferRemaining: 0,
          coyoteRemaining: config.coyoteTime,
        }),
      ).not.toThrow();
      expect(jc.captureState()).toEqual({
        jumpBufferRemaining: 0,
        coyoteRemaining: config.coyoteTime,
      });
    });

    it("rejects a jumpBufferRemaining slightly above jumpBufferTime", () => {
      const jc = new JumpController(config);
      const before = jc.captureState();
      expect(() =>
        jc.restoreState({
          jumpBufferRemaining: config.jumpBufferTime + 1e-9,
          coyoteRemaining: 0,
        }),
      ).toThrow(RangeError);
      expect(jc.captureState()).toEqual(before);
    });

    it("rejects a coyoteRemaining slightly above coyoteTime", () => {
      const jc = new JumpController(config);
      const before = jc.captureState();
      expect(() =>
        jc.restoreState({
          jumpBufferRemaining: 0,
          coyoteRemaining: config.coyoteTime + 1e-9,
        }),
      ).toThrow(RangeError);
      expect(jc.captureState()).toEqual(before);
    });

    it("leaves previous state unchanged when an upper-bound restore fails", () => {
      const jc = new JumpController(config);
      jc.step(dt, false, true); // buffer active
      const before = jc.captureState();
      expect(before.jumpBufferRemaining).toBeGreaterThan(0);

      // A valid field (coyote) paired with an impossible one (buffer > max).
      expect(() =>
        jc.restoreState({
          jumpBufferRemaining: config.jumpBufferTime + 0.5,
          coyoteRemaining: config.coyoteTime,
        }),
      ).toThrow(RangeError);

      // All-or-nothing: the controller keeps its pre-restore values exactly.
      expect(jc.captureState()).toEqual(before);
    });
  });

  describe("RESET", () => {
    it("reset still produces zeroed state", () => {
      const jc = new JumpController(config);
      jc.step(dt, false, true); // buffer active
      jc.reset();

      const state: JumpControllerState = jc.captureState();
      expect(state).toEqual({
        jumpBufferRemaining: 0,
        coyoteRemaining: 0,
      });
    });
  });

  describe("normal step() behavior unchanged", () => {
    it("launches when grounded and a press arrives", () => {
      const jc = new JumpController(config);
      expect(jc.step(dt, true, true)).toBe(true);
    });

    it("buffers a press so a later grounded step launches", () => {
      const jc = new JumpController(config);
      expect(jc.step(dt, false, true)).toBe(false);
      expect(jc.step(dt, true, false)).toBe(true);
      expect(jc.step(dt, true, false)).toBe(false);
    });

    it("grants a coyote-time jump after leaving the ground", () => {
      const jc = new JumpController(config);
      jc.step(dt, true, false);
      expect(jc.step(dt, false, true)).toBe(true);
    });
  });
});
