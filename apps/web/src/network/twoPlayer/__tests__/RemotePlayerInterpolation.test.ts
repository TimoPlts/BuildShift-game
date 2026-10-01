/**
 * Unit tests for RemotePlayerInterpolation — the interpolation buffer for
 * remote player positions in the two-player movement system.
 *
 * Tests cover:
 *  - Linear interpolation between two buffered states
 *  - Buffer management (cap and eviction)
 *  - Disconnect lifecycle (reset clears all data)
 *  - Reconnect lifecycle (reset then reseed produces clean interpolation)
 */
import { describe, expect, it } from "vitest";
import {
  RemotePlayerInterpolation,
  REMOTE_INTERPOLATION_DELAY_MS,
  REMOTE_BUFFER_SIZE,
} from "../index";

function state(
  x: number,
  y = 0,
  z = 0,
  yaw = 0,
): { x: number; y: number; z: number; yaw: number; velocityY: number; grounded: boolean } {
  return { x, y, z, yaw, velocityY: 0, grounded: true };
}

describe("RemotePlayerInterpolation — Interpolation", () => {
  it("returns origin when the buffer is empty", () => {
    const interp = new RemotePlayerInterpolation();
    const result = interp.getInterpolated(1000);
    expect(result).toEqual({ x: 0, y: 0, z: 0, yaw: 0 });
  });

  it("returns the only buffered state when there is one entry", () => {
    const interp = new RemotePlayerInterpolation();
    interp.addState(state(5, 3, 7), 100);

    const result = interp.getInterpolated(100 + REMOTE_INTERPOLATION_DELAY_MS + 100);
    expect(result.x).toBe(5);
    expect(result.y).toBe(3);
    expect(result.z).toBe(7);
  });

  it("linearly interpolates between two buffered states at the midpoint", () => {
    const interp = new RemotePlayerInterpolation();

    interp.addState(state(0), 100);
    interp.addState(state(10), 200);

    // Render at t = 250ms → targetTime = 250 - 100 = 150
    // Bracket: A(100) and B(200), t = (150-100)/(200-100) = 0.5
    // x = lerp(0, 10, 0.5) = 5
    const result = interp.getInterpolated(250);
    expect(result.x).toBeCloseTo(5, 10);
    expect(result.y).toBeCloseTo(0, 10);
    expect(result.z).toBeCloseTo(0, 10);
  });

  it("returns the lower state when target time equals the lower timestamp", () => {
    const interp = new RemotePlayerInterpolation();
    interp.addState(state(0), 100);
    interp.addState(state(10), 200);

    // Render at t = 200ms → targetTime = 200 - 100 = 100
    const result = interp.getInterpolated(200);
    expect(result.x).toBeCloseTo(0, 10);
  });

  it("returns the upper state when target time equals the upper timestamp", () => {
    const interp = new RemotePlayerInterpolation();
    interp.addState(state(0), 100);
    interp.addState(state(10), 200);

    // Render at t = 300ms → targetTime = 300 - 100 = 200
    const result = interp.getInterpolated(300);
    expect(result.x).toBeCloseTo(10, 10);
  });

  it("interpolates all axes (x, y, z) correctly", () => {
    const interp = new RemotePlayerInterpolation();
    interp.addState(state(0, 0, 0), 0);
    interp.addState(state(4, 8, 12), 100);

    // Render at t=150 → targetTime = 50
    // t = 50/100 = 0.5
    const result = interp.getInterpolated(150);
    expect(result.x).toBeCloseTo(2, 10);
    expect(result.y).toBeCloseTo(4, 10);
    expect(result.z).toBeCloseTo(6, 10);
  });

  it("interpolates yaw along the shortest angular path", () => {
    const interp = new RemotePlayerInterpolation();
    const yawA = Math.PI - 0.1;
    const yawB = -Math.PI + 0.1;
    interp.addState(state(0, 0, 0, yawA), 100);
    interp.addState(state(0, 0, 0, yawB), 200);

    // At t=0.5: lerpAngle(π-0.1, -π+0.1, 0.5)
    // diff = (-π+0.1) - (π-0.1) = -2π+0.2 → normalized to +0.2
    // result = (π-0.1) + 0.2*0.5 = π
    const result = interp.getInterpolated(250);
    expect(result.yaw).toBeCloseTo(Math.PI, 6);
  });

  it("holds the last state when target time is beyond the last buffered state (no extrapolation)", () => {
    const interp = new RemotePlayerInterpolation();
    interp.addState(state(10), 200);
    interp.addState(state(20), 300);

    const result = interp.getInterpolated(10000);
    expect(result.x).toBeCloseTo(20, 10);
  });

  it("clamps to the first state when target time is before the first buffered state", () => {
    const interp = new RemotePlayerInterpolation();
    interp.addState(state(5), 500);
    interp.addState(state(10), 600);

    // Render at t=100 → targetTime = 0 < 500 → returns first state.
    const result = interp.getInterpolated(100);
    expect(result.x).toBeCloseTo(5, 10);
  });
});

describe("RemotePlayerInterpolation — Buffer Management", () => {
  it("retains up to REMOTE_BUFFER_SIZE states", () => {
    const interp = new RemotePlayerInterpolation();

    for (let i = 0; i < REMOTE_BUFFER_SIZE; i++) {
      interp.addState(state(i * 10), i * 33);
    }

    expect(interp.lastState!.x).toBe((REMOTE_BUFFER_SIZE - 1) * 10);
    expect(interp.hasData).toBe(true);
  });

  it("evicts the oldest state when the buffer is full", () => {
    const interp = new RemotePlayerInterpolation();

    const totalStates = REMOTE_BUFFER_SIZE + 1;
    for (let i = 0; i < totalStates; i++) {
      interp.addState(state(i * 10), i * 33);
    }

    expect(interp.lastState!.x).toBe((totalStates - 1) * 10);

    // The earliest state (x=0) is evicted; the first surviving state is x=10 at t=33.
    // Render at t=133 → targetTime=33 → should map to the first surviving state.
    const result = interp.getInterpolated(133);
    expect(result.x).toBeGreaterThanOrEqual(10);
  });

  it("reports hasData as true while data exists and false after reset", () => {
    const interp = new RemotePlayerInterpolation();
    expect(interp.hasData).toBe(false);

    interp.addState(state(10), 100);
    expect(interp.hasData).toBe(true);

    interp.reset();
    expect(interp.hasData).toBe(false);
  });

  it("lastState returns null when empty and the newest state when populated", () => {
    const interp = new RemotePlayerInterpolation();
    expect(interp.lastState).toBeNull();

    interp.addState(state(1), 100);
    interp.addState(state(2), 200);
    expect(interp.lastState!.x).toBe(2);
    expect(interp.lastState!.receivedAtMs).toBe(200);
  });
});

describe("RemotePlayerInterpolation — Disconnect Lifecycle", () => {
  it("resets all buffered data when the remote player disconnects", () => {
    const interp = new RemotePlayerInterpolation();

    interp.addState(state(1), 100);
    interp.addState(state(2), 133);
    interp.addState(state(3), 166);

    expect(interp.hasData).toBe(true);
    expect(interp.lastState).not.toBeNull();
    expect(interp.lastState!.x).toBe(3);

    // Simulate disconnect: caller invokes reset().
    interp.reset();

    expect(interp.hasData).toBe(false);
    expect(interp.lastState).toBeNull();

    const result = interp.getInterpolated(200);
    expect(result).toEqual({ x: 0, y: 0, z: 0, yaw: 0 });
  });

  it("interpolation is fully stopped after disconnect (no stale data)", () => {
    const interp = new RemotePlayerInterpolation();

    // States: t=100 (x=5), t=133 (x=10), t=166 (x=15)
    for (let i = 0; i < 3; i++) {
      interp.addState(state((i + 1) * 5, (i + 1) * 2, (i + 1) * 3), 100 + i * 33);
    }

    // Render at t=250 → targetTime=150 → between states t=133 (x=10) and t=166 (x=15)
    const before = interp.getInterpolated(250);
    expect(before.x).toBeGreaterThan(0);

    interp.reset();

    const after = interp.getInterpolated(250);
    expect(after.x).toBe(0);
    expect(after.y).toBe(0);
    expect(after.z).toBe(0);
  });
});

describe("RemotePlayerInterpolation — Reconnect Lifecycle", () => {
  it("begins interpolating from fresh data after reconnection without stale states", () => {
    const interp = new RemotePlayerInterpolation();

    // Phase 1: player connected and moving.
    for (let i = 0; i < 3; i++) {
      interp.addState(state(i * 10, 0, 0), 100 + i * 33);
    }
    expect(interp.lastState!.x).toBe(20);

    // Phase 2: player disconnects.
    interp.reset();
    expect(interp.hasData).toBe(false);

    // Phase 3: player reconnects with fresh data.
    const newStartX = 100;
    interp.addState(state(newStartX, 0, 0), 1000);

    // Only one state → returns that state.
    const result = interp.getInterpolated(1000 + REMOTE_INTERPOLATION_DELAY_MS + 10);
    expect(result.x).toBeCloseTo(newStartX, 10);

    // Add a second state to confirm interpolation works from fresh data only.
    interp.addState(state(newStartX + 10, 0, 0), 1033);

    // Render at t=1116.5 → targetTime = 1016.5
    // lowerIdx=0 (1000 <= 1016.5), upperIdx=1 (1033 > 1016.5)
    // t = (1016.5-1000)/(1033-1000) = 0.5
    // x = lerp(100, 110, 0.5) = 105
    const mid = interp.getInterpolated(1116.5);
    expect(mid.x).toBeCloseTo(newStartX + 5, 10);

    // No stale data from before the disconnect.
    expect(mid.x).not.toBeCloseTo(10, 10);
    expect(mid.x).not.toBeCloseTo(20, 10);
  });

  it("handles multiple disconnect/reconnect cycles correctly", () => {
    const interp = new RemotePlayerInterpolation();

    // Cycle 1: connect → disconnect
    interp.addState(state(10), 100);
    interp.addState(state(20), 133);
    interp.reset();
    expect(interp.hasData).toBe(false);

    // Cycle 2: reconnect with fresh data.
    interp.addState(state(50), 200);
    interp.addState(state(60), 233);

    const result = interp.getInterpolated(250);
    // targetTime = 150 < 200 → clamped to first state (x=50).
    expect(result.x).toBeCloseTo(50, 10);

    // Disconnect again.
    interp.reset();
    expect(interp.hasData).toBe(false);

    // Cycle 3: reconnect again.
    interp.addState(state(100), 300);
    expect(interp.hasData).toBe(true);
    expect(interp.lastState!.x).toBe(100);
  });

  it("does not mix data from different sessions after reconnection", () => {
    const interp = new RemotePlayerInterpolation();

    // Session 1.
    for (let i = 0; i < 3; i++) {
      interp.addState(state(i * 15), 100 + i * 33);
    }

    // Disconnect.
    interp.reset();

    // Session 2: completely different positions.
    interp.addState(state(100), 1000);
    interp.addState(state(200), 1033);

    // Verify interpolation uses only session 2 data.
    const mid = interp.getInterpolated(1016.5 + REMOTE_INTERPOLATION_DELAY_MS);
    // targetTime = 1016.5
    // lowerIdx=0 (1000 <= 1016.5), upperIdx=1
    // t = 16.5/33 = 0.5
    // x = lerp(100, 200, 0.5) = 150
    expect(mid.x).toBeCloseTo(150, 10);

    // The old session positions (0, 15, 30) are gone.
    expect(mid.x).not.toBeCloseTo(0, 10);
    expect(mid.x).not.toBeCloseTo(15, 10);
    expect(mid.x).not.toBeCloseTo(30, 10);
  });
});
