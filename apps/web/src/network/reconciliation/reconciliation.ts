import {
  movementInputToWorld,
  stepHorizontalMovement,
  type HorizontalMovementConfig,
} from "@buildshift/simulation";
import { PLAYER_MOVEMENT } from "@buildshift/game-config";
import { InputRingBuffer, type BufferedLocalInput } from "./inputRingBuffer";

export type { BufferedLocalInput } from "./inputRingBuffer";

/**
 * Snapshot-based reconciliation for the LOCAL player prediction pipeline.
 *
 * When an authoritative room-state snapshot for the local player arrives, we
 * roll the predicted state back to the server's authoritative position/velocity
 * at the snapshot's `lastProcessedSequence`, then replay every still-
 * unacknowledged locally-buffered input on top of it using the SAME pure
 * `stepHorizontalMovement` step the server uses — so the client never diverges
 * from the authoritative world state.
 *
 * The whole pipeline is pure and deterministic (no browser, Rapier, WebGL, or
 * network), so it is fully unit-testable in node. The network layer and the game
 * loop are the only external concerns: the loop calls `recordInput` as it
 * captures/sends each input, and `reconcile` whenever a new authoritative
 * snapshot has arrived since the last pass.
 */

/** A plain 3D world position (metres, Y up). Structurally typed — no Babylon. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * The authoritative LOCAL player snapshot a room state patch carries.
 * `lastProcessedSequence` is the highest input sequence the server has
 * authoritatively applied (the "ack"): everything at/below it is confirmed, and
 * everything above it is still predicted locally and must be replayed on top of
 * the authoritative position/velocity.
 */
export interface AuthoritativeSnapshot {
  /** Authoritative position (metres, Y up) at `lastProcessedSequence`. */
  position: Vec3;
  /** Authoritative velocity (m/s) at `lastProcessedSequence`. */
  velocity: Vec3;
  /** Highest input sequence the server has authoritatively processed. */
  lastProcessedSequence: number;
}

/** The client-maintained predicted state that the render loop drives the mesh. */
export interface PredictedPlayerState {
  position: Vec3;
  velocity: Vec3;
}

/**
 * Tuning knobs for a {@link ReconciliationPipeline}. All have sensible defaults
 * (shared config values / 30 Hz tick / 120-input buffer) so a pipeline can be
 * constructed with a bare initial state.
 */
export interface ReconciliationOptions {
  /** Horizontal movement speed (m/s). Defaults to the shared `PLAYER_MOVEMENT`. */
  moveSpeed?: number;
  /** Fixed timestep per input tick (s). Defaults to 1/30 (must match the server). */
  tickSeconds?: number;
  /** Maximum buffered (unacknowledged) inputs before the oldest are dropped. */
  maxBufferedInputs?: number;
}

/**
 * Documented reconciliation defaults.
 *
 * - `tickSeconds` = 1/30 s per input tick (matches the server's 30 Hz cadence).
 * - `maxBufferedInputs` = 120 ≈ 4 s of inputs at 30 Hz — bounds client memory
 *   under a broken/stalled server that never acknowledges (a network-failure
 *   edge case; the oldest inputs are dropped first).
 */
export const RECONCILIATION_DEFAULTS = {
  moveSpeed: PLAYER_MOVEMENT.moveSpeed,
  tickSeconds: 1 / 30,
  maxBufferedInputs: 120,
} as const;

/** Re-exported convenience constants (see {@link RECONCILIATION_DEFAULTS}). */
export const RECONCILIATION_TICK_SECONDS = RECONCILIATION_DEFAULTS.tickSeconds;
export const RECONCILIATION_MAX_BUFFERED_INPUTS =
  RECONCILIATION_DEFAULTS.maxBufferedInputs;

function cloneVec3(v: Readonly<Vec3>): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

/** Why a {@link ReconciliationPipeline.reconcile} call took the path it did. */
export type ReconcileOutcomeReason =
  | "reconciled" // a rollback + replay ran (an advancing snapshot)
  | "ignored-stale"; // snapshot's ack is behind the already-reconciled ack

export interface ReconcileOutcome {
  /** True when a rollback + replay actually ran. */
  reconciled: boolean;
  reason: ReconcileOutcomeReason;
  /** The `lastProcessedSequence` the snapshot carried. */
  lastProcessedSequence: number;
  /** Sequences replayed on top of the authoritative state (only when reconciled). */
  replayedSequences: number[];
  /** The predicted position after this pass (a copy, safe to keep). */
  finalPosition: Vec3;
}

/**
 * The snapshot-based reconciliation pipeline for the local player.
 *
 * Lifecycle, driven by the client game loop:
 *  1. As each local input is captured and sent, call {@link recordInput} to
 *     buffer it (tagged with its assigned sequence).
 *  2. After the local prediction step, if a new authoritative snapshot has
 *     arrived since the last pass, call {@link reconcile} with it.
 *
 * `reconcile` is safe against out-of-order / duplicate / late snapshots: a
 * snapshot whose `lastProcessedSequence` does not advance the recorded ack is
 * ignored (a no-op) — the predicted state is never rolled backwards or corrupted.
 */
export class ReconciliationPipeline {
  private readonly config: HorizontalMovementConfig;
  private readonly tickSeconds: number;
  private readonly inputs: InputRingBuffer;
  private state: PredictedPlayerState;
  /**
   * Backing store for the monotonic ack. Deliberately distinct from the public
   * `lastReconciledSequence` getter (a getter and a field may not share a name).
   */
  private lastReconciled = -1;

  public constructor(
    initialState: Readonly<PredictedPlayerState>,
    options: ReconciliationOptions = {},
  ) {
    const moveSpeed = options.moveSpeed ?? RECONCILIATION_DEFAULTS.moveSpeed;
    const tickSeconds = options.tickSeconds ?? RECONCILIATION_DEFAULTS.tickSeconds;
    const maxBufferedInputs =
      options.maxBufferedInputs ?? RECONCILIATION_DEFAULTS.maxBufferedInputs;

    this.config = { moveSpeed };
    this.tickSeconds = tickSeconds;
    this.inputs = new InputRingBuffer(maxBufferedInputs);
    this.state = {
      position: cloneVec3(initialState.position),
      velocity: cloneVec3(initialState.velocity),
    };
  }

  /** The highest `lastProcessedSequence` reconciled so far (starts at -1). */
  public get lastReconciledSequence(): number {
    return this.lastReconciled;
  }

  /** The number of buffered, still-unacknowledged local inputs. */
  public get bufferedInputCount(): number {
    return this.inputs.size;
  }

  /** A read-only copy of the current predicted state. */
  public getState(): PredictedPlayerState {
    return {
      position: cloneVec3(this.state.position),
      velocity: cloneVec3(this.state.velocity),
    };
  }

  /**
   * Buffers a freshly-captured local input. Called by the game loop once per
   * input tick, using the sequence the network layer assigned when sending. If
   * the buffer overflows (server not acknowledging) the oldest input is dropped.
   */
  public recordInput(input: BufferedLocalInput): void {
    this.inputs.push({
      sequence: input.sequence,
      moveX: input.moveX,
      moveZ: input.moveZ,
      lookYaw: input.lookYaw,
    });
  }

  /**
   * Runs the reconciliation pass for one authoritative local snapshot.
   *
   * When the snapshot's `lastProcessedSequence` advances the recorded ack:
   *   1. roll the predicted state back to the snapshot's position/velocity;
   *   2. replay every buffered input with sequence > `lastProcessedSequence`,
   *      in ascending order, one fixed `tickSeconds` `stepHorizontalMovement`
   *      step each (local→world via `movementInputToWorld`);
   *   3. prune the buffer of acknowledged inputs (sequence <= ack);
   *   4. the resulting position becomes the new predicted state.
   *
   * When the snapshot is stale (`lastProcessedSequence <= lastReconciledSequence`)
   * the pass is a no-op — the predicted state is left untouched.
   */
  public reconcile(snapshot: AuthoritativeSnapshot): ReconcileOutcome {
    const ack = snapshot.lastProcessedSequence;

    // Late / duplicate / out-of-order: never roll backwards. The predicted state
    // is left exactly as-is so a stale snapshot can't corrupt it.
    if (ack <= this.lastReconciled) {
      return {
        reconciled: false,
        reason: "ignored-stale",
        lastProcessedSequence: ack,
        replayedSequences: [],
        finalPosition: cloneVec3(this.state.position),
      };
    }

    // (2) Roll back to the authoritative position/velocity at the ack point.
    this.state = {
      position: cloneVec3(snapshot.position),
      velocity: cloneVec3(snapshot.velocity),
    };

    // (3) Replay every still-unacknowledged input (sequence > ack), in order.
    const replayed: number[] = [];
    for (const input of this.inputs.entries()) {
      if (input.sequence <= ack) {
        continue; // acknowledged — already confirmed by the snapshot
      }
      const worldInput = movementInputToWorld(
        { x: input.moveX, z: input.moveZ },
        input.lookYaw,
      );
      const stepped = stepHorizontalMovement(
        { x: this.state.position.x, z: this.state.position.z },
        worldInput,
        this.tickSeconds,
        this.config,
      );
      this.state.position = {
        x: stepped.x,
        y: this.state.position.y,
        z: stepped.z,
      };
      replayed.push(input.sequence);
    }

    // Prune confirmed inputs so they are never replayed again.
    this.inputs.pruneUpTo(ack);
    this.lastReconciled = ack;

    return {
      reconciled: true,
      reason: "reconciled",
      lastProcessedSequence: ack,
      replayedSequences: replayed,
      finalPosition: cloneVec3(this.state.position),
    };
  }

  /**
   * Resets the pipeline to a fresh predicted state (e.g. on (re)join). The input
   * buffer is cleared and the recorded ack resets to -1.
   */
  public reset(initialState: Readonly<PredictedPlayerState>): void {
    this.state = {
      position: cloneVec3(initialState.position),
      velocity: cloneVec3(initialState.velocity),
    };
    this.inputs.clear();
    this.lastReconciled = -1;
  }
}
