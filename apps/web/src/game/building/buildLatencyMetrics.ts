/**
 * buildLatencyMetrics — lightweight, pure latency measurement for the
 * server-authoritative building and edit systems.
 *
 * Tracks three latency phases for each subsystem:
 *
 *  1. **input-to-feedback** — from user input to local optimistic feedback
 *     (always ~0 ms in the current architecture: the optimistic state is
 *     set synchronously on the input path). Measured as a sanity check.
 *  2. **request-to-accept** — from the intent being sent to the authoritative
 *     server to the server's confirmation (accept or reject) arriving.
 *     This is the network round-trip time.
 *  3. **accept-to-replicated-mesh** — from the server's confirmation to the
 *     state being visible in the client's mirror / preview on the next frame.
 *     In the current architecture this is ≤ 1 render frame because the event
 *     handler updates the mirror synchronously and the next frame reads it.
 *
 * The metrics are *presentation diagnostics only*: they never feed back into
 * gameplay, networking, or authority. They are exposed via the developer
 * diagnostics overlay so an operator can see whether normal latency is in
 * the expected range or whether the network / render loop is degraded.
 *
 * No Babylon, no network, no side effects — pure timestamp arithmetic with
 * an injectable clock for deterministic tests.
 */

// ─── Public types ────────────────────────────────────────────────────────────

/** One completed latency measurement (all fields in milliseconds). */
export interface BuildLatencySample {
  /**
   * Time from user input to local optimistic feedback (ms).
   * Always 0 in the current synchronous architecture; non-zero only if
   * a future refactoring introduces async input handling.
   */
  inputToFeedbackMs: number;
  /**
   * Time from the intent being sent to the server's authoritative
   * confirmation (accept or reject) arriving (ms).
   */
  requestToAcceptMs: number;
  /**
   * Time from the server's confirmation to the state being visible in
   * the client's mirror / preview on the next frame (ms).
   */
  acceptToReplicatedMeshMs: number;
}

/**
 * A flat, read-only reading of the last completed latency samples for both
 * the placement and edit subsystems.
 */
export interface BuildLatencyReading {
  /** The last completed placement latency sample, or `null` before the first. */
  placement: BuildLatencySample | null;
  /** The last completed edit latency sample, or `null` before the first. */
  edit: BuildLatencySample | null;
}

/**
 * Internal state for one in-flight placement intent.
 */
interface PlacementTracking {
  /** Monotonic timestamp (ms) when the intent was sent. */
  sentAt: number;
  /** Set when the server's confirmation (accept) arrives. */
  acceptedAt?: number;
}

/**
 * Internal state for one in-flight edit action (per structure).
 */
interface EditTracking {
  /** Monotonic timestamp (ms) when the action was sent. */
  sentAt: number;
  /** Set when the server's result broadcast arrives. */
  resultAt?: number;
}

// ─── BuildLatencyMetrics ─────────────────────────────────────────────────────

/**
 * Tracks the three latency phases for building placement and build-edit
 * actions. All methods are safe to call from the render loop; no
 * allocation is performed on the hot path beyond the initial tracking
 * maps.
 *
 * @example
 * ```ts
 * const metrics = new BuildLatencyMetrics();
 * // In BuildingController.requestPlace():
 * metrics.recordPlacementSent(sequence);
 * // In BuildingController.handleStructurePlaced():
 * metrics.recordPlacementAccepted(sequence);
 * // On the next frame, when the structure is in the mirror:
 * metrics.resolvePlacementMesh(sequence);
 * // Read for diagnostics:
 * const reading = metrics.read();
 * ```
 */
export class BuildLatencyMetrics {
  private readonly now: () => number;

  /** In-flight placement intents, keyed by intent `sequence`. */
  private readonly placements = new Map<number, PlacementTracking>();
  /** In-flight edit actions, keyed by `structureId` (one per structure). */
  private readonly edits = new Map<string, EditTracking>();

  /** The last completed placement latency sample. */
  private lastPlacement: BuildLatencySample | null = null;
  /** The last completed edit latency sample. */
  private lastEdit: BuildLatencySample | null = null;

  /**
   * @param now injectable monotonic clock (ms). Defaults to
   *        `performance.now()`.
   */
  public constructor(now?: () => number) {
    this.now = now ?? (() => performance.now());
  }

  // ── Placement (building) ─────────────────────────────────────────────────

  /**
   * Records that a placement intent was sent (the user's input has been
   * converted to a network message). The optimistic pending state was set
   * synchronously at this point, so `inputToFeedbackMs` is 0.
   */
  public recordPlacementSent(sequence: number): void {
    this.placements.set(sequence, { sentAt: this.now() });
  }

  /**
   * Records that the server accepted a placement (the `structure_placed`
   * event arrived). Computes `requestToAcceptMs`.
   * The `acceptToReplicatedMeshMs` is deferred until
   * {@link resolvePlacementMesh} is called on a subsequent frame.
   */
  public recordPlacementAccepted(sequence: number): void {
    const entry = this.placements.get(sequence);
    if (entry === undefined) {
      return;
    }
    entry.acceptedAt = this.now();
  }

  /**
   * Records that the placement was rejected (the `structure_rejected` event
   * arrived). Computes `requestToAcceptMs` for the rejection round-trip.
   * The tracking entry is dropped (no mesh to resolve).
   */
  public recordPlacementRejected(sequence: number): void {
    const entry = this.placements.get(sequence);
    if (entry === undefined) {
      return;
    }
    const rejectAt = this.now();
    this.lastPlacement = {
      inputToFeedbackMs: 0,
      requestToAcceptMs: rejectAt - entry.sentAt,
      acceptToReplicatedMeshMs: 0,
    };
    this.placements.delete(sequence);
  }

  /**
   * Resolves the `acceptToReplicatedMeshMs` for a placement: called on the
   * first frame after the structure appears in the authoritative mirror
   * (i.e. the mesh / preview can now show it). Drops the tracking entry.
   */
  public resolvePlacementMesh(sequence: number): void {
    const entry = this.placements.get(sequence);
    if (entry === undefined || entry.acceptedAt === undefined) {
      // No accepted entry to resolve (rejected, or unknown sequence).
      this.placements.delete(sequence);
      return;
    }
    const meshAt = this.now();
    this.lastPlacement = {
      inputToFeedbackMs: 0,
      requestToAcceptMs: entry.acceptedAt - entry.sentAt,
      acceptToReplicatedMeshMs: meshAt - entry.acceptedAt,
    };
    this.placements.delete(sequence);
  }

  // ── Edit (build-edit) ────────────────────────────────────────────────────

  /**
   * Records that an edit action was sent (tile toggle / terminal). The
   * optimistic state was set synchronously, so `inputToFeedbackMs` is 0.
   *
   * For multiple in-flight actions on the same structure, this overwrites
   * the previous tracking entry — the measurement reflects the *latest*
   * action's round-trip, which is the one the player is waiting on.
   */
  public recordEditSent(structureId: string): void {
    this.edits.set(structureId, { sentAt: this.now() });
  }

  /**
   * Records that the server's result broadcast arrived for a structure's
   * edit action. Computes `requestToAcceptMs`.
   * The `acceptToReplicatedMeshMs` is deferred until
   * {@link resolveEditMesh} is called on a subsequent frame.
   */
  public recordEditResult(structureId: string, success: boolean): void {
    const entry = this.edits.get(structureId);
    if (entry === undefined) {
      return;
    }
    const resultAt = this.now();
    entry.resultAt = resultAt;

    if (!success) {
      // Rejection: no mesh to resolve; the rollback is the feedback.
      this.lastEdit = {
        inputToFeedbackMs: 0,
        requestToAcceptMs: resultAt - entry.sentAt,
        acceptToReplicatedMeshMs: 0,
      };
      this.edits.delete(structureId);
    }
    // On success, defer to resolveEditMesh (the mesh appears on the next frame).
  }

  /**
   * Resolves the `acceptToReplicatedMeshMs` for an edit: called on the
   * first frame after the result is consumed and the preview shows the
   * authoritative state. Drops the tracking entry.
   */
  public resolveEditMesh(structureId: string): void {
    const entry = this.edits.get(structureId);
    if (entry === undefined || entry.resultAt === undefined) {
      this.edits.delete(structureId);
      return;
    }
    const meshAt = this.now();
    this.lastEdit = {
      inputToFeedbackMs: 0,
      requestToAcceptMs: entry.resultAt - entry.sentAt,
      acceptToReplicatedMeshMs: meshAt - entry.resultAt,
    };
    this.edits.delete(structureId);
  }

  // ── Reading / lifecycle ──────────────────────────────────────────────────

  /**
   * Returns a flat reading of the last completed latency samples.
   * Both fields are `null` before the first completed measurement.
   * The returned objects are copies — mutating them does not affect
   * the metrics' internal state.
   */
  public read(): BuildLatencyReading {
    return {
      placement:
        this.lastPlacement !== null
          ? { ...this.lastPlacement }
          : null,
      edit:
        this.lastEdit !== null ? { ...this.lastEdit } : null,
    };
  }

  /**
   * Resets all tracking and the last samples. Called on round reset /
   * reconnect so stale in-flight entries never persist.
   */
  public reset(): void {
    this.placements.clear();
    this.edits.clear();
    this.lastPlacement = null;
    this.lastEdit = null;
  }

  /**
   * Drops all in-flight tracking without clearing the last samples.
   * Called on disconnect so a stale intent cannot be misattributed after
   * a reconnect (the last samples remain for diagnostics).
   */
  public clearInFlight(): void {
    this.placements.clear();
    this.edits.clear();
  }
}
