/**
 * Focused tests for the DeveloperDiagnosticsOverlay URL opt-in helper
 * and the overlay's state update logic.
 */
import { describe, expect, it } from "vitest";
import {
  devDiagEnabledFromUrl,
  DeveloperDiagnosticsOverlay,
} from "./DeveloperDiagnosticsOverlay";
import type { DiagnosticsSnapshot } from "../game/diagnostics";
import type { MovementMetricsReading } from "../game/diagnostics/movementMetrics";

const movementReading: MovementMetricsReading = {
  frameMsAvg: 16.7,
  frameMsMax: 33.2,
  simTicksPerSec: 30,
  snapshotsPerSec: 20,
  snapshotGapMaxMs: 52,
  pendingInputs: 2,
  correctionsPerSec: 19.9,
  correctionMaxMeters: 0.0035,
};

function urlWith(query: string): URL {
  return new URL(`https://localhost/session${query}`);
}

describe("devDiagEnabledFromUrl", () => {
  it("is disabled without the devdiag parameter (hidden by default)", () => {
    expect(devDiagEnabledFromUrl(new URL("https://localhost/session"))).toBe(
      false,
    );
    expect(
      devDiagEnabledFromUrl(new URL("https://localhost/session?theme=dark")),
    ).toBe(false);
  });

  it("is enabled with ?devdiag=1", () => {
    expect(devDiagEnabledFromUrl(urlWith("?devdiag=1"))).toBe(true);
  });

  it("is enabled with ?devdiag=true", () => {
    expect(devDiagEnabledFromUrl(urlWith("?devdiag=true"))).toBe(true);
  });

  it("rejects other values (no truthy-string coercion)", () => {
    expect(devDiagEnabledFromUrl(urlWith("?devdiag=0"))).toBe(false);
    expect(devDiagEnabledFromUrl(urlWith("?devdiag=yes"))).toBe(false);
    expect(devDiagEnabledFromUrl(urlWith("?devdiag="))).toBe(false);
  });

  it("coexists with other query parameters", () => {
    expect(devDiagEnabledFromUrl(urlWith("?theme=dark&devdiag=1"))).toBe(true);
    expect(devDiagEnabledFromUrl(urlWith("?devdiag=true&verbose=0"))).toBe(true);
  });

  it("defaults to disabled in non-browser environments when no URL is given", () => {
    expect(typeof window).toBe("undefined");
    expect(devDiagEnabledFromUrl()).toBe(false);
  });
});

// ── Overlay state update logic ─────────────────────────────────────

function makeSnapshot(overrides: Partial<DiagnosticsSnapshot> = {}): DiagnosticsSnapshot {
  return {
    connected: true,
    sessionId: "abc123def456",
    matchPhase: "IN_PROGRESS",
    currentRound: 1,
    predictedPos: { x: 1.5, y: 0, z: -3.2 },
    authoritativePos: { x: 1.48, y: 0, z: -3.18 },
    lastCorrectionDistance: 0.035,
    weaponType: "shotgun",
    buildMode: true,
    inputSequence: 42,
    ...overrides,
  };
}

function makeOverlay(): DeveloperDiagnosticsOverlay {
  // In node/vitest there is no DOM; we only test the state logic.
  // The constructor requires a canvas but we can pass a dummy.
  const dummyCanvas = { parentElement: null } as unknown as HTMLCanvasElement;
  return new DeveloperDiagnosticsOverlay(dummyCanvas, () => makeSnapshot());
}

describe("DeveloperDiagnosticsOverlay.update", () => {
  it("copies all snapshot fields into state", () => {
    const overlay = makeOverlay();
    const snap = makeSnapshot();
    overlay.update(snap);

    expect(overlay.state.connected).toBe(true);
    expect(overlay.state.sessionId).toBe("abc123def456");
    expect(overlay.state.matchPhase).toBe("IN_PROGRESS");
    expect(overlay.state.currentRound).toBe(1);
    expect(overlay.state.predictedX).toBeCloseTo(1.5);
    expect(overlay.state.predictedY).toBe(0);
    expect(overlay.state.predictedZ).toBeCloseTo(-3.2);
    expect(overlay.state.authX).toBeCloseTo(1.48);
    expect(overlay.state.authY).toBe(0);
    expect(overlay.state.authZ).toBeCloseTo(-3.18);
    expect(overlay.state.correctionDistance).toBeCloseTo(0.035);
    expect(overlay.state.weaponType).toBe("shotgun");
    expect(overlay.state.buildMode).toBe(true);
    expect(overlay.state.inputSequence).toBe(42);
  });

  it("sets authoritative position to null when not yet available", () => {
    const overlay = makeOverlay();
    overlay.update(
      makeSnapshot({
        authoritativePos: null,
        lastCorrectionDistance: null,
        connected: false,
        sessionId: null,
      }),
    );

    expect(overlay.state.authX).toBeNull();
    expect(overlay.state.authY).toBeNull();
    expect(overlay.state.authZ).toBeNull();
    expect(overlay.state.correctionDistance).toBeNull();
    expect(overlay.state.connected).toBe(false);
    expect(overlay.state.sessionId).toBeNull();
  });

  it("reflects disconnected state", () => {
    const overlay = makeOverlay();
    overlay.update(
      makeSnapshot({
        connected: false,
        sessionId: null,
        matchPhase: "COUNTDOWN",
        currentRound: 0,
        weaponType: "assault_rifle",
        buildMode: false,
      }),
    );

    expect(overlay.state.connected).toBe(false);
    expect(overlay.state.matchPhase).toBe("COUNTDOWN");
    expect(overlay.state.weaponType).toBe("assault_rifle");
    expect(overlay.state.buildMode).toBe(false);
  });

  it("maps movement smoothness metrics into state when present", () => {
    const overlay = makeOverlay();
    overlay.update(makeSnapshot({ movement: movementReading }));

    expect(overlay.state.mFrameAvg).toBeCloseTo(16.7);
    expect(overlay.state.mFrameMax).toBeCloseTo(33.2);
    expect(overlay.state.mSimHz).toBeCloseTo(30);
    expect(overlay.state.mSnapHz).toBeCloseTo(20);
    expect(overlay.state.mSnapGapMax).toBeCloseTo(52);
    expect(overlay.state.mPending).toBe(2);
    expect(overlay.state.mCorrHz).toBeCloseTo(19.9);
    expect(overlay.state.mCorrMax).toBeCloseTo(0.0035);
  });

  it("leaves movement metrics null when the snapshot has none", () => {
    const overlay = makeOverlay();
    overlay.update(makeSnapshot());

    expect(overlay.state.mFrameAvg).toBeNull();
    expect(overlay.state.mFrameMax).toBeNull();
    expect(overlay.state.mSimHz).toBeNull();
    expect(overlay.state.mSnapHz).toBeNull();
    expect(overlay.state.mSnapGapMax).toBeNull();
    expect(overlay.state.mPending).toBeNull();
    expect(overlay.state.mCorrHz).toBeNull();
    expect(overlay.state.mCorrMax).toBeNull();

    // An explicit null movement is treated the same as absent.
    overlay.update(makeSnapshot({ movement: null }));
    expect(overlay.state.mFrameAvg).toBeNull();
  });
});
