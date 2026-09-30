import type { InputSample, SubstepInput } from "./inputBatcher";
import type { PredictionHistory } from "./predictionHistory";
import type { PredictionState, Vec3 } from "./predictionState";

/**
 * The authoritative LOCAL player snapshot the reconciliation engine consumes.
 *
 * This mirrors the shared {@link AuthoritativePlayerState} contract
 * (position + yaw + acknowledgedSequence) but as plain client data — the
 * runtime derives it from `NetworkUiState.players[sessionId]`. Only the LOCAL
 * player is ever reconciled; remote players are out of scope for this stage.
 */
export interface AuthoritativeLocalSnapshot {
  /** Authoritative capsule-centre position (metres, Y up). */
  position: Vec3;
  /** Authoritative facing yaw (radians). */
  yaw: number;
  /**
   * Highest input sequence the server has authoritatively processed.
   * `-1` = none processed yet (before the first input round-trip).
   */
  acknowledgedSequence: number;
}

/**
 * Documented client-side correction epsilon (metres).
 *
 * If the server's authoritative position is within this distance of the local
 * predicted position at the acknowledged sequence, the server is treated as
 * "confirming" the prediction: the confirmed history is pruned and NO
 * rollback/replay occurs. This avoids meaningless floating-point
 * micro-corrections (the client and server use identical deterministic math,
 * so a healthy round-trip differs only by float noise, well under a tenth of a
 * metre). A real divergence (desync, server-side correction) exceeds this and
 * triggers a full rollback + replay.
 */
export const CORRECTION_EPSILON_METERS = 0.05;

/**
 * The injected, environment-facing seam the {@link ReconciliationEngine}
 * drives. In the real runtime these are wired to `PlayerController`
 * (capture / restore / set position) and the prediction simulator (substep).
 * In tests they are fakes — which is what makes the whole rollback/replay
 * algorithm unit-testable without a browser, WebGL, or Rapier.
 */
export interface ReconciliationEngineDeps {
  /** The shared ordered history of completed predictions. */
  readonly history: PredictionHistory;
  /** Capture the current deterministic local prediction state. */
  capturePredictionState(): PredictionState;
  /** Restore a previously captured prediction state exactly. */
  restorePredictionState(state: PredictionState): void;
  /**
   * Override the capsule-centre position with the authoritative server
   * position and set the facing yaw at the corrected acknowledged point.
   * Must leave the mesh and physics body in agreement.
   */
  setAuthoritativePosition(position: Vec3, yaw: number): void;
  /** Simulate one 1/60 substep from explicit input (drives the local player). */
  simulateSubstep(input: SubstepInput): void;
}

/** Which reconciliation path a given snapshot took. */
export type ReconcileAction =
  | "ignored" // ack < 0, or a duplicate / older (non-advancing) ack
  | "accepted" // matched checkpoint within epsilon: confirmed, pruned, no rollback
  | "no-checkpoint" // new ack with no stored entry (input-clear gap): pruned, no rollback
  | "corrected"; // matched checkpoint outside epsilon: restored + replayed

export interface ReconcileResult {
  action: ReconcileAction;
  /** The acknowledged sequence the snapshot carried. */
  acknowledgedSequence: number;
  /** The engine's recorded ack after this call (monotonic). */
  lastReconciledAck: number;
  /** Number of history entries pruned (confirmed, sequence <= ack). */
  pruned: number;
  /** Sequences that were replayed (only for the "corrected" action). */
  replayedSequences: number[];
  /** Predicted-vs-authoritative distance in metres, when a checkpoint matched. */
  correctionDistance: number | null;
  /** Non-null when the engine failed safely mid-correction (never throws). */
  error: string | null;
}

/** The explicit first-substep slice of a sample: the jump EDGE applies here. */
function firstSubstep(sample: InputSample): SubstepInput {
  return {
    moveX: sample.moveX,
    moveZ: sample.moveZ,
    lookYaw: sample.lookYaw,
    jumpPressed: sample.jump,
  };
}

/** The explicit second-substep slice of a sample: jump edge forced false. */
function secondSubstep(sample: InputSample): SubstepInput {
  return {
    moveX: sample.moveX,
    moveZ: sample.moveZ,
    lookYaw: sample.lookYaw,
    jumpPressed: false,
  };
}

function positionDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Pure, deterministic client-prediction reconciliation.
 *
 * Given an authoritative local snapshot (position + yaw + ack), this decides
 * whether the local prediction is confirmed or must be corrected, and performs
 * the rollback + replay when it must:
 *
 *   1. ack < 0                      -> ignored (nothing processed yet)
 *   2. ack <= lastReconciledAck     -> ignored (duplicate / stale; never rewind)
 *   3. advance lastReconciledAck    (done BEFORE any rollback so a failure
 *                                    cannot cause a backwards / repeated ack)
 *   4. prune confirmed history <= ack
 *   5. no stored entry for ack      -> no-checkpoint (input-clear gap):
 *                                       confirmed, advance, wait for a later
 *                                       matching ack; NO fabricated rollback
 *   6. within epsilon               -> accepted: confirmed, no rollback/replay
 *   7. outside epsilon              -> corrected:
 *        a. restore the stored deterministic checkpoint for ack
 *        b. override capsule-centre position + yaw with the authoritative values
 *        c. replay every still-unacknowledged sample (sequence > ack) in order,
 *           each as exactly two 1/60 substeps (jump edge on substep A only)
 *        d. after each replayed sample, recapture + replace its stored
 *           checkpoint so future acks compare against the replayed prediction
 *
 * The engine never sends any network message (replay is local-only), and it
 * never throws: a rollback failure is recorded in `ReconcileResult.error` and
 * the engine simply continues predicting from the last good state.
 *
 * Authority limitation: only `position` and `yaw` are server-authoritative on
 * the wire. `verticalVelocity`, `lastGrounded`, and the `JumpController` timers
 * are restored from the client's stored checkpoint (valid because client and
 * server share the same deterministic rules — see `predictionState.ts` and
 * docs/TECHNICAL_ARCHITECTURE.md §18).
 */
export class ReconciliationEngine {
  /** Backing store for the monotonic ack; distinct from the getter. */
  private highestAck = -1;

  public constructor(private readonly deps: ReconciliationEngineDeps) {}

  /** The highest ack this engine has recorded (monotonic, starts at -1). */
  public get lastReconciledAck(): number {
    return this.highestAck;
  }

  /**
   * Reconciles one authoritative local snapshot. Safe to call with stale /
   * duplicate / out-of-order snapshots — those are ignored, never rewound.
   */
  public reconcile(snapshot: AuthoritativeLocalSnapshot): ReconcileResult {
    const ack = snapshot.acknowledgedSequence;

    if (ack < 0) {
      return this.result("ignored", ack, this.highestAck, 0, [], null);
    }

    // Never process acknowledgements backwards. A duplicate or older ack is a
    // no-op; the ack progress is monotonic.
    if (ack <= this.highestAck) {
      return this.result("ignored", ack, this.highestAck, 0, [], null);
    }

    // Advance BEFORE any rollback so a failure can never cause a backwards or
    // repeated acknowledgement (fail-safe against a correction loop).
    this.highestAck = ack;

    // Look up the checkpoint for this ack BEFORE pruning it (prune removes
    // entries <= ack, so the ack's own entry would otherwise be gone).
    const entry = this.deps.history.get(ack);
    const pruned = this.deps.history.pruneUpTo(ack);

    // Sequence gap (e.g. an input-clear neutral frame) or an evicted checkpoint:
    // confirmed + advanced, but no stored checkpoint to roll back against. Do
    // NOT fabricate one — wait for a later ack that maps to a stored completed
    // prediction.
    if (entry === null) {
      return this.result("no-checkpoint", ack, this.highestAck, pruned, [], null);
    }

    const distance = positionDistance(entry.state.position, snapshot.position);
    if (distance <= CORRECTION_EPSILON_METERS) {
      // Confirmed within epsilon: history was pruned above; no rollback/replay.
      return this.result("accepted", ack, this.highestAck, pruned, [], distance);
    }

    // --- Correction: restore checkpoint at ack, override with authority, ---
    // --- then replay every still-unacknowledged sample in sequence order.  ---
    const pending = this.deps.history.after(ack); // strictly > ack
    const replayed: number[] = [];
    try {
      this.deps.restorePredictionState(entry.state);
      this.deps.setAuthoritativePosition(snapshot.position, snapshot.yaw);

      for (const sampleEntry of pending) {
        const sample = sampleEntry.sample;
        // Exactly the two-substep semantics of a normal batch. Substep A keeps
        // the captured jump edge; substep B forces it false so a replayed jump
        // can never fire twice.
        this.deps.simulateSubstep(firstSubstep(sample));
        this.deps.simulateSubstep(secondSubstep(sample));
        replayed.push(sampleEntry.sequence);

        // Recapture the NEW predicted checkpoint for this sample so any future
        // acknowledgement compares against the replayed prediction, not the
        // stale pre-correction checkpoint.
        const newCheckpoint = this.deps.capturePredictionState();
        this.deps.history.replaceState(sampleEntry.sequence, newCheckpoint);
      }
    } catch (error) {
      // Fail safely: record the failure and continue predicting. highestAck
      // has already advanced, so this ack will not be re-processed.
      const message = error instanceof Error ? error.message : String(error);
      return this.result("corrected", ack, this.highestAck, pruned, replayed, distance, message);
    }

    return this.result("corrected", ack, this.highestAck, pruned, replayed, distance);
  }

  private result(
    action: ReconcileAction,
    acknowledgedSequence: number,
    lastReconciledAck: number,
    pruned: number,
    replayedSequences: number[],
    correctionDistance: number | null,
    error: string | null = null,
  ): ReconcileResult {
    return {
      action,
      acknowledgedSequence,
      lastReconciledAck,
      pruned,
      replayedSequences,
      correctionDistance,
      error,
    };
  }
}
