import { describe, expect, it } from "vitest";

import {
  REMOTE_INTERPOLATION_DELAY_MS,
  type RemoteInterpolationSample,
  remoteRenderTimeFor,
} from "./remoteInterpolation";
import { RemoteInterpolationRegistry } from "./remoteInterpolationRegistry";
import {
  reconcileRemotePlayers,
  type RemotePlayerSnapshotMap,
  type RemotePlayerView,
} from "./remotePlayerSet";

/** Convenience: build a presentation view. */
function view(
  position: { x: number; y: number; z: number },
  yaw = 0,
): RemotePlayerView {
  return { position, yaw };
}

/** Convenience: build a buffer sample. */
function sample(
  receivedAtMs: number,
  position: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
  yaw = 0,
): RemoteInterpolationSample {
  return { position, yaw, receivedAtMs };
}

/**
 * Mirror of `RemotePlayerManager.sync`'s op application, but WITHOUT any
 * Babylon. Given the ids a manager currently tracks and the latest snapshot
 * map, it runs the SAME pure reconciliation and applies each op to a
 * `RemoteInterpolationRegistry` exactly the way the manager does:
 *   - create → appendSample (seeds a fresh buffer)
 *   - update → appendSample (appends; no immediate snap)
 *   - remove → drop
 *
 * This proves the wiring contract the manager relies on without needing a
 * WebGL scene.
 */
function applySync(
  registry: RemoteInterpolationRegistry,
  trackedIds: readonly string[],
  latest: RemotePlayerSnapshotMap,
  localSessionId: string | null,
  receivedAtMs: number,
): void {
  const ops = reconcileRemotePlayers(trackedIds, latest, localSessionId);
  for (const op of ops.creates) {
    registry.appendSample(op.playerId, sample(receivedAtMs, op.snapshot.position, op.snapshot.yaw));
  }
  for (const op of ops.updates) {
    registry.appendSample(op.playerId, sample(receivedAtMs, op.snapshot.position, op.snapshot.yaw));
  }
  for (const op of ops.removals) {
    registry.drop(op.playerId);
  }
}

describe("RemoteInterpolationRegistry — per-player buffer ownership", () => {
  it("starts empty and tracks nothing", () => {
    const registry = new RemoteInterpolationRegistry();
    expect(registry.size).toBe(0);
    expect(registry.trackedIds()).toEqual([]);
    expect(registry.has("a")).toBe(false);
  });

  it("create adds exactly the first sample to a fresh buffer", () => {
    const registry = new RemoteInterpolationRegistry();
    const stored = registry.appendSample("p1", sample(0, { x: 1, y: 0, z: 0 }));
    expect(stored).toBe(true);
    expect(registry.size).toBe(1);
    expect(registry.has("p1")).toBe(true);

    const buffer = registry.bufferFor("p1");
    expect(buffer?.size).toBe(1);
    // With one sample, interpolation returns that sample.
    expect(buffer?.interpolateAt(50)).toEqual({
      position: { x: 1, y: 0, z: 0 },
      yaw: 0,
    });
  });

  it("update appends rather than snap-overwriting the presentation", () => {
    const registry = new RemoteInterpolationRegistry();
    registry.appendSample("p1", sample(0, { x: 0, y: 0, z: 0 }));
    // A later authoritative sample at a new position.
    registry.appendSample("p1", sample(50, { x: 10, y: 0, z: 0 }));

    const buffer = registry.bufferFor("p1");
    // Two samples are retained (an append, NOT a replace of history).
    expect(buffer?.size).toBe(2);

    // Presentation at t=25ms interpolates BETWEEN the two — it does NOT
    // snap to the newest packet (x would be 10 if it snapped).
    const at25 = buffer?.interpolateAt(25);
    expect(at25?.position.x).toBeCloseTo(5);
  });

  it("keeps a later identical transform as useful history", () => {
    const registry = new RemoteInterpolationRegistry();
    registry.appendSample("p1", sample(0, { x: 3, y: 0, z: 0 }, 0.5));
    // Same transform, LATER receive time — must still be appended.
    const stored = registry.appendSample("p1", sample(100, { x: 3, y: 0, z: 0 }, 0.5));
    expect(stored).toBe(true);
    expect(registry.bufferFor("p1")?.size).toBe(2);

    // The render time falls between the two identical samples → still x=3,
    // finite, and the buffer did NOT collapse to one sample.
    const mid = registry.bufferFor("p1")?.interpolateAt(50);
    expect(mid?.position.x).toBeCloseTo(3);
    expect(mid?.yaw).toBeCloseTo(0.5);
  });

  it("remove drops that remote's interpolation state", () => {
    const registry = new RemoteInterpolationRegistry();
    registry.appendSample("p1", sample(0, { x: 1, y: 0, z: 0 }));
    registry.appendSample("p1", sample(50, { x: 2, y: 0, z: 0 }));
    registry.drop("p1");

    expect(registry.has("p1")).toBe(false);
    expect(registry.bufferFor("p1")).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  it("rejoin starts with fresh history (no stale buffer reused)", () => {
    const registry = new RemoteInterpolationRegistry();
    // First life: two samples.
    registry.appendSample("p1", sample(0, { x: 0, y: 0, z: 0 }));
    registry.appendSample("p1", sample(40, { x: 4, y: 0, z: 0 }));
    // Disappears.
    registry.drop("p1");
    // Reappears much later with a single new spawn sample.
    registry.appendSample("p1", sample(1000, { x: 9, y: 0, z: 0 }));

    const buffer = registry.bufferFor("p1");
    // Fresh history: exactly ONE sample (the rejoin spawn), not the stale two.
    expect(buffer?.size).toBe(1);
    expect(buffer?.interpolateAt(1001)).toEqual({
      position: { x: 9, y: 0, z: 0 },
      yaw: 0,
    });
  });

  it("two remotes do not share buffers or timestamps", () => {
    const registry = new RemoteInterpolationRegistry();
    registry.appendSample("a", sample(0, { x: 0, y: 0, z: 0 }));
    registry.appendSample("b", sample(20, { x: 100, y: 0, z: 0 }));

    // Independent histories: appending to one never affects the other.
    registry.appendSample("a", sample(30, { x: 10, y: 0, z: 0 }));
    expect(registry.bufferFor("a")?.size).toBe(2);
    expect(registry.bufferFor("b")?.size).toBe(1);

    // Each samples from its OWN clock origin.
    const a = registry.bufferFor("a")?.interpolateAt(15);
    const b = registry.bufferFor("b")?.interpolateAt(15);
    expect(a?.position.x).toBeCloseTo(5); // between a's two samples
    expect(b?.position.x).toBeCloseTo(100); // b held at its single sample
  });
});

describe("RemoteInterpolationRegistry — render-time sampling", () => {
  it("samples every buffer at now - REMOTE_INTERPOLATION_DELAY_MS", () => {
    const registry = new RemoteInterpolationRegistry();
    // Samples at t=0 (x=0) and t=100 (x=100).
    registry.appendSample("p1", sample(0, { x: 0, y: 0, z: 0 }));
    registry.appendSample("p1", sample(100, { x: 100, y: 0, z: 0 }));

    // now = 150 → targetTime = 150 - 100 = 50 → x interpolated to 50.
    const now = 150;
    expect(remoteRenderTimeFor(now)).toBe(50);
    const sampled = registry.sampleAll(now);
    expect(sampled["p1"]?.position.x).toBeCloseTo(50);

    // Proves the delay matters: at now = 100 (targetTime = 0) the newest packet
    // is held back and we render the OLDEST sample (x=0), not x=100.
    const sampledAt100 = registry.sampleAll(100);
    expect(sampledAt100["p1"]?.position.x).toBeCloseTo(0);
  });

  it("returns one fresh sample per tracked remote (omitting empty ones)", () => {
    const registry = new RemoteInterpolationRegistry();
    registry.appendSample("a", sample(0, { x: 1, y: 0, z: 0 }));
    registry.appendSample("b", sample(0, { x: 2, y: 0, z: 0 }));

    const result = registry.sampleAll(0);
    expect(Object.keys(result).sort()).toEqual(["a", "b"]);
    expect(result["a"]?.position.x).toBeCloseTo(1);
    expect(result["b"]?.position.x).toBeCloseTo(2);
  });

  it("treats the receive timestamp and the render timestamp as separate clocks", () => {
    const registry = new RemoteInterpolationRegistry();
    // Receive clock: samples at 0 and 100.
    registry.appendSample("p1", sample(0, { x: 0, y: 0, z: 0 }));
    registry.appendSample("p1", sample(100, { x: 100, y: 0, z: 0 }));

    // If render used the receive "now" directly (no delay), now=100 would give
    // x=100. Because render time = now - DELAY, now=100 renders x=0.
    const viaRender = registry.sampleAll(100);
    const directReceive = registry.bufferFor("p1")?.interpolateAt(100);
    expect(viaRender["p1"]?.position.x).toBeCloseTo(0);
    expect(directReceive?.position.x).toBeCloseTo(100);
    expect(REMOTE_INTERPOLATION_DELAY_MS).toBe(100);
  });
});

describe("RemoteInterpolationRegistry — full sync flow (create/update/remove + local)", () => {
  it("creates, updates, and removes via the same ops the manager applies", () => {
    const registry = new RemoteInterpolationRegistry();
    const local = "me";

    // First sync: two remotes + the local session.
    const first: RemotePlayerSnapshotMap = {
      me: view({ x: 5, y: 0, z: 0 }),
      r1: view({ x: 1, y: 0, z: 0 }),
      r2: view({ x: 2, y: 0, z: 0 }),
    };
    applySync(registry, [], first, local, 0);

    expect(registry.trackedIds().sort()).toEqual(["r1", "r2"]);
    expect(registry.bufferFor("r1")?.size).toBe(1);

    // Second sync: r1 moved (update/append), r2 stays, r3 joined, r? none left.
    const second: RemotePlayerSnapshotMap = {
      me: view({ x: 5, y: 0, z: 0 }),
      r1: view({ x: 2, y: 0, z: 0 }),
      r2: view({ x: 2, y: 0, z: 0 }),
      r3: view({ x: 3, y: 0, z: 0 }),
    };
    applySync(registry, registry.trackedIds(), second, local, 50);

    expect(registry.trackedIds().sort()).toEqual(["r1", "r2", "r3"]);
    expect(registry.bufferFor("r1")?.size).toBe(2); // appended, not replaced
    expect(registry.bufferFor("r2")?.size).toBe(2); // update still appends
    expect(registry.bufferFor("r3")?.size).toBe(1); // fresh create

    // Third sync: r2 leaves (removed from the authoritative map).
    const third: RemotePlayerSnapshotMap = {
      me: view({ x: 5, y: 0, z: 0 }),
      r1: view({ x: 2, y: 0, z: 0 }),
      r3: view({ x: 3, y: 0, z: 0 }),
    };
    applySync(registry, registry.trackedIds(), third, local, 100);

    expect(registry.trackedIds().sort()).toEqual(["r1", "r3"]);
    expect(registry.has("r2")).toBe(false);
  });

  it("local player is NEVER buffered", () => {
    const registry = new RemoteInterpolationRegistry();

    // Local is "me"; "r1" is a remote.
    const s1: RemotePlayerSnapshotMap = {
      me: view({ x: 0, y: 0, z: 0 }),
      r1: view({ x: 1, y: 0, z: 0 }),
    };
    applySync(registry, [], s1, "me", 0);
    expect(registry.has("me")).toBe(false); // the local session is excluded
    expect(registry.has("r1")).toBe(true);
  });

  it("a tracked remote that becomes the local session is removed (reclassification)", () => {
    const registry = new RemoteInterpolationRegistry();

    // Local is "me"; "r1" is tracked as a remote.
    const s1: RemotePlayerSnapshotMap = {
      me: view({ x: 0, y: 0, z: 0 }),
      r1: view({ x: 1, y: 0, z: 0 }),
    };
    applySync(registry, [], s1, "me", 0);
    expect(registry.has("r1")).toBe(true);

    // Session change: local is now "r1". "r1" must be DROPPED from the remote
    // buffers (it is local now), while "me" becomes a legitimate remote and is
    // buffered.
    const s2: RemotePlayerSnapshotMap = {
      me: view({ x: 0, y: 0, z: 0 }),
      r1: view({ x: 1, y: 0, z: 0 }),
    };
    applySync(registry, registry.trackedIds(), s2, "r1", 50);

    expect(registry.has("r1")).toBe(false); // reclassified local → removed
    expect(registry.has("me")).toBe(true); // now a remote → buffered
    expect(registry.size).toBe(1);
  });

  it("clear() empties every buffer (disconnect)", () => {
    const registry = new RemoteInterpolationRegistry();
    registry.appendSample("a", sample(0, { x: 0, y: 0, z: 0 }));
    registry.appendSample("b", sample(0, { x: 0, y: 0, z: 0 }));
    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.trackedIds()).toEqual([]);
  });
});
