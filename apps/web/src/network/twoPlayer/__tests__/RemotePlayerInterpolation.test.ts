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

function st(x: number, y = 0, z = 0, yaw = 0) {
  return { x, y, z, yaw, velocityY: 0, grounded: true };
}

describe("RemotePlayerInterpolation — Interpolation", () => {
  it("returns origin when the buffer is empty", () => {
    const interp = new RemotePlayerInterpolation();
    expect(interp.getInterpolated(1000)).toEqual({ x: 0, y: 0, z: 0, yaw: 0 });
  });

  it("returns the only buffered state when there is one entry", () => {
    const interp = new RemotePlayerInterpolation();
    interp.addState(st(5, 3, 7), 100);
    const r = interp.getInterpolated(100 + REMOTE_INTERPOLATION_DELAY_MS + 100);
    expect(r.x).toBe(5);
    expect(r.y).toBe(3);
    expect(r.z).toBe(7);
  });

  it("linearly interpolates between two buffered states at the midpoint", () => {
    const interp = new RemotePlayerInterpolation();
    interp.addState(st(0), 100);
    interp.addState(st(10), 200);

    // Render at t=250 → targetTime=150, t=(150-100)/(200-100)=0.5
    const r = interp.getInterpolated(250);
    expect(r.x).toBeCloseTo(5, 10);
    expect(r.y).toBeCloseTo(0, 10);
    expect(r.z).toBeCloseTo(0, 10);
  });

  it("interpolates at α=0.25 and α=0.75 correctly", () => {
    const interp = new RemotePlayerInterpolation();
    interp.addState(st(0), 100);
    interp.addState(st(100), 300);

    // targetTime=150 → t=(150-100)/200=0.25
    expect(interp.getInterpolated(250).x).toBeCloseTo(25, 10);
    // targetTime=250 → t=(250-100)/200=0.75
    expect(interp.getInterpolated(350).x).toBeCloseTo(75, 10);
  });

  it("returns the lower state when target time equals the lower timestamp", () => {
    const interp = new RemotePlayerInterpolation();
    interp.addState(st(0), 100);
    interp.addState(st(10), 200);
    // targetTime=100 → x=0
    expect(interp.getInterpolated(200).x).toBeCloseTo(0, 10);
  });

  it("returns the upper state when target time equals the upper timestamp", () => {
    const interp = new RemotePlayerInterpolation();
    interp.addState(st(0), 100);
    interp.addState(st(10), 200);
    // targetTime=200 → x=10
    expect(interp.getInterpolated(300).x).toBeCloseTo(10, 10);
  });

  it("interpolates all axes (x, y, z) correctly", () => {
    const interp = new RemotePlayerInterpolation();
    interp.addState(st(0, 0, 0), 0);
    interp.addState(st(4, 8, 12), 100);
    const r = interp.getInterpolated(150);
    expect(r.x).toBeCloseTo(2, 10);
    expect(r.y).toBeCloseTo(4, 10);
    expect(r.z).toBeCloseTo(6, 10);
  });

  it("interpolates yaw along the shortest angular path", () => {
    const interp = new RemotePlayerInterpolation();
    interp.addState(st(0, 0, 0, Math.PI - 0.1), 100);
    interp.addState(st(0, 0, 0, -Math.PI + 0.1), 200);
    const r = interp.getInterpolated(250);
    expect(r.yaw).toBeCloseTo(Math.PI, 6);
  });

  it("holds the last state when target time exceeds the buffer (no extrapolation)", () => {
    const interp = new RemotePlayerInterpolation();
    interp.addState(st(10), 200);
    interp.addState(st(20), 300);
    expect(interp.getInterpolated(10000).x).toBeCloseTo(20, 10);
  });

  it("clamps to the first state when target time is before the first buffered state", () => {
    const interp = new RemotePlayerInterpolation();
    interp.addState(st(5), 500);
    interp.addState(st(10), 600);
    expect(interp.getInterpolated(100).x).toBeCloseTo(5, 10);
  });

  it("handles non-uniform time spacing between snapshots", () => {
    const interp = new RemotePlayerInterpolation();
    interp.addState(st(0), 0);
    interp.addState(st(10), 100);
    interp.addState(st(50), 400);

    // targetTime=200 → between t=100 and t=400, fraction=100/300=1/3
    const r = interp.getInterpolated(300);
    expect(r.x).toBeCloseTo(10 + (50 - 10) / 3, 6);
  });

  it("respects the REMOTE_INTERPOLATION_DELAY_MS offset", () => {
    const interp = new RemotePlayerInterpolation();
    interp.addState(st(0), 0);
    interp.addState(st(10), 200);

    expect(interp.getInterpolated(100).x).toBeCloseTo(0, 10);
    expect(interp.getInterpolated(200).x).toBeCloseTo(5, 10);
    expect(interp.getInterpolated(300).x).toBeCloseTo(10, 10);
  });
});

describe("RemotePlayerInterpolation — Buffer Management", () => {
  it("retains up to REMOTE_BUFFER_SIZE states", () => {
    const interp = new RemotePlayerInterpolation();
    for (let i = 0; i < REMOTE_BUFFER_SIZE; i++) {
      interp.addState(st(i * 10), i * 33);
    }
    expect(interp.lastState!.x).toBe((REMOTE_BUFFER_SIZE - 1) * 10);
    expect(interp.hasData).toBe(true);
  });

  it("evicts the oldest state when the buffer is full", () => {
    const interp = new RemotePlayerInterpolation();
    for (let i = 0; i < REMOTE_BUFFER_SIZE + 1; i++) {
      interp.addState(st(i * 10), i * 33);
    }
    expect(interp.lastState!.x).toBe(REMOTE_BUFFER_SIZE * 10);
    // Oldest (x=0) is gone
    expect(interp.getInterpolated(133).x).toBeGreaterThanOrEqual(10);
  });

  it("reports hasData correctly through lifecycle", () => {
    const interp = new RemotePlayerInterpolation();
    expect(interp.hasData).toBe(false);
    interp.addState(st(10), 100);
    expect(interp.hasData).toBe(true);
    interp.reset();
    expect(interp.hasData).toBe(false);
  });

  it("lastState returns null when empty and the newest when populated", () => {
    const interp = new RemotePlayerInterpolation();
    expect(interp.lastState).toBeNull();
    interp.addState(st(1), 100);
    interp.addState(st(2), 200);
    expect(interp.lastState!.x).toBe(2);
    expect(interp.lastState!.receivedAtMs).toBe(200);
  });
});

describe("RemotePlayerInterpolation — Disconnect Lifecycle", () => {
  it("resets all buffered data when the remote player disconnects", () => {
    const interp = new RemotePlayerInterpolation();
    interp.addState(st(1), 100);
    interp.addState(st(2), 133);
    interp.addState(st(3), 166);

    expect(interp.hasData).toBe(true);
    expect(interp.lastState!.x).toBe(3);

    interp.reset();

    expect(interp.hasData).toBe(false);
    expect(interp.lastState).toBeNull();
    expect(interp.getInterpolated(200)).toEqual({ x: 0, y: 0, z: 0, yaw: 0 });
  });

  it("interpolation is fully stopped after disconnect (no stale data)", () => {
    const interp = new RemotePlayerInterpolation();
    for (let i = 0; i < 3; i++) {
      interp.addState(st((i + 1) * 5, (i + 1) * 2, (i + 1) * 3), 100 + i * 33);
    }
    expect(interp.getInterpolated(250).x).toBeGreaterThan(0);

    interp.reset();

    const r = interp.getInterpolated(250);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.z).toBe(0);
  });
});

describe("RemotePlayerInterpolation — Reconnect Lifecycle", () => {
  it("begins interpolating from fresh data after reconnection", () => {
    const interp = new RemotePlayerInterpolation();

    // Phase 1: player connected.
    for (let i = 0; i < 3; i++) interp.addState(st(i * 10), 100 + i * 33);
    expect(interp.lastState!.x).toBe(20);

    // Phase 2: disconnect.
    interp.reset();
    expect(interp.hasData).toBe(false);

    // Phase 3: reconnect with fresh data.
    const start = 100;
    interp.addState(st(start), 1000);
    const single = interp.getInterpolated(1000 + REMOTE_INTERPOLATION_DELAY_MS + 10);
    expect(single.x).toBeCloseTo(start, 10);

    interp.addState(st(start + 10), 1033);
    const mid = interp.getInterpolated(1116.5);
    expect(mid.x).toBeCloseTo(start + 5, 10);
    expect(mid.x).not.toBeCloseTo(10, 10);
    expect(mid.x).not.toBeCloseTo(20, 10);
  });

  it("handles multiple disconnect/reconnect cycles correctly", () => {
    const interp = new RemotePlayerInterpolation();

    interp.addState(st(10), 100);
    interp.addState(st(20), 133);
    interp.reset();
    expect(interp.hasData).toBe(false);

    interp.addState(st(50), 200);
    interp.addState(st(60), 233);
    expect(interp.getInterpolated(250).x).toBeCloseTo(50, 10);

    interp.reset();
    expect(interp.hasData).toBe(false);

    interp.addState(st(100), 300);
    expect(interp.hasData).toBe(true);
    expect(interp.lastState!.x).toBe(100);
  });

  it("does not mix data from different sessions after reconnection", () => {
    const interp = new RemotePlayerInterpolation();

    for (let i = 0; i < 3; i++) interp.addState(st(i * 15), 100 + i * 33);
    interp.reset();

    interp.addState(st(100), 1000);
    interp.addState(st(200), 1033);

    const mid = interp.getInterpolated(1016.5 + REMOTE_INTERPOLATION_DELAY_MS);
    expect(mid.x).toBeCloseTo(150, 10);
    expect(mid.x).not.toBeCloseTo(0, 10);
    expect(mid.x).not.toBeCloseTo(15, 10);
    expect(mid.x).not.toBeCloseTo(30, 10);
  });
});
