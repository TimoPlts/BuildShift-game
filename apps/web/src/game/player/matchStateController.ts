/**
 * MatchStateController — client-side match state machine for the 1v1
 * Energy Box Fight MVP.
 *
 * Implements the client's response to the server's authoritative `RoundState`
 * transitions: COUNTDOWN disables input; PLAYING enables input and resumes
 * prediction; ROUND_OVER disables input and stops prediction; MATCH_OVER
 * disables input permanently and signals the UI.
 *
 * On round reset (ROUND_OVER → COUNTDOWN), triggers a reset callback carrying
 * the optional RoundResetPayload the server provided.
 *
 * Pure class with no Babylon, Rapier, Colyseus, or React dependencies.
 * Designed to be owned by the top-level game controller (GameRuntime).
 *
 * Protocol types: codes against `RoundState` and `RoundResetPayload` from
 * `@buildshift/protocol`.
 */
import { RoundState, type RoundResetPayload } from "@buildshift/protocol";

export interface MatchPhaseTransition {
  readonly prev: RoundState;
  readonly next: RoundState;
}

export interface MatchOverInfo {
  readonly winnerId: string | null;
}

export interface RoundResetContext {
  readonly payload: RoundResetPayload | null;
}

export interface MatchStateControllerOptions {
  onPhaseChanged?: (transition: MatchPhaseTransition) => void;
  onInputGateChanged?: (enabled: boolean) => void;
  onPredictionGateChanged?: (active: boolean) => void;
  onMatchOver?: (info: MatchOverInfo) => void;
  onRoundReset?: (context: RoundResetContext) => void;
}

/**
 * Client-side match state machine. Owns the authoritative RoundState
 * transition logic and exposes derived gates (input, prediction) and the
 * match-over flag for the game controller to consume.
 */
export class MatchStateController {
  private _state: RoundState = RoundState.COUNTDOWN;
  private _inputEnabled = false;
  private _predictionActive = false;
  private _matchOver = false;
  private _pendingResetPayload: RoundResetPayload | null = null;
  private readonly options: MatchStateControllerOptions;

  public constructor(options: MatchStateControllerOptions = {}) {
    this.options = options;
  }

  public get state(): RoundState {
    return this._state;
  }

  public get inputEnabled(): boolean {
    return this._inputEnabled;
  }

  public get predictionActive(): boolean {
    return this._predictionActive;
  }

  public get matchOver(): boolean {
    return this._matchOver;
  }

  /**
   * Feed the next authoritative RoundState from the server. No-op if the
   * state is unchanged. Fires callbacks on transitions.
   */
  public setServerState(
    state: RoundState,
    winnerId?: string,
    resetPayload?: RoundResetPayload,
  ): void {
    if (state === this._state) {
      return;
    }

    const prev = this._state;
    const wasRoundOver = prev === RoundState.ROUND_OVER;

    if (resetPayload !== undefined) {
      this._pendingResetPayload = resetPayload;
    }

    this._state = state;

    // Round reset detection: ROUND_OVER → COUNTDOWN
    if (wasRoundOver && state === RoundState.COUNTDOWN) {
      const payload = this._pendingResetPayload;
      this._pendingResetPayload = null;
      this.options.onRoundReset?.({ payload: payload ?? null });
    }

    const prevInputEnabled = this._inputEnabled;
    const prevPredictionActive = this._predictionActive;

    switch (state) {
      case RoundState.COUNTDOWN:
        this._inputEnabled = false;
        this._predictionActive = false;
        break;
      case RoundState.PLAYING:
        if (!this._matchOver) {
          this._inputEnabled = true;
          this._predictionActive = true;
        }
        break;
      case RoundState.ROUND_OVER:
        this._inputEnabled = false;
        this._predictionActive = false;
        break;
      case RoundState.MATCH_OVER:
        this._inputEnabled = false;
        this._predictionActive = false;
        if (!this._matchOver) {
          this._matchOver = true;
          this.options.onMatchOver?.({ winnerId: winnerId ?? null });
        }
        break;
    }

    this.options.onPhaseChanged?.({ prev, next: state });

    if (prevInputEnabled !== this._inputEnabled) {
      this.options.onInputGateChanged?.(this._inputEnabled);
    }
    if (prevPredictionActive !== this._predictionActive) {
      this.options.onPredictionGateChanged?.(this._predictionActive);
    }
  }

  /**
   * Initialize the controller to a specific state for mid-match rejoin.
   * Sets the internal state WITHOUT triggering transition callbacks.
   */
  public initialize(state: RoundState, winnerId?: string): void {
    this._state = state;
    this._pendingResetPayload = null;

    if (state === RoundState.MATCH_OVER) {
      this._matchOver = true;
      this._inputEnabled = false;
      this._predictionActive = false;
      this.options.onMatchOver?.({ winnerId: winnerId ?? null });
    } else if (state === RoundState.PLAYING) {
      this._matchOver = false;
      this._inputEnabled = true;
      this._predictionActive = true;
    } else {
      this._matchOver = false;
      this._inputEnabled = false;
      this._predictionActive = false;
    }
  }

  /**
   * Stage a RoundResetPayload for delivery on the next round-reset transition.
   */
  public stageResetPayload(payload: RoundResetPayload): void {
    this._pendingResetPayload = payload;
  }

  /**
   * Reset the local prediction state.
   *
   * Called by the game controller on round reset to ensure the prediction
   * gate is stopped. If the prediction gate was previously active, this
   * method disables it and fires the `onPredictionGateChanged(false)`
   * callback so the game controller can reset the PredictionOrchestrator
   * (movement state, combat state, sequence counters).
   *
   * If the prediction gate is already stopped, this is a no-op.
   * This method is idempotent and safe to call multiple times. It does NOT
   * modify the match state, input gate, or match-over flag.
   */
  public resetPrediction(): void {
    if (this._predictionActive) {
      this._predictionActive = false;
      this.options.onPredictionGateChanged?.(false);
    }
  }

  /**
   * Reset the controller to the initial COUNTDOWN state.
   * Called on disconnect or reconnection. Clears all internal state.
   * No callbacks are fired.
   */
  public reset(): void {
    this._state = RoundState.COUNTDOWN;
    this._inputEnabled = false;
    this._predictionActive = false;
    this._matchOver = false;
    this._pendingResetPayload = null;
  }
}
