import { describe, expect, it } from "vitest";

import {
  interpolateAngle,
  normalizeAngle,
  remoteRenderTimeFor,
  RemoteInterpolationBuffer,
  REMOTE_INTERPOLATION_BUFFER_CAP,
  REMOTE_INTERPOLATION_DELAY_MS,
  shortestAngleDelta,
  type RemoteInterpolationSample,
} from "./remoteInterpolation";

/** Convenience: build a sample. Position defaults to origin, yaw to 0. */
function sample(
  receivedAtMs: number,
  position: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
  yaw = 0,
): RemoteInterpolationSample {
  return { position, yaw, receivedAtMs };
}

const DEG = Math.PI / 180;

describe("angle helpers (pure)", () => {
  it("normalizeAngle maps angles into [-PI, PI)", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(-Math.PI); // 180° -> -180°
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(-Math.PI); // -180° stays -180°
    expect(normalizeAngle(2 * Math.PI)).toBe(0); // 360° -> 0
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(-Math.PI); // 540° -> -180°
    expect(Math.abs(normalizeAngle(4 * Math.PI)) < 1e-12).toBe(true); // 720° -> 0
  });

  it("shortestAngleDelta takes the shortest signed path", () => {
    // +179° -> -179° is a +2° rotation, not -358°.
    expect(shortestAngleDelta(179 * DEG, -179 * DEG)).toBeCloseTo(2 * DEG);
    // -179° -> +179° is a -2° rotation.
    expect(shortestAngleDelta(-179 * DEG, 179 * DEG)).toBeCloseTo(-2 * DEG);
    // Small ordinary delta is preserved.
    expect(shortestAngleDelta(0, 30 * DEG)).toBeCloseTo(30 * DEG);
    // Long way is folded back to the short way.
    expect(shortestAngleDelta(0, 350 * DEG)).toBeCloseTo(-10 * DEG);
  });

  it("interpolateAngle interpolates along the shortest path", () => {
    // +179° -> -179° over a full span lands at 180° (i.e. -PI) at the midpoint.
    const mid = interpolateAngle(179 * DEG, -179 * DEG, 0.5);
    expect(Math.abs(mid - -Math.PI)).toBeLessThan(1e-9);
    // alpha 0 -> start, alpha 1 -> end (normalized).
    expect(interpolateAngle(10 * DEG, 50 * DEG, 0)).toBeCloseTo(10 * DEG);
    expect(interpolateAngle(10 * DEG, 50 * DEG, 1)).toBeCloseTo(50 * DEG);
    // Clamped outside [0,1].
    expect(interpolateAngle(10 * DEG, 50 * DEG, -5)).toBeCloseTo(10 * DEG);
    expect(interpolateAngle(10 * DEG, 50 * DEG, 99)).toBeCloseTo(50 * DEG);
  });

  it("remoteRenderTimeFor subtracts the fixed delay", () => {
    expect(remoteRenderTimeFor(1000)).toBe(900);
    expect(remoteRenderTimeFor(REMOTE_INTERPOLATION_DELAY_MS + 5)).toBe(5);
  });
});

describe("RemoteInterpolationBuffer — edge behavior", () => {
  it("returns null for an empty buffer", () => {
    const buffer = new RemoteInterpolationBuffer();
    expect(buffer.isEmpty).toBe(true);
    expect(buffer.interpolateAt(123)).toBeNull();
  });

  it("returns the single stored sample when only one exists", () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.append(sample(100, { x: 1, y: 2, z: 3 }, 0.5));
    const out = buffer.interpolateAt(100);
    expect(out).not.toBeNull();
    expect(out!.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(out!.yaw).toBeCloseTo(0.5);
  });

  it("returns the exact sample when the target equals a sample's timestamp", () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.append(sample(0, { x: 0, y: 0, z: 0 }));
    buffer.append(sample(100, { x: 10, y: 0, z: 0 }));
    buffer.append(sample(200, { x: 20, y: 0, z: 0 }));
    // Target exactly at the middle sample (t=100) returns that sample.
    const out = buffer.interpolateAt(100);
    expect(out!.position.x).toBeCloseTo(10);
  });

  it("interpolates position at the midpoint between two samples", () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.append(sample(0, { x: 0, y: 0, z: 0 }));
    buffer.append(sample(100, { x: 10, y: 4, z: -6 }));
    const out = buffer.interpolateAt(50);
    expect(out!.position.x).toBeCloseTo(5);
    expect(out!.position.y).toBeCloseTo(2);
    expect(out!.position.z).toBeCloseTo(-3);
  });

  it("interpolates position at a non-midpoint fraction", () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.append(sample(0, { x: 0, y: 0, z: 0 }));
    buffer.append(sample(100, { x: 10, y: 10, z: 10 }));
    // target=30 -> alpha=0.3
    const out = buffer.interpolateAt(30);
    expect(out!.position.x).toBeCloseTo(3);
    expect(out!.position.y).toBeCloseTo(3);
    expect(out!.position.z).toBeCloseTo(3);
    // target=80 -> alpha=0.8
    const out2 = buffer.interpolateAt(80);
    expect(out2!.position.x).toBeCloseTo(8);
  });

  it("clamps to the OLDEST sample when the target is before the oldest", () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.append(sample(100, { x: 5, y: 0, z: 0 }));
    buffer.append(sample(200, { x: 10, y: 0, z: 0 }));
    const out = buffer.interpolateAt(10); // before 100
    expect(out!.position.x).toBeCloseTo(5);
    // Exactly at the oldest also clamps to the oldest.
    const outAt = buffer.interpolateAt(100);
    expect(outAt!.position.x).toBeCloseTo(5);
  });

  it("holds the NEWEST sample when the target is after the newest (no extrapolation)", () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.append(sample(100, { x: 5, y: 0, z: 0 }));
    buffer.append(sample(200, { x: 10, y: 0, z: 0 }));
    const out = buffer.interpolateAt(500); // well after 200
    expect(out!.position.x).toBeCloseTo(10);
    // Exactly at the newest holds the newest.
    const outAt = buffer.interpolateAt(200);
    expect(outAt!.position.x).toBeCloseTo(10);
  });
});

describe("RemoteInterpolationBuffer — yaw interpolation", () => {
  it("interpolates yaw normally for a small, non-wrapping delta", () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.append(sample(0, { x: 0, y: 0, z: 0 }, 0));
    buffer.append(sample(100, { x: 0, y: 0, z: 0 }, Math.PI)); // 180°
    const out = buffer.interpolateAt(50);
    expect(out!.yaw).toBeCloseTo(Math.PI / 2); // 90° at the midpoint
  });

  it("interpolates yaw across the +179° -> -179° wrap along the SHORT path", () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.append(sample(0, { x: 0, y: 0, z: 0 }, 179 * DEG));
    buffer.append(sample(100, { x: 0, y: 0, z: 0 }, -179 * DEG));
    const out = buffer.interpolateAt(50);
    // 179° + 0.5 * (+2°) = 180° -> normalized to -PI. NOT the -358° long way.
    expect(Math.abs(out!.yaw - -Math.PI)).toBeLessThan(1e-9);
  });

  it("interpolates yaw across the -179° -> +179° wrap along the SHORT path", () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.append(sample(0, { x: 0, y: 0, z: 0 }, -179 * DEG));
    buffer.append(sample(100, { x: 0, y: 0, z: 0 }, 179 * DEG));
    const out = buffer.interpolateAt(50);
    // -179° + 0.5 * (-2°) = -180° -> normalized to -PI.
    expect(Math.abs(out!.yaw - -Math.PI)).toBeLessThan(1e-9);
  });

  it("returns a finite, in-range yaw for finite input at the endpoints", () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.append(sample(0, { x: 0, y: 0, z: 0 }, 179 * DEG));
    buffer.append(sample(100, { x: 0, y: 0, z: 0 }, -179 * DEG));
    const start = buffer.interpolateAt(0)!;
    const end = buffer.interpolateAt(100)!;
    expect(Number.isFinite(start.yaw)).toBe(true);
    expect(Number.isFinite(end.yaw)).toBe(true);
    expect(Math.abs(start.yaw - 179 * DEG)).toBeLessThan(1e-9);
    // end is -179°, which normalizes to -179° (already in [-PI, PI)).
    expect(Math.abs(end.yaw - -179 * DEG)).toBeLessThan(1e-9);
  });
});

describe("RemoteInterpolationBuffer — timestamp policy", () => {
  it("safety: a duplicate timestamp is handled deterministically (no NaN/divide-by-zero)", () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.append(sample(100, { x: 1, y: 0, z: 0 }, 0));
    // Same timestamp as the latest → replaces the latest sample in place.
    const replaced = buffer.append(sample(100, { x: 2, y: 0, z: 0 }, 1));
    expect(replaced).toBe(true);
    expect(buffer.size).toBe(1);
    // The latest (replaced) sample is returned; no zero-width interpolation.
    const out = buffer.interpolateAt(100);
    expect(out).not.toBeNull();
    expect(out!.position.x).toBeCloseTo(2);
    expect(Number.isFinite(out!.yaw)).toBe(true);
  });

  it("ignores an out-of-order (older) sample", () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.append(sample(200, { x: 2, y: 0, z: 0 }));
    buffer.append(sample(300, { x: 3, y: 0, z: 0 }));
    // A late sample stamped 100 (older than the latest 300) is ignored.
    const ignored = buffer.append(sample(100, { x: 99, y: 0, z: 0 }));
    expect(ignored).toBe(false);
    expect(buffer.size).toBe(2);
    // History is unchanged: the newest is still x=3.
    const out = buffer.interpolateAt(300);
    expect(out!.position.x).toBeCloseTo(3);
    // The ignored sample is not reachable even at a very old render time.
    const early = buffer.interpolateAt(0);
    expect(early!.position.x).toBeCloseTo(2);
  });

  it("evicts the oldest sample when the cap is exceeded", () => {
    const cap = 4;
    const buffer = new RemoteInterpolationBuffer(cap);
    expect(REMOTE_INTERPOLATION_BUFFER_CAP).toBe(32); // documented default
    for (let i = 0; i < cap + 2; i += 1) {
      buffer.append(sample(i * 100, { x: i, y: 0, z: 0 }));
    }
    // 6 appended, cap 4 → oldest two (x=0 and x=1) evicted; oldest is x=2.
    expect(buffer.size).toBe(cap);
    const oldestView = buffer.interpolateAt(0);
    expect(oldestView!.position.x).toBeCloseTo(2);
    // Newest (x=5) is retained.
    const newestView = buffer.interpolateAt(500);
    expect(newestView!.position.x).toBeCloseTo(5);
  });
});

describe("RemoteInterpolationBuffer — snapshot isolation", () => {
  it("copies snapshots on append (caller mutation cannot corrupt stored history)", () => {
    const buffer = new RemoteInterpolationBuffer();
    const live = {
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
      receivedAtMs: 0,
    };
    buffer.append(live);
    const live2 = {
      position: { x: 10, y: 0, z: 0 },
      yaw: 0,
      receivedAtMs: 100,
    };
    buffer.append(live2);

    // Mutate the caller's original objects after storing them.
    live.position.x = 999;
    live.position.y = 999;
    live.position.z = 999;
    live.yaw = 42;
    live2.position.x = -999;
    live2.position.y = -999;
    live2.position.z = -999;
    live2.yaw = -42;

    // Stored history is unaffected.
    const atStart = buffer.interpolateAt(0);
    expect(atStart!.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(atStart!.yaw).toBe(0);
    const atEnd = buffer.interpolateAt(100);
    expect(atEnd!.position).toEqual({ x: 10, y: 0, z: 0 });
    expect(atEnd!.yaw).toBe(0);
    const mid = buffer.interpolateAt(50);
    expect(mid!.position.x).toBeCloseTo(5);
  });

  it("returns fresh copies (mutating the result cannot corrupt stored history)", () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.append(sample(0, { x: 0, y: 0, z: 0 }));
    buffer.append(sample(100, { x: 10, y: 0, z: 0 }));

    const first = buffer.interpolateAt(50)!;
    first.position.x = 12345;
    first.yaw = 678;

    // A second read is unaffected by the mutation of the first result.
    const second = buffer.interpolateAt(50)!;
    expect(second.position.x).toBeCloseTo(5);
    expect(second.yaw).toBe(0);
  });
});
