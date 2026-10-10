/**
 * Unit tests for the reconnect grace manager.
 *
 * Verifies: save / restore / expire / cancel / dispose semantics,
 * duplicate-save replacement, and pendingCount tracking.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { createReconnectGraceManager, RECONNECT_GRACE_MS } from "./reconnectGrace.js";

describe("reconnectGrace", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("RECONNECT_GRACE_MS is a positive bounded value", () => {
    expect(RECONNECT_GRACE_MS).toBeGreaterThan(0);
    expect(RECONNECT_GRACE_MS).toBeLessThanOrEqual(10_000);
  });

  it("save + restore returns the snapshot and clears the pending entry", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const mgr = createReconnectGraceManager(3_000, onExpire);

    const snap = { x: 1, health: 50 };
    mgr.save("sess-A", snap);
    expect(mgr.isInGrace("sess-A")).toBe(true);
    expect(mgr.pendingCount).toBe(1);

    const restored = mgr.restore("sess-A");
    expect(restored).toBe(snap);
    expect(mgr.isInGrace("sess-A")).toBe(false);
    expect(mgr.pendingCount).toBe(0);
    // Timer was cleared, so expire should never fire.
    vi.advanceTimersByTime(10_000);
    expect(onExpire).not.toHaveBeenCalled();

    mgr.dispose();
  });

  it("restore returns undefined for an unknown session", () => {
    vi.useFakeTimers();
    const mgr = createReconnectGraceManager(3_000, vi.fn());
    expect(mgr.restore("nonexistent")).toBeUndefined();
    mgr.dispose();
  });

  it("grace expiry calls onExpire with the session and snapshot", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const mgr = createReconnectGraceManager(3_000, onExpire);

    const snap = { health: 25 };
    mgr.save("sess-B", snap);
    expect(onExpire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2_999);
    expect(onExpire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1); // 3_000 total
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onExpire).toHaveBeenCalledWith("sess-B", snap);
    expect(mgr.isInGrace("sess-B")).toBe(false);
    expect(mgr.pendingCount).toBe(0);

    mgr.dispose();
  });

  it("expiry does not fire if the session was restored before the deadline", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const mgr = createReconnectGraceManager(3_000, onExpire);

    mgr.save("sess-C", { v: 1 });
    mgr.restore("sess-C");

    vi.advanceTimersByTime(10_000);
    expect(onExpire).not.toHaveBeenCalled();

    mgr.dispose();
  });

  it("save for the same session replaces the previous timer (no double-expire)", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const mgr = createReconnectGraceManager(3_000, onExpire);

    mgr.save("sess-D", { v: 1 });
    vi.advanceTimersByTime(1_500);
    mgr.save("sess-D", { v: 2 }); // restart the timer

    // Old timer would have fired at 3_000, but the new timer fires at 1_500 + 3_000 = 4_500.
    vi.advanceTimersByTime(1_500); // total 3_000
    expect(onExpire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_500); // total 4_500
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onExpire).toHaveBeenCalledWith("sess-D", { v: 2 });

    mgr.dispose();
  });

  it("cancel removes the pending entry without calling onExpire", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const mgr = createReconnectGraceManager(3_000, onExpire);

    mgr.save("sess-E", { v: 1 });
    mgr.cancel("sess-E");
    expect(mgr.isInGrace("sess-E")).toBe(false);
    expect(mgr.pendingCount).toBe(0);

    vi.advanceTimersByTime(10_000);
    expect(onExpire).not.toHaveBeenCalled();

    mgr.dispose();
  });

  it("dispose cancels all pending timers", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const mgr = createReconnectGraceManager(3_000, onExpire);

    mgr.save("s1", {});
    mgr.save("s2", {});
    mgr.save("s3", {});
    expect(mgr.pendingCount).toBe(3);

    mgr.dispose();
    expect(mgr.pendingCount).toBe(0);

    vi.advanceTimersByTime(10_000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("clearAll cancels all pending timers and clears the map without invoking onExpire", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const mgr = createReconnectGraceManager(3_000, onExpire);

    mgr.save("a", { score: 5 });
    mgr.save("b", { score: 3 });
    expect(mgr.pendingCount).toBe(2);

    mgr.clearAll();
    expect(mgr.pendingCount).toBe(0);
    expect(mgr.isInGrace("a")).toBe(false);
    expect(mgr.isInGrace("b")).toBe(false);

    // Advancing time should NOT trigger the expiry callback.
    vi.advanceTimersByTime(10_000);
    expect(onExpire).not.toHaveBeenCalled();

    // After clearAll, restore should return undefined for previously-pending sessions.
    expect(mgr.restore("a")).toBeUndefined();
    expect(mgr.restore("b")).toBeUndefined();

    mgr.dispose();
  });

  it("clearAll is idempotent — calling it on an already-empty manager is a no-op", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const mgr = createReconnectGraceManager(3_000, onExpire);

    mgr.save("x", {});
    mgr.clearAll();
    mgr.clearAll(); // second call must not throw
    expect(mgr.pendingCount).toBe(0);

    vi.advanceTimersByTime(10_000);
    expect(onExpire).not.toHaveBeenCalled();

    mgr.dispose();
  });

  it("clearAll allows the manager to continue operating for new sessions", () => {
    vi.useFakeTimers();
    const expired: string[] = [];
    const mgr = createReconnectGraceManager(3_000, (sid) => expired.push(sid));

    mgr.save("old", {});
    mgr.clearAll();

    // New session saved after clearAll should work normally.
    mgr.save("new", {});
    expect(mgr.pendingCount).toBe(1);
    expect(mgr.isInGrace("new")).toBe(true);

    vi.advanceTimersByTime(3_000);
    expect(expired).toEqual(["new"]);
    expect(expired).not.toContain("old");

    mgr.dispose();
  });

  it("tracks multiple independent sessions", () => {
    vi.useFakeTimers();
    const expired: string[] = [];
    const mgr = createReconnectGraceManager(3_000, (sid) => expired.push(sid));

    mgr.save("A", {});
    mgr.save("B", {});
    expect(mgr.pendingCount).toBe(2);

    vi.advanceTimersByTime(3_000);
    expect(expired).toContain("A");
    expect(expired).toContain("B");
    expect(mgr.pendingCount).toBe(0);

    mgr.dispose();
  });
});
