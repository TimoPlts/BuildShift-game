/**
 * Focused tests for {@link BuildLatencyMetrics} — the pure latency
 * measurement tracker for the server-authoritative building and edit
 * systems.
 *
 * Covers:
 *  - the three latency phases (input-to-feedback, request-to-accept,
 *    accept-to-replicated-mesh) for both placement and edit;
 *  - rejection paths (no mesh resolution, correct round-trip measurement);
 *  - the "latest action wins" semantics for edit tracking;
 *  - reset / clearInFlight lifecycle;
 *  - the flat reading shape for the diagnostics overlay.
 */
import { describe, expect, it } from "vitest";
import {
  BuildLatencyMetrics,
} from "./buildLatencyMetrics";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Creates a metrics instance with a controllable clock. */
function createFixture(start = 0) {
  let clock = start;
  const metrics = new BuildLatencyMetrics(() => clock);
  return {
    metrics,
    advance(ms: number) {
      clock += ms;
    },
    setClock(v: number) {
      clock = v;
    },
  };
}

// ─── Placement latency ───────────────────────────────────────────────────────

describe("BuildLatencyMetrics — placement", () => {
  it("measures the full placement latency pipeline (send → accept → mesh)", () => {
    const { metrics, advance } = createFixture(0);

    // t=0: user inputs, intent is sent.
    metrics.recordPlacementSent(0);
    expect(metrics.read().placement).toBeNull();

    // t=42ms: server confirms (structure_placed event).
    advance(42);
    metrics.recordPlacementAccepted(0);
    // Still not resolved (mesh not yet visible).
    expect(metrics.read().placement).toBeNull();

    // t=58ms: next frame — the structure is in the mirror, mesh appears.
    advance(16);
    metrics.resolvePlacementMesh(0);

    const reading = metrics.read();
    expect(reading.placement).toEqual({
      inputToFeedbackMs: 0, // synchronous optimistic state
      requestToAcceptMs: 42, // 42ms network round-trip
      acceptToReplicatedMeshMs: 16, // 16ms (one frame) to mesh
    });
  });

  it("measures rejection round-trip (no mesh resolution)", () => {
    const { metrics, advance } = createFixture(0);

    metrics.recordPlacementSent(1);
    advance(30);
    metrics.recordPlacementRejected(1);

    const reading = metrics.read();
    expect(reading.placement).toEqual({
      inputToFeedbackMs: 0,
      requestToAcceptMs: 30,
      acceptToReplicatedMeshMs: 0, // no mesh on rejection
    });
  });

  it("resolving an unknown sequence is a no-op", () => {
    const { metrics } = createFixture(0);
    metrics.resolvePlacementMesh(999);
    expect(metrics.read().placement).toBeNull();
  });

  it("accepting an unknown sequence is a no-op", () => {
    const { metrics } = createFixture(0);
    metrics.recordPlacementAccepted(42);
    expect(metrics.read().placement).toBeNull();
  });

  it("tracks multiple in-flight placements independently", () => {
    const { metrics, advance } = createFixture(0);

    metrics.recordPlacementSent(0);
    advance(10);
    metrics.recordPlacementSent(1);
    advance(20);
    // First placement accepted at t=30.
    metrics.recordPlacementAccepted(0);
    advance(5);
    // Second placement accepted at t=35.
    metrics.recordPlacementAccepted(1);
    advance(16);
    // First mesh at t=51.
    metrics.resolvePlacementMesh(0);
    const first = metrics.read().placement;
    expect(first?.requestToAcceptMs).toBe(30);
    expect(first?.acceptToReplicatedMeshMs).toBe(21); // 30→51

    advance(5);
    // Second mesh at t=56.
    metrics.resolvePlacementMesh(1);
    const second = metrics.read().placement;
    expect(second?.requestToAcceptMs).toBe(25); // 10→35
    expect(second?.acceptToReplicatedMeshMs).toBe(21); // 35→56
  });
});

// ─── Edit latency ────────────────────────────────────────────────────────────

describe("BuildLatencyMetrics — edit", () => {
  it("measures the full edit latency pipeline (send → result → mesh)", () => {
    const { metrics, advance } = createFixture(0);

    metrics.recordEditSent("wall1");
    expect(metrics.read().edit).toBeNull();

    advance(35);
    metrics.recordEditResult("wall1", true);
    // Not yet resolved (mesh not yet visible).
    expect(metrics.read().edit).toBeNull();

    advance(16);
    metrics.resolveEditMesh("wall1");

    const reading = metrics.read();
    expect(reading.edit).toEqual({
      inputToFeedbackMs: 0,
      requestToAcceptMs: 35,
      acceptToReplicatedMeshMs: 16,
    });
  });

  it("measures rejection round-trip for edit (no mesh resolution)", () => {
    const { metrics, advance } = createFixture(0);

    metrics.recordEditSent("wall1");
    advance(25);
    metrics.recordEditResult("wall1", false);

    const reading = metrics.read();
    expect(reading.edit).toEqual({
      inputToFeedbackMs: 0,
      requestToAcceptMs: 25,
      acceptToReplicatedMeshMs: 0,
    });
  });

  it("latest action wins: a second send overwrites the first tracking", () => {
    const { metrics, advance } = createFixture(0);

    // First action sent at t=0.
    metrics.recordEditSent("wall1");
    advance(20);

    // Second action sent at t=20 (overwrites the first).
    metrics.recordEditSent("wall1");
    advance(30);

    // Result at t=50.
    metrics.recordEditResult("wall1", true);
    advance(16);
    metrics.resolveEditMesh("wall1");

    // The measurement reflects the second (latest) action: 30ms round-trip.
    expect(metrics.read().edit?.requestToAcceptMs).toBe(30);
    expect(metrics.read().edit?.acceptToReplicatedMeshMs).toBe(16);
  });

  it("resolving an unknown structure is a no-op", () => {
    const { metrics } = createFixture(0);
    metrics.resolveEditMesh("unknown");
    expect(metrics.read().edit).toBeNull();
  });

  it("result for an unknown structure is a no-op", () => {
    const { metrics } = createFixture(0);
    metrics.recordEditResult("unknown", true);
    expect(metrics.read().edit).toBeNull();
  });
});

// ─── Lifecycle ───────────────────────────────────────────────────────────────

describe("BuildLatencyMetrics — lifecycle", () => {
  it("reset() clears all tracking and last samples", () => {
    const { metrics, advance } = createFixture(0);

    metrics.recordPlacementSent(0);
    advance(10);
    metrics.recordPlacementAccepted(0);
    advance(16);
    metrics.resolvePlacementMesh(0);
    expect(metrics.read().placement).not.toBeNull();

    metrics.recordEditSent("s1");
    advance(10);
    metrics.recordEditResult("s1", true);
    advance(16);
    metrics.resolveEditMesh("s1");
    expect(metrics.read().edit).not.toBeNull();

    metrics.reset();
    expect(metrics.read()).toEqual({ placement: null, edit: null });
  });

  it("clearInFlight() drops in-flight entries but keeps last samples", () => {
    const { metrics, advance } = createFixture(0);

    // Complete one placement.
    metrics.recordPlacementSent(0);
    advance(10);
    metrics.recordPlacementAccepted(0);
    advance(16);
    metrics.resolvePlacementMesh(0);

    // Start another (in-flight).
    metrics.recordPlacementSent(1);

    // Disconnect: clear in-flight.
    metrics.clearInFlight();

    // The last sample is preserved.
    expect(metrics.read().placement?.requestToAcceptMs).toBe(10);

    // The in-flight entry is gone: resolving it is a no-op.
    metrics.resolvePlacementMesh(1);
    // Last sample unchanged.
    expect(metrics.read().placement?.requestToAcceptMs).toBe(10);
  });

  it("reading before any measurement returns nulls", () => {
    const { metrics } = createFixture(0);
    expect(metrics.read()).toEqual({ placement: null, edit: null });
  });

  it("inputToFeedbackMs is always 0 (synchronous optimistic state)", () => {
    const { metrics, advance } = createFixture(0);

    metrics.recordPlacementSent(0);
    advance(10);
    metrics.recordPlacementAccepted(0);
    advance(16);
    metrics.resolvePlacementMesh(0);
    expect(metrics.read().placement?.inputToFeedbackMs).toBe(0);

    metrics.recordEditSent("s1");
    advance(10);
    metrics.recordEditResult("s1", true);
    advance(16);
    metrics.resolveEditMesh("s1");
    expect(metrics.read().edit?.inputToFeedbackMs).toBe(0);
  });
});

// ─── Reading shape (diagnostics contract) ────────────────────────────────────

describe("BuildLatencyMetrics — diagnostics reading shape", () => {
  it("returns a flat, serializable reading suitable for the overlay", () => {
    const { metrics, advance } = createFixture(0);

    metrics.recordPlacementSent(0);
    advance(15);
    metrics.recordPlacementAccepted(0);
    advance(16);
    metrics.resolvePlacementMesh(0);

    metrics.recordEditSent("s1");
    advance(20);
    metrics.recordEditResult("s1", true);
    advance(16);
    metrics.resolveEditMesh("s1");

    const reading = metrics.read();
    // Verify the shape is plain data (no methods, no circular refs).
    expect(typeof reading.placement?.inputToFeedbackMs).toBe("number");
    expect(typeof reading.placement?.requestToAcceptMs).toBe("number");
    expect(typeof reading.placement?.acceptToReplicatedMeshMs).toBe("number");
    expect(typeof reading.edit?.inputToFeedbackMs).toBe("number");
    expect(typeof reading.edit?.requestToAcceptMs).toBe("number");
    expect(typeof reading.edit?.acceptToReplicatedMeshMs).toBe("number");

    // The reading is a snapshot: mutating it doesn't affect the metrics.
    if (reading.placement !== null) {
      reading.placement.requestToAcceptMs = 99999;
    }
    expect(metrics.read().placement?.requestToAcceptMs).toBe(15);
  });
});
