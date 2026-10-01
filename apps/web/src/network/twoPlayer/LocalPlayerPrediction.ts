/**
 * LocalPlayerPrediction — client-side prediction and reconciliation for
 * the local player in the two-player movement system.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §18, the client predicts locally using
 * the SAME deterministic stepFullMovement the server uses, then reconciles
 * when the authoritative server state arrives:
 *
 * 1. Each simulation tick (30 Hz), the caller captures input, sends it,
 *    and calls `predict()` to advance the local predicted state.
 * 2. When a server state patch arrives for the local player, `onServerState()`
 *    is called:
 *      a. Find the server-processed sequence (lastProcessedSequence).
 *      b. Discard all buffered inputs with sequence <= server sequence.
 *      c. Reset local predicted position/velocity to the server's authoritative
 *         values.
 *      d. Re-apply all remaining buffered inputs (sequence > server sequence)
 *         to recover predicted position.
 *      e. If the correction distance exceeds a threshold (0.5 m), snap;
 *         otherwise smooth over a few frames.
 *
 * The predictor is NEVER authoritative: it only predicts between the last
 * server truth and the local input intent. The server remains the sole
 * authority on position, velocity, and grounded state.
 */
import {
  movementInputToWorld,
  stepFullMovement,
  type FullMovementState,
  type HorizontalMovementConfig,
  type VerticalMovementConfig,
} from "@buildshift/simulation";
import {
  PLAYER_MOVEMENT,
  VERTICAL_MOVEMENT,
} from "@buildshift/game-config";
import type { BufferedInput } from "./InputSender";

/**
 * Documented client-side snap threshold (metres). If the server's
 * authoritative position differs from the predicted position by more than
 * this distance, a hard snap is applied. Below this threshold, the
 * correction is smoothed over CORRECTION_SMOOTH_FRAMES render frames.
 */
export const CORRECTION_SNAP_THRESHOLD = 0.5;

/** Number of render frames to smooth a small correction over. */
export const CORRECTION_SMOOTH_FRAMES = 5;

/**
 * The fixed simulation timestep (seconds) for the two-player movement
 * system. Must match the server's TICK_DELTA_SECONDS (1/30).
 */
export const SIMULATION_TICK_SECONDS = 1 / 30;

/**
 * Horizontal movement config for stepFullMovement — the exact shared
 * moveSpeed from @buildshift/game-config.
 */
const HORIZONTAL_CONFIG: Readonly<HorizontalMovementConfig> = {
  moveSpeed: PLAYER_MOVEMENT.moveSpeed,
};

/**
 * Vertical movement config for stepFullMovement — the exact shared
 * gravity / jump / terminal-velocity / ground-reference tuning.
 */
const VERTICAL_CONFIG: Readonly<VerticalMovementConfig> = {
  gravity: VERTICAL_MOVEMENT.gravity,
  jumpVelocity: VERTICAL_MOVEMENT.jumpVelocity,
  maxFallSpeed: VERTICAL_MOVEMENT.maxFallSpeed,
  groundY: VERTICAL_MOVEMENT.groundY,
  jumpSpeed: VERTICAL_MOVEMENT.jumpVelocity,
};

/**
 * The initial (spawn) state used before the first server state arrives.
 * Matches the server's onJoin spawn: position (0, groundY, 0), yaw 0,
 * velocityY 0, grounded true.
 */
const INITIAL_STATE: FullMovementState = {
  x: 0,
  y: VERTICAL_MOVEMENT.groundY,
  z: 0,
  yaw: 0,
  velocityY: 0,
  grounded: true,
};

/**
 * The predicted movement state exposed to the render loop.
 */
export interface PredictedState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  velocityY: number;
  grounded: boolean;
}

/**
 * Client-side prediction engine for the local player.
 */
export class LocalPlayerPrediction {
  private state: FullMovementState = { ...INITIAL_STATE };
  private correctionFrom: { x: number; y: number; z: number } | null = null;
  private correctionRemaining = 0;
  private _lastAckSequence = -1;
  private _lastCorrectionDistance: number | null = null;
  private lastPreReconcileState: { x: number; y: number; z: number } | null =
    null;

  /** The current predicted state (for driving the mesh). */
  public getCurrentState(): PredictedState {
    if (this.correctionFrom !== null && this.correctionRemaining > 0) {
      const t = 1 - this.correctionRemaining / CORRECTION_SMOOTH_FRAMES;
      return {
        x: lerp(this.correctionFrom.x, this.state.x, t),
        y: lerp(this.correctionFrom.y, this.state.y, t),
        z: lerp(this.correctionFrom.z, this.state.z, t),
        yaw: this.state.yaw,
        velocityY: this.state.velocityY,
        grounded: this.state.grounded,
      };
    }
    return {
      x: this.state.x,
      y: this.state.y,
      z: this.state.z,
      yaw: this.state.yaw,
      velocityY: this.state.velocityY,
      grounded: this.state.grounded,
    };
  }

  /**
   * Advance the local prediction by one simulation tick.
   */
  public predict(input: {
    moveX: number;
    moveZ: number;
    yaw: number;
    pitch: number;
    jump: boolean;
    crouch: boolean;
  }): PredictedState {
    const worldInput = movementInputToWorld(
      { x: input.moveX, z: input.moveZ },
      input.yaw,
    );
    this.state = stepFullMovement(
      this.state,
      worldInput,
      { jump: input.jump },
      SIMULATION_TICK_SECONDS,
      HORIZONTAL_CONFIG,
      VERTICAL_CONFIG,
    );
    if (this.correctionRemaining > 0) {
      this.correctionRemaining -= 1;
      if (this.correctionRemaining <= 0) {
        this.correctionFrom = null;
      }
    }
    return this.getCurrentState();
  }

  /**
   * Process a server state patch (reconciliation).
   */
  public onServerState(
    serverState: {
      x: number;
      y: number;
      z: number;
      yaw: number;
      velocityY: number;
      grounded: boolean;
      sequence: number;
    },
    bufferedInputs: readonly BufferedInput[],
  ): number | null {
    const ack = serverState.sequence;
    if (ack <= this._lastAckSequence) {
      return null;
    }
    this._lastAckSequence = ack;

    this.lastPreReconcileState = {
      x: this.state.x,
      y: this.state.y,
      z: this.state.z,
    };

    // Reset to the server's authoritative values.
    this.state = {
      x: serverState.x,
      y: serverState.y,
      z: serverState.z,
      yaw: serverState.yaw,
      velocityY: serverState.velocityY,
      grounded: serverState.grounded,
    };

    // Re-apply all remaining buffered inputs (sequence > ack).
    for (const entry of bufferedInputs) {
      if (entry.input.sequence <= ack) continue;
      const worldInput = movementInputToWorld(
        { x: entry.input.moveX, z: entry.input.moveZ },
        entry.input.lookYaw,
      );
      this.state = stepFullMovement(
        this.state,
        worldInput,
        { jump: entry.input.jump },
        SIMULATION_TICK_SECONDS,
        HORIZONTAL_CONFIG,
        VERTICAL_CONFIG,
      );
    }

    // Determine if a visual correction is needed.
    const pre = this.lastPreReconcileState;
    if (pre) {
      const distance = Math.hypot(
        this.state.x - pre.x,
        this.state.y - pre.y,
        this.state.z - pre.z,
      );
      this._lastCorrectionDistance = distance;

      if (distance > CORRECTION_SNAP_THRESHOLD) {
        this.correctionFrom = null;
        this.correctionRemaining = 0;
      } else if (distance > 0.001) {
        this.correctionFrom = { x: pre.x, y: pre.y, z: pre.z };
        this.correctionRemaining = CORRECTION_SMOOTH_FRAMES;
      } else {
        this.correctionFrom = null;
        this.correctionRemaining = 0;
      }
    }

    return this._lastCorrectionDistance;
  }

  /** The last server-acknowledged input sequence. */
  public get lastAckSequence(): number {
    return this._lastAckSequence;
  }

  /** The distance of the last reconciliation correction (metres), or null. */
  public get lastCorrectionDistance(): number | null {
    return this._lastCorrectionDistance;
  }

  /**
   * Reset the predictor to the initial spawn state.
   */
  public reset(): void {
    this.state = { ...INITIAL_STATE };
    this._lastAckSequence = -1;
    this.correctionFrom = null;
    this.correctionRemaining = 0;
    this.lastPreReconcileState = null;
    this._lastCorrectionDistance = null;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
