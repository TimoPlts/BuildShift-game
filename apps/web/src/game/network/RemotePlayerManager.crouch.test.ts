/**
 * Behavioral tests for crouch interpolation in {@link RemotePlayerManager}.
 *
 * The remote crouch flag is presentation-only and is NOT linearly blended:
 * the interpolated result reports crouch when EITHER of the two bracketing
 * buffered states is crouched (a logical OR). This means a brief crouch is
 * shown for the whole bracketing interval rather than flickering off at the
 * interpolation midpoint, and a stand-up is shown as soon as the later
 * state lands.
 */
import { describe, expect, it } from "vitest";
import { RemotePlayerManager } from "./RemotePlayerManager";

/** A timed remote state differing only in X position and the crouch flag. */
function state(x: number, crouch: boolean) {
  return { x, y: 0, z: 0, yaw: 0, velocityY: 0, grounded: true, crouch };
}

describe("RemotePlayerManager crouch interpolation", () => {
  it("reports crouch from a single buffered state", () => {
    const r = new RemotePlayerManager();
    r.addState(state(0, true), 0);
    expect(r.getInterpolated(0).crouch).toBe(true);

    r.addState(state(1, true), 1000);
    expect(r.getInterpolated(0).crouch).toBe(true);
  });

  it("reports no crouch for an empty buffer", () => {
    const r = new RemotePlayerManager();
    expect(r.getInterpolated(0).crouch).toBe(false);
  });

  it("reports crouch when either bracketing state is crouched (OR)", () => {
    const r = new RemotePlayerManager();
    // Crouch at t=0, stand at t=1000. Any target time strictly between the
    // two brackets to (lower=crouch, upper=stand) -> OR -> crouch.
    r.addState(state(0, true), 0);
    r.addState(state(10, false), 1000);
    // targetTime = 600 - 100 = 500 -> brackets [0, 1000].
    expect(r.getInterpolated(600).crouch).toBe(true);
  });

  it("does not report crouch when neither bracketing state is crouched", () => {
    const r = new RemotePlayerManager();
    r.addState(state(0, false), 0);
    r.addState(state(10, false), 1000);
    expect(r.getInterpolated(600).crouch).toBe(false);
  });

  it("reports crouch when the later bracketing state is crouched (stand-up)", () => {
    const r = new RemotePlayerManager();
    r.addState(state(0, false), 0);
    r.addState(state(10, true), 1000);
    expect(r.getInterpolated(600).crouch).toBe(true);
  });

  it("holds the last state's crouch when the target time is past the buffer", () => {
    const r = new RemotePlayerManager();
    r.addState(state(0, false), 0);
    r.addState(state(10, true), 1000);
    // Far future: no extrapolation; the last state (crouched) is held.
    expect(r.getInterpolated(5000).crouch).toBe(true);

    // And when the held state is standing, it stays standing.
    const r2 = new RemotePlayerManager();
    r2.addState(state(0, true), 0);
    r2.addState(state(10, false), 1000);
    expect(r2.getInterpolated(5000).crouch).toBe(false);
  });

  it("reset() clears the buffered crouch state", () => {
    const r = new RemotePlayerManager();
    r.addState(state(0, true), 0);
    expect(r.getInterpolated(0).crouch).toBe(true);
    r.reset();
    expect(r.getInterpolated(0).crouch).toBe(false);
  });
});
