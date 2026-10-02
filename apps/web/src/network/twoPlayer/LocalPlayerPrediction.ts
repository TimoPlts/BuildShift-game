/**
 * LocalPlayerPrediction — client-side prediction and reconciliation for
 * the local player in the two-player movement system, extended with combat.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §18, the client predicts locally using
 * the SAME deterministic stepFullMovement the server uses, then reconciles
 * when the authoritative server state arrives.
 *
 * Combat extension:
 *  - Each simulation tick, the caller may request a fire via `predictFire()`.
 *  - The shared `canFire` cooldown gate (from @buildshift/simulation) is
 *    evaluated against the locally-tracked `lastFireSequence`.
 *  - If the shot is allowed, the local ammo is decremented and the
 *    lastFireSequence is updated optimistically.
 *  - On reconciliation, the server's authoritative ammo / health / shield /
 *    lastFireSequence / isEliminated are compared and snapped.
 *
 * The predictor is NEVER authoritative: it only predicts between the last
 * server truth and the local input intent. The server remains the sole
 * authority on position, velocity, grounded state, health, ammo, etc.
 */
import {
  movementInputToWorld,
  stepFullMovement,
  canFire,
  type FullMovementState,
  type HorizontalMovementConfig,
  type VerticalMovementConfig,
} from "@buildshift/simulation";
import {
  PLAYER_MOVEMENT,
  VERTICAL_MOVEMENT,
  ASSAULT_RIFLE,
  MAX_HEALTH,
  MAX_SHIELD,
} from "@buildshift/game-config";
import type { BufferedInput } from "./InputSender";

/**
 * Documented client-side snap threshold (metres). If the server's
 * authoritative position differs from the predicted position by more than
 * this distance, a hard snap is applied.
 */
export const CORRECTION_SNAP_THRESHOLD = 0.5;

/** Number of render frames to smooth a small correction over. */
export const CORRECTION_SMOOTH_FRAMES = 5;

/**
 * The fixed simulation timestep (seconds) for the two-player movement
 * system. Must match the server's TICK_DELTA_SECONDS (1/30).
 */
export const SIMULATION_TICK_SECONDS = 1 / 30;

const HORIZONTAL_CONFIG: Readonly<HorizontalMovementConfig> = {
  moveSpeed: PLAYER_MOVEMENT.moveSpeed,
};

const VERTICAL_CONFIG: Readonly<VerticalMovementConfig> = {
  gravity: VERTICAL_MOVEMENT.gravity,
  jumpVelocity: VERTICAL_MOVEMENT.jumpVelocity,
  maxFallSpeed: VERTICAL_MOVEMENT.maxFallSpeed,
  groundY: VERTICAL_MOVEMENT.groundY,
  jumpSpeed: VERTICAL_MOVEMENT.jumpVelocity,
};

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
 * Combat state tracked locally for the HUD and fire prediction.
 */
export interface LocalCombatState {
  /** Current predicted ammo (optimistic). */
  ammo: number;
  /** Authoritative health (updated on reconciliation). */
  health: number;
  /** Authoritative shield (updated on reconciliation). */
  shield: number;
  /** Authoritative energy (updated on reconciliation). */
  energy: number;
  /** The last fire sequence the local player used. */
  lastFireSequence: number;
  /** Whether the local player is eliminated. */
  isEliminated: boolean;
}

/**
 * The result of a local fire prediction attempt.
 */
export interface FirePredictionResult {
  /** Whether the shot was allowed (passed the cooldown gate). */
  fired: boolean;
  /** The ammo count after the shot (decremented if fired). */
  ammo: number;
}

/**
 * Client-side prediction engine for the local player (movement + combat).
 */
export class LocalPlayerPrediction {
  private state: FullMovementState = { ...INITIAL_STATE };
  private correctionFrom: { x: number; y: number; z: number } | null = null;
  private correctionRemaining = 0;
  private _lastAckSequence = -1;
  private _lastCorrectionDistance: number | null = null;
  private lastPreReconcileState: { x: number; y: number; z: number } | null =
    null;

  // ── Combat state ──────────────────────────────────────────────────────────
  private _localAmmo = ASSAULT_RIFLE.maxAmmo;
  private _localHealth = MAX_HEALTH;
  private _localShield = MAX_SHIELD;
  private _localEnergy = 0;
  private _lastFireSequence = -1;
  private _isEliminated = false;

  /** The current predicted movement state (for driving the mesh). */
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
   * Attempt a local fire prediction. Uses the shared `canFire` gate with the
   * locally-tracked lastFireSequence and the weapon's fireIntervalTicks.
   *
   * @param currentSequence The input sequence of the current tick.
   * @param fireIntent Whether the player is currently holding the fire button.
   * @returns The fire prediction result (fired: whether the shot was allowed).
   */
  public predictFire(
    currentSequence: number,
    fireIntent: boolean,
  ): FirePredictionResult {
    if (!fireIntent) {
      return { fired: false, ammo: this._localAmmo };
    }

    const allowed = canFire(
      this._lastFireSequence,
      currentSequence,
      ASSAULT_RIFLE.fireIntervalTicks,
      { isEliminated: this._isEliminated },
    );

    if (!allowed) {
      return { fired: false, ammo: this._localAmmo };
    }

    if (this._localAmmo <= 0) {
      return { fired: false, ammo: 0 };
    }

    // Optimistic fire: decrement ammo, update lastFireSequence.
    this._localAmmo -= 1;
    this._lastFireSequence = currentSequence;
    return { fired: true, ammo: this._localAmmo };
  }

  /**
   * Process a server state patch (reconciliation) including combat fields.
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
      // Combat fields
      health?: number;
      shield?: number;
      energy?: number;
      ammo?: number;
      lastFireSequence?: number;
      isEliminated?: boolean;
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

    // ── Combat reconciliation ──────────────────────────────────────────────
    // Snap ammo to the server value if the server says lower (the server is
    // authoritative on ammo; a prediction that fired a shot the server
    // rejected must be corrected).
    if (typeof serverState.ammo === "number") {
      this._localAmmo = serverState.ammo;
    }
    if (typeof serverState.health === "number") {
      this._localHealth = serverState.health;
    }
    if (typeof serverState.shield === "number") {
      this._localShield = serverState.shield;
    }
    if (typeof serverState.energy === "number") {
      this._localEnergy = serverState.energy;
    }
    if (typeof serverState.lastFireSequence === "number") {
      this._lastFireSequence = serverState.lastFireSequence;
    }
    if (typeof serverState.isEliminated === "boolean") {
      this._isEliminated = serverState.isEliminated;
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

  /** The locally-tracked ammo (optimistic between reconciliation cycles). */
  public get localAmmo(): number {
    return this._localAmmo;
  }

  /** The authoritative health (last reconciliation). */
  public get localHealth(): number {
    return this._localHealth;
  }

  /** The authoritative shield. */
  public get localShield(): number {
    return this._localShield;
  }

  /** The authoritative energy. */
  public get localEnergy(): number {
    return this._localEnergy;
  }

  /** The last fire sequence (local or reconciled). */
  public get lastFireSequence(): number {
    return this._lastFireSequence;
  }

  /** Whether the local player is eliminated. */
  public get isEliminated(): boolean {
    return this._isEliminated;
  }

  /** Get the full local combat state snapshot. */
  public getCombatState(): LocalCombatState {
    return {
      ammo: this._localAmmo,
      health: this._localHealth,
      shield: this._localShield,
      energy: this._localEnergy,
      lastFireSequence: this._lastFireSequence,
      isEliminated: this._isEliminated,
    };
  }

  /**
   * Reset the predictor to the initial spawn state (movement + combat).
   */
  public reset(): void {
    this.state = { ...INITIAL_STATE };
    this._lastAckSequence = -1;
    this.correctionFrom = null;
    this.correctionRemaining = 0;
    this.lastPreReconcileState = null;
    this._lastCorrectionDistance = null;
    // Reset combat to full defaults.
    this._localAmmo = ASSAULT_RIFLE.maxAmmo;
    this._localHealth = MAX_HEALTH;
    this._localShield = MAX_SHIELD;
    this._localEnergy = 0;
    this._lastFireSequence = -1;
    this._isEliminated = false;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
