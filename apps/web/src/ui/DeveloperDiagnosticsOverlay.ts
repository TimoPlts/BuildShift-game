/**
 * DeveloperDiagnosticsOverlay — a DOM-based, OFF-by-default developer overlay
 * that displays live runtime diagnostics for the BuildShift game.
 *
 * Shown when the URL contains `?devdiag=1` or `?devdiag=true`.
 *
 * Displays:
 *  - Connection / session / room status
 *  - Match phase and round
 *  - Predicted local position
 *  - Authoritative local position
 *  - Last reconciliation correction distance
 *  - Current weapon
 *  - Build mode active
 *  - Input sequence
 *  - FPS (measured from the overlay's own RAF loop)
 *  - Movement smoothness metrics (dev-only instrumentation: render
 *    frame time vs simulation tick cadence vs snapshot cadence / pending
 *    inputs vs correction rate — see movementMetrics.ts)
 *
 * The overlay is purely presentational: it reads a snapshot from a
 * provider callback each frame and renders text. It never drives game
 * logic, adds network messages, or mutates any game state.
 */

import type { DiagnosticsSnapshot } from "../game/diagnostics";

/**
 * Resolve whether the developer diagnostics overlay was explicitly requested
 * through a URL query parameter (`?devdiag=1` or `?devdiag=true`).
 */
export function devDiagEnabledFromUrl(url?: URL): boolean {
  const target =
    url ??
    (typeof window !== "undefined"
      ? new URL(window.location.href)
      : new URL("about:blank"));
  const value = target.searchParams.get("devdiag");
  return value === "1" || value === "true";
}

/**
 * The mutable state the overlay renders each frame.
 * Updated externally via {@link DeveloperDiagnosticsOverlay.update}.
 */
export interface DeveloperDiagnosticsState {
  connected: boolean;
  sessionId: string | null;
  matchPhase: string;
  currentRound: number;
  predictedX: number;
  predictedY: number;
  predictedZ: number;
  authX: number | null;
  authY: number | null;
  authZ: number | null;
  correctionDistance: number | null;
  weaponType: string;
  buildMode: boolean;
  inputSequence: number;
  fps: number;
  /** Movement smoothness metrics (null when the snapshot has none). */
  mFrameAvg: number | null;
  mFrameMax: number | null;
  mSimHz: number | null;
  mSnapHz: number | null;
  mSnapGapMax: number | null;
  mPending: number | null;
  mCorrHz: number | null;
  mCorrMax: number | null;
}

/**
 * A DOM-based developer diagnostics overlay.
 *
 * Usage:
 * ```ts
 * const overlay = new DeveloperDiagnosticsOverlay(canvas, () => runtime.getDiagnosticsSnapshot());
 * const cleanup = overlay.attach();
 * // ... runtime updates ...
 * cleanup();
 * overlay.dispose();
 * ```
 */
export class DeveloperDiagnosticsOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly snapshotProvider: () => DiagnosticsSnapshot;
  private disposed = false;

  /** The rendered state (read-only for tests). */
  public state: DeveloperDiagnosticsState = {
    connected: false,
    sessionId: null,
    matchPhase: "IDLE",
    currentRound: 0,
    predictedX: 0,
    predictedY: 0,
    predictedZ: 0,
    authX: null,
    authY: null,
    authZ: null,
    correctionDistance: null,
    weaponType: "assault_rifle",
    buildMode: false,
    inputSequence: 0,
    fps: 0,
    mFrameAvg: null,
    mFrameMax: null,
    mSimHz: null,
    mSnapHz: null,
    mSnapGapMax: null,
    mPending: null,
    mCorrHz: null,
    mCorrMax: null,
  };

  private rafId = 0;
  private lastFrameTime = 0;
  private fpsAccum = 0;
  private fpsFrameCount = 0;
  private fpsSmoothed = 0;

  public constructor(
    parentCanvas: HTMLCanvasElement,
    snapshotProvider: () => DiagnosticsSnapshot,
  ) {
    this.canvas = parentCanvas;
    this.snapshotProvider = snapshotProvider;
  }

  /**
   * Attach the overlay DOM element and start the render loop.
   * Returns a cleanup function that detaches the DOM and cancels RAF.
   */
  public attach(): () => void {
    const overlay = document.createElement("div");
    overlay.className = "devdiag-overlay";
    overlay.setAttribute("aria-hidden", "true");

    const parent = this.canvas.parentElement;
    if (parent) {
      parent.appendChild(overlay);
    }

    this.lastFrameTime = performance.now();
    const tick = (now: number): void => {
      if (this.disposed) return;
      this.tickFps(now);
      this.refresh(overlay);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);

    let cleaned = false;
    return () => {
      if (cleaned) return;
      cleaned = true;
      cancelAnimationFrame(this.rafId);
      overlay.remove();
    };
  }

  /**
   * Manually update the state from a snapshot (used by tests and
   * as an alternative to the RAF-driven refresh).
   */
  public update(snapshot: DiagnosticsSnapshot): void {
    this.state.connected = snapshot.connected;
    this.state.sessionId = snapshot.sessionId;
    this.state.matchPhase = snapshot.matchPhase;
    this.state.currentRound = snapshot.currentRound;
    this.state.predictedX = snapshot.predictedPos.x;
    this.state.predictedY = snapshot.predictedPos.y;
    this.state.predictedZ = snapshot.predictedPos.z;
    if (snapshot.authoritativePos) {
      this.state.authX = snapshot.authoritativePos.x;
      this.state.authY = snapshot.authoritativePos.y;
      this.state.authZ = snapshot.authoritativePos.z;
    } else {
      this.state.authX = null;
      this.state.authY = null;
      this.state.authZ = null;
    }
    this.state.correctionDistance = snapshot.lastCorrectionDistance;
    this.state.weaponType = snapshot.weaponType;
    this.state.buildMode = snapshot.buildMode;
    this.state.inputSequence = snapshot.inputSequence;
    const m = snapshot.movement ?? null;
    this.state.mFrameAvg = m ? m.frameMsAvg : null;
    this.state.mFrameMax = m ? m.frameMsMax : null;
    this.state.mSimHz = m ? m.simTicksPerSec : null;
    this.state.mSnapHz = m ? m.snapshotsPerSec : null;
    this.state.mSnapGapMax = m ? m.snapshotGapMaxMs : null;
    this.state.mPending = m ? m.pendingInputs : null;
    this.state.mCorrHz = m ? m.correctionsPerSec : null;
    this.state.mCorrMax = m ? m.correctionMaxMeters : null;
  }

  public dispose(): void {
    this.disposed = true;
  }

  // ── internals ─────────────────────────────────────────────────────────

  private tickFps(now: number): void {
    const dt = now - this.lastFrameTime;
    this.lastFrameTime = now;
    if (dt > 0 && dt < 500) {
      this.fpsAccum += dt;
      this.fpsFrameCount++;
      if (this.fpsAccum >= 500) {
        this.fpsSmoothed = Math.round(1000 / (this.fpsAccum / this.fpsFrameCount));
        this.fpsAccum = 0;
        this.fpsFrameCount = 0;
      }
    }
    this.state.fps = this.fpsSmoothed;
  }

  private refresh(overlay: HTMLDivElement): void {
    try {
      const snap = this.snapshotProvider();
      this.update(snap);
    } catch {
      // Ignore errors from the snapshot provider (e.g. runtime disposed).
      return;
    }
    this.renderOverlay(overlay);
  }

  private renderOverlay(overlay: HTMLDivElement): void {
    const s = this.state;
    const lines: string[] = [];
    lines.push("[BuildShift DevDiag]");

    // Connection / session
    lines.push(`Conn:  ${s.connected ? "connected" : "disconnected"}`);
    if (s.sessionId) {
      lines.push(`Sess:  ${s.sessionId.slice(0, 8)}…`);
    } else {
      lines.push(`Sess:  —`);
    }
    lines.push(`Phase: ${s.matchPhase}  R${s.currentRound}`);

    // Positions
    lines.push("");
    lines.push(
      `Pred:  (${s.predictedX.toFixed(2)}, ${s.predictedY.toFixed(2)}, ${s.predictedZ.toFixed(2)})`,
    );
    if (s.authX !== null && s.authY !== null && s.authZ !== null) {
      lines.push(
        `Auth:  (${s.authX.toFixed(2)}, ${s.authY.toFixed(2)}, ${s.authZ.toFixed(2)})`,
      );
    } else {
      lines.push("Auth:  (not yet)");
    }
    if (s.correctionDistance !== null) {
      lines.push(`Corr:  ${s.correctionDistance.toFixed(4)} m`);
    }

    // Gameplay state
    lines.push("");
    lines.push(`Wpn:   ${s.weaponType}  Build:${s.buildMode ? "on" : "off"}`);
    lines.push(`Seq:   ${s.inputSequence}`);

    // Performance
    lines.push("");
    lines.push(`FPS:   ${s.fps > 0 ? s.fps : "…"}`);

    // Movement smoothness (dev-only instrumentation)
    if (s.mFrameAvg !== null && s.mSimHz !== null && s.mSnapHz !== null && s.mSnapGapMax !== null && s.mPending !== null && s.mCorrHz !== null && s.mCorrMax !== null) {
      lines.push("");
      lines.push(`Mov:   frame ${s.mFrameAvg.toFixed(1)}ms (max ${s.mFrameMax!.toFixed(1)})  sim ${s.mSimHz.toFixed(1)}Hz`);
      lines.push(`Net:   snap ${s.mSnapHz.toFixed(1)}Hz (gap ${s.mSnapGapMax.toFixed(0)}ms)  pend ${s.mPending}`);
      lines.push(`CorrHz:${s.mCorrHz.toFixed(1)}Hz (max ${s.mCorrMax.toFixed(4)}m)`);
    }

    overlay.textContent = lines.join("\n");
  }
}
