/**
 * LocalPlayerPredictor — client-side prediction and reconciliation for the
 * local player.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §18, the client predicts locally using
 * the SAME deterministic `stepFullMovement` the server uses, then reconciles
 * when the authoritative server state arrives:
 *
 *  1. Each frame, start from the last known authoritative base state and
 *     replay ALL unacknowledged local inputs through `stepFullMovement`.
 *     The result is the predicted position to render this frame.
 *
 *  2. When a server state patch arrives, compare the server position to the
 *     current prediction. If the difference exceeds a small epsilon
 *     (0.01 m), hard-snap the visual position to the server value
 *     (reconciliation). The server state becomes the new base state for
 *     future predictions, and all inputs up to `lastInputSequence` are
 *     considered acknowledged.
 *
 * The predictor is NEVER authoritative: it only interpolates between the
 * last server truth and the local input intent. The server remains the sole
 * authority on position, velocity, and grounded state.
 */
import {
  stepFullMovement,
  movementInputToWorld,
  type FullMovementState,
  type HorizontalMovementConfig,
  type VerticalMovementConfig,
  type WorldMovementInput,
  type VerticalInput,
} from "@buildshift/simulation";
import type { MovementInput } from "@buildshift/protocol";

/**
 * Epsilon (metres) for reconciliation position comparison. If the server
 * position differs from the predicted position by more than this on ANY axis,
 * a hard snap is applied. 0.01 m (1 cm) is well below visual perception at
 * typical camera distances.
 */
export const RECONCILE_EPSILON = 0.01;

/**
 * Options for constructing a {@link LocalPlayerPredictor}.
 */
export interface LocalPlayerPredictorOptions {
  /** The fixed simulation timestep (seconds) per input. */
  deltaSeconds: number;
  /** Horizontal movement config (moveSpeed). */
  horizontalConfig: Readonly<HorizontalMovementConfig>;
  /** Vertical movement config (gravity, jump, etc.). */
  verticalConfig: Readonly<VerticalMovementConfig>;
}

/**
 * The initial (spawn) state used before the first server state arrives.
 */
const INITIAL_STATE: FullMovementState = {
  x: 0,
  y: 0.9, // PLAYER_SPAWN.y (capsule centre)
  z: 6, // PLAYER_SPAWN.z
  yaw: 0,
  velocityY: 0,
  grounded: true,
};

/**
 * Client-side prediction engine for the local player.
 *
 * Usage:
 * ```ts
 * const predictor = new LocalPlayerPredictor({
 *   deltaSeconds: 1/60,
 *   horizontalConfig: PLAYER_MOVEMENT,
 *   verticalConfig: VERTICAL_MOVEMENT,
 * });
 *
 * // Each frame:
 * const predicted = predictor.predict(pendingInputs);
 * // Use `predicted` to position the local player mesh.
 *
 * // On server state patch:
 * predictor.onServerState(serverState);
 * ```
 */
export class LocalPlayerPredictor {
  private readonly deltaSeconds: number;
  private readonly horizontalConfig: Readonly<HorizontalMovementConfig>;
  private readonly verticalConfig: Readonly<VerticalMovementConfig>;

  /**
   * The last authoritative (server) state. All predictions start from here
   * and replay unacknowledged inputs forward.
   */
  private _baseState: FullMovementState = { ...INITIAL_STATE };

  /**
   * The highest input sequence the server has acknowledged. Inputs with
   * sequence <= this value are NOT re-applied during prediction.
   */
  private _lastAckSequence = -1;

  /**
   * The last predicted state (result of the most recent `predict()` call).
   * Used for reconciliation comparison when a server patch arrives.
   */
  private _lastPredicted: FullMovementState | null = null;

  public constructor(options: LocalPlayerPredictorOptions) {
    this.deltaSeconds = options.deltaSeconds;
    this.horizontalConfig = options.horizontalConfig;
    this.verticalConfig = options.verticalConfig;
  }

  /**
   * The current base (last authoritative) state.
   */
  public get baseState(): Readonly<FullMovementState> {
    return this._baseState;
  }

  /**
   * The last server-acknowledged input sequence.
   */
  public get lastAckSequence(): number {
    return this._lastAckSequence;
  }

  /**
   * The last predicted state (from the most recent `predict()` call).
   * Returns `null` before the first prediction.
   */
  public get lastPredicted(): Readonly<FullMovementState> | null {
    return this._lastPredicted;
  }

  /**
   * Run local prediction: start from the base (authoritative) state and
   * replay all unacknowledged inputs through `stepFullMovement`.
   *
   * This is called ONCE per frame, BEFORE rendering. The result is the
   * position to render the local player at this frame.
   *
   * @param pendingInputs - All inputs with sequence > lastAckSequence,
   *       in ascending order. Obtained from the InputSender's ring buffer.
   * @returns The predicted full movement state.
   */
  public predict(pendingInputs: readonly MovementInput[]): FullMovementState {
    let state: FullMovementState = { ...this._baseState };

    for (const input of pendingInputs) {
      // Convert local movement to world space using the input's yaw.
      const worldInput: WorldMovementInput = movementInputToWorld(
        { x: input.moveX, z: input.moveZ },
        input.yaw,
      );

      const verticalInput: VerticalInput = { jump: input.jump };

      state = stepFullMovement(
        state,
        worldInput,
        verticalInput,
        this.deltaSeconds,
        this.horizontalConfig,
        this.verticalConfig,
      );
    }

    this._lastPredicted = state;
    return state;
  }

  /**
   * Process a server state patch (reconciliation).
   *
   * The authoritative server state arrives via Colyseus state sync. When it
   * does, we:
   *  1. Compare the server position to our last prediction. If the difference
   *     exceeds `RECONCILE_EPSILON` on any axis, a hard snap is needed
   *     (the server "corrected" us — collision, wall, or anti-cheat).
   *  2. Update the base state to the server values (new starting point for
   *     future predictions).
   *  3. Update the acknowledged sequence (inputs up to this are no longer
   *     replayed).
   *
   * @param serverState - The authoritative state from the server.
   * @returns `true` if a hard snap was applied (position diverged > epsilon).
   */
  public onServerState(serverState: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    velocityY: number;
    grounded: boolean;
    lastInputSequence: number;
  }): boolean {
    // Check if a hard snap is needed.
    let snapped = false;
    if (this._lastPredicted) {
      const dx = Math.abs(serverState.x - this._lastPredicted.x);
      const dy = Math.abs(serverState.y - this._lastPredicted.y);
      const dz = Math.abs(serverState.z - this._lastPredicted.z);
      if (
        dx > RECONCILE_EPSILON ||
        dy > RECONCILE_EPSILON ||
        dz > RECONCILE_EPSILON
      ) {
        snapped = true;
      }
    }

    // Update base state to the authoritative values.
    this._baseState = {
      x: serverState.x,
      y: serverState.y,
      z: serverState.z,
      yaw: serverState.yaw,
      velocityY: serverState.velocityY,
      grounded: serverState.grounded,
    };

    // Update the acknowledged sequence.
    this._lastAckSequence = serverState.lastInputSequence;

    // The prediction is now "caught up" to the server; clear the last
    // predicted so the next predict() starts fresh from the new base.
    this._lastPredicted = null;

    return snapped;
  }

  /**
   * Reset the predictor to the initial spawn state. Called on (re)connect
   * or when the session changes.
   */
  public reset(): void {
    this._baseState = { ...INITIAL_STATE };
    this._lastAckSequence = -1;
    this._lastPredicted = null;
  }
}
