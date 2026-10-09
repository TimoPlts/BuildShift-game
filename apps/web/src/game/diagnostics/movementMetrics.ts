/**
 * MovementSmoothnessMetrics — development-only, off-by-default
 * instrumentation for distinguishing rendering lag from network/movement
 * jitter on the canonical two-player path.
 *
 * The `GameRuntime` feeds this plain event stream:
 *  - `onRenderFrame` once per engine render frame — measures render cadence
 *    (rendering lag shows up as frame time near/above the 33.3 ms sim tick
 *    budget, i.e. the 30 Hz simulation rate);
 *  - `onSimTick` once per local prediction tick — measures prediction cadence;
 *  - `onSnapshot` once per authoritative state-change event — measures
 *    snapshot cadence and arrival jitter (network side);
 *  - `onInputSent` / `onAck` — measures in-flight (sent-but-unacknowledged)
 *    inputs, a direct RTT/cadence indicator;
 *  - `onCorrection` once per reconciliation correction — measures correction
 *    frequency and magnitude (movement side).
 *
 * `read()` returns a display-only snapshot. Nothing in gameplay, networking,
 * or authority decisions consumes these values; they exist solely so a
 * developer (via the `?devdiag=1` overlay) can tell whether apparent
 * movement roughness comes from rendering (frame time), network cadence
 * (snapshot gaps / pending inputs), or correction churn.
 */

/** A display-only reading of the movement smoothness metrics. */
export interface MovementMetricsReading {
  /** Average render frame duration in milliseconds (smoothed). */
  frameMsAvg: number;
  /** Largest render frame duration observed in the current 1 s window (ms). */
  frameMsMax: number;
  /** Measured local prediction tick rate (Hz) over the current window. */
  simTicksPerSec: number;
  /** Measured authoritative snapshot (state-change) rate (Hz). */
  snapshotsPerSec: number;
  /** Largest observed gap between two snapshot events (ms). */
  snapshotGapMaxMs: number;
  /** Inputs sent but not yet acknowledged by the server. */
  pendingInputs: number;
  /** Reconciliation corrections applied over the current window (Hz). */
  correctionsPerSec: number;
  /** Largest correction distance (m) in the current window. */
  correctionMaxMeters: number;
}

/** Options for {@link MovementSmoothnessMetrics}. */
export interface MovementSmoothnessMetricsOptions {
  /** Injectable clock (milliseconds). Defaults to `performance.now()`. */
  readonly clock?: () => number;
}

/** The evaluation window for the per-second rates (ms). */
const WINDOW_MS = 1000;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * A pure, dependency-free (no Colyseus / Babylon imports) tracker of
 * movement-pipeline cadence. All state is local; `reset()` returns it to the
 * pristine "nothing observed yet" condition.
 */
export class MovementSmoothnessMetrics {
  private readonly clock: () => number;

  private frameMsAvg = 0;
  private frameMsMax = 0;

  private windowArmed = false;
  private windowStart = 0;
  private simTicks = 0;
  private snapshots = 0;
  private corrections = 0;
  private snapshotGapMaxMs = 0;
  private correctionMaxMeters = 0;

  private lastSnapshotAt = 0;
  private simTicksPerSec = 0;
  private snapshotsPerSec = 0;
  private correctionsPerSec = 0;

  private lastSentSequence = -1;
  private lastAckSequence = -1;

  constructor(options: MovementSmoothnessMetricsOptions = {}) {
    this.clock = options.clock ?? (() => performance.now());
  }

  /** Record one render frame's duration (ms). */
  public onRenderFrame(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    this.frameMsAvg =
      this.frameMsAvg === 0 ? dtMs : this.frameMsAvg * 0.9 + dtMs * 0.1;
    if (dtMs > this.frameMsMax) {
      this.frameMsMax = dtMs;
    }
    this.tickWindow();
  }

  /** Record one local prediction (simulation) tick. */
  public onSimTick(): void {
    this.simTicks += 1;
  }

  /** Record one authoritative state-change (snapshot) event. */
  public onSnapshot(): void {
    const now = this.clock();
    if (this.lastSnapshotAt > 0) {
      const gap = now - this.lastSnapshotAt;
      if (gap > this.snapshotGapMaxMs) {
        this.snapshotGapMaxMs = gap;
      }
    }
    this.lastSnapshotAt = now;
    this.snapshots += 1;
    this.tickWindow();
  }

  /** Record that an input frame with the given sequence was sent. */
  public onInputSent(sequence: number): void {
    if (sequence > this.lastSentSequence) {
      this.lastSentSequence = sequence;
    }
  }

  /** Record that the server acknowledged up to the given sequence. */
  public onAck(sequence: number): void {
    if (sequence > this.lastAckSequence) {
      this.lastAckSequence = sequence;
    }
  }

  /** Record one reconciliation correction of the given magnitude (m). */
  public onCorrection(distanceMeters: number): void {
    if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return;
    this.corrections += 1;
    if (distanceMeters > this.correctionMaxMeters) {
      this.correctionMaxMeters = distanceMeters;
    }
  }

  /** Reset all metrics (used on reconnect and match reset). */
  public reset(): void {
    this.frameMsAvg = 0;
    this.frameMsMax = 0;
    this.windowArmed = false;
    this.windowStart = 0;
    this.simTicks = 0;
    this.snapshots = 0;
    this.corrections = 0;
    this.snapshotGapMaxMs = 0;
    this.correctionMaxMeters = 0;
    this.lastSnapshotAt = 0;
    this.simTicksPerSec = 0;
    this.snapshotsPerSec = 0;
    this.correctionsPerSec = 0;
    this.lastSentSequence = -1;
    this.lastAckSequence = -1;
  }

  /** The number of sent inputs not yet acknowledged (always >= 0). */
  public get pendingInputs(): number {
    return Math.max(0, this.lastSentSequence - this.lastAckSequence);
  }

  /** A display-only reading of the current metrics. */
  public read(): MovementMetricsReading {
    return {
      frameMsAvg: round1(this.frameMsAvg),
      frameMsMax: round1(this.frameMsMax),
      simTicksPerSec: round1(this.simTicksPerSec),
      snapshotsPerSec: round1(this.snapshotsPerSec),
      snapshotGapMaxMs: round1(this.snapshotGapMaxMs),
      pendingInputs: this.pendingInputs,
      correctionsPerSec: round1(this.correctionsPerSec),
      correctionMaxMeters: round4(this.correctionMaxMeters),
    };
  }

  /** Evaluate a completed 1 s window (called from the event feeders). */
  private tickWindow(): void {
    const now = this.clock();
    if (!this.windowArmed) {
      this.windowArmed = true;
      this.windowStart = now;
      return;
    }
    const elapsed = now - this.windowStart;
    if (elapsed < WINDOW_MS) {
      return;
    }
    const seconds = elapsed / 1000;
    this.simTicksPerSec = this.simTicks / seconds;
    this.snapshotsPerSec = this.snapshots / seconds;
    this.correctionsPerSec = this.corrections / seconds;
    this.simTicks = 0;
    this.snapshots = 0;
    this.corrections = 0;
    this.snapshotGapMaxMs = 0;
    this.correctionMaxMeters = 0;
    this.frameMsMax = 0;
    this.windowStart = now;
  }
}
