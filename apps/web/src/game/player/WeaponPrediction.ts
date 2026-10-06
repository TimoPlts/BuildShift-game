/**
 * WeaponPrediction — local client-side weapon state prediction for the
 * canonical Energy Box Fight room.
 *
 * This is a pure, self-contained state machine that tracks the local player's
 * active weapon (ammo, reload, fire cooldown) and allows optimistic
 * prediction between authoritative server updates.
 *
 * Boundedness contract:
 *  - Local prediction only moves *forward* from the last authoritative state
 *    (decrements ammo, advances cooldown / reload timers).
 *  - On reconciliation ({@link reconcile}), the local state is *snapped* to
 *    the server's authoritative values — no interpolation or smoothing is
 *    applied to weapon state. This keeps prediction bounded: the local state
 *    can never diverge indefinitely from the server.
 *
 * The prediction is driven by:
 *  - {@link tick} (per frame, advances timers)
 *  - {@link tryFire} (optimistic fire: decrements ammo if allowed)
 *  - {@link switchWeapon} (optimistic switch: changes active weapon)
 *  - {@link startReload} (optimistic reload: begins reload timer)
 *  - {@link reconcile} (authoritative snap from server)
 *
 * This class has NO network dependency — it operates purely on local state.
 * The {@link WeaponNetworkClient} is responsible for sending intents to the
 * server and feeding authoritative responses back into this class.
 */
import { getWeaponById } from "@buildshift/game-config";
import type { WeaponId } from "@buildshift/protocol";

/**
 * The fixed simulation tick duration in seconds (must match the server's
 * TICK_DELTA_SECONDS = 1/30). Used to convert between tick-based weapon
 * parameters and millisecond-based local timers.
 */
const TICK_SECONDS = 1 / 30;

/** The fixed simulation tick duration in milliseconds. */
const TICK_MS = TICK_SECONDS * 1000;

/**
 * The authoritative weapon state as delivered by the server.
 *
 * Matches the `WeaponState` type from `@buildshift/protocol`
 * (`messages/weaponRequestMessages.ts`), which the TwoPlayerMovementRoom
 * broadcasts via the `"combat:weapon_state"` event.
 */
export interface AuthoritativeWeaponState {
  /** The weapon id this state describes. */
  weaponId: WeaponId;
  /** Rounds currently loaded in the weapon's magazine. */
  ammoInMag: number;
  /** Rounds available to reload the magazine. */
  ammoReserve: number;
  /** Whether the weapon is currently reloading. */
  reloading: boolean;
  /**
   * Remaining reload time as reported by the server. Per the protocol
   * contract this is in **milliseconds**. The client converts to local
   * elapsed time for the prediction timer.
   */
  reloadRemainingMs: number;
}

/**
 * The locally-predicted weapon state exposed to the HUD and fire gate.
 */
export interface LocalWeaponState {
  /** The currently active weapon id. */
  activeWeaponId: WeaponId;
  /** Optimistic current magazine ammo. */
  currentAmmo: number;
  /** Maximum magazine capacity. */
  maxAmmo: number;
  /** Whether a reload is in progress. */
  isReloading: boolean;
  /** Reload progress from 0 to 1 (0 = just started, 1 = complete). */
  reloadProgress: number;
  /** Whether the local player can fire the active weapon right now. */
  canFire: boolean;
}

/**
 * The result of an optimistic fire attempt.
 */
export interface FirePredictionResult {
  /** Whether the shot was allowed (passed all local gates). */
  fired: boolean;
  /** The magazine ammo after the shot (decremented if fired). */
  currentAmmo: number;
}

/**
 * The result of an optimistic weapon switch.
 */
export interface SwitchPredictionResult {
  /** Whether the switch was applied locally. */
  switched: boolean;
  /** The target weapon id (null when the switch was rejected). */
  targetWeaponId: WeaponId | null;
}

/**
 * The result of an optimistic reload start.
 */
export interface ReloadPredictionResult {
  /** Whether the reload was started. */
  started: boolean;
}

/**
 * Default initial weapon (matches the server's `CANONICAL_ACTIVE_WEAPON`).
 */
const DEFAULT_WEAPON: WeaponId = "assault_rifle";

/**
 * Client-side weapon prediction state machine.
 *
 * Owns the local, optimistic view of the player's active weapon. All
 * mutations happen through this class's methods; the class never sends
 * network messages itself.
 */
export class WeaponPrediction {
  private _activeWeaponId: WeaponId = DEFAULT_WEAPON;
  private _currentAmmo: number;
  private _maxAmmo: number;
  private _reserveAmmo: number;
  private _isReloading = false;
  private _reloadElapsedMs = 0;
  private _reloadDurationMs: number;
  private _fireCooldownElapsedMs = Infinity;
  private _fireIntervalMs: number;

  public constructor() {
    const config = getWeaponById(DEFAULT_WEAPON)!;
    this._currentAmmo = config.maxAmmo;
    this._maxAmmo = config.maxAmmo;
    this._reserveAmmo = config.maxReserve;
    this._fireIntervalMs = config.fireIntervalTicks * TICK_MS;
    this._reloadDurationMs = config.reloadTicks * TICK_MS;
  }

  // ─── Accessors ──────────────────────────────────────────────────────────────

  public get activeWeaponId(): WeaponId {
    return this._activeWeaponId;
  }

  public get currentAmmo(): number {
    return this._currentAmmo;
  }

  public get maxAmmo(): number {
    return this._maxAmmo;
  }

  public get reserveAmmo(): number {
    return this._reserveAmmo;
  }

  public get isReloading(): boolean {
    return this._isReloading;
  }

  public get reloadProgress(): number {
    if (!this._isReloading) return 0;
    if (this._reloadDurationMs <= 0) return 1;
    return Math.min(this._reloadElapsedMs / this._reloadDurationMs, 1);
  }

  public get canFire(): boolean {
    return (
      this._fireCooldownElapsedMs >= this._fireIntervalMs &&
      this._currentAmmo > 0 &&
      !this._isReloading
    );
  }

  /** Get a snapshot of the full local weapon state (for HUD binding). */
  public getLocalState(): LocalWeaponState {
    return {
      activeWeaponId: this._activeWeaponId,
      currentAmmo: this._currentAmmo,
      maxAmmo: this._maxAmmo,
      isReloading: this._isReloading,
      reloadProgress: this.reloadProgress,
      canFire: this.canFire,
    };
  }

  // ─── Prediction methods ────────────────────────────────────────────────────

  /**
   * Advance local timers by the given elapsed time (milliseconds).
   *
   * Called once per render frame. Advances the fire cooldown and, if a
   * reload is in progress, advances the reload timer (completing the reload
   * and refilling the magazine when the duration elapses).
   */
  public tick(deltaMs: number): void {
    if (deltaMs <= 0) return;
    this._fireCooldownElapsedMs += deltaMs;

    if (this._isReloading) {
      this._reloadElapsedMs += deltaMs;
      if (this._reloadElapsedMs >= this._reloadDurationMs) {
        this._isReloading = false;
        this._reloadElapsedMs = 0;
        // Refill magazine from reserve.
        const needed = this._maxAmmo - this._currentAmmo;
        const taken = Math.min(needed, this._reserveAmmo);
        this._currentAmmo += taken;
        this._reserveAmmo -= taken;
      }
    }
  }

  /**
   * Attempt an optimistic fire.
   *
   * Checks the local gates (cooldown elapsed, ammo available, not reloading).
   * If all pass, decrements ammo and resets the fire cooldown.
   */
  public tryFire(): FirePredictionResult {
    if (this._isReloading) {
      return { fired: false, currentAmmo: this._currentAmmo };
    }
    if (this._fireCooldownElapsedMs < this._fireIntervalMs) {
      return { fired: false, currentAmmo: this._currentAmmo };
    }
    if (this._currentAmmo <= 0) {
      return { fired: false, currentAmmo: 0 };
    }

    // Optimistic fire.
    this._currentAmmo -= 1;
    this._fireCooldownElapsedMs = 0;
    return { fired: true, currentAmmo: this._currentAmmo };
  }

  /**
   * Attempt an optimistic weapon switch.
   *
   * If the target is valid and different from the current weapon, switches
   * the active weapon and loads its ammo/cooldown/reload parameters.
   */
  public switchWeapon(targetWeaponId: WeaponId): SwitchPredictionResult {
    if (this._activeWeaponId === targetWeaponId) {
      return { switched: false, targetWeaponId: null };
    }

    const config = getWeaponById(targetWeaponId);
    if (!config) {
      return { switched: false, targetWeaponId: null };
    }

    this._activeWeaponId = targetWeaponId;
    this._currentAmmo = config.maxAmmo;
    this._maxAmmo = config.maxAmmo;
    this._reserveAmmo = config.maxReserve;
    this._fireIntervalMs = config.fireIntervalTicks * TICK_MS;
    this._reloadDurationMs = config.reloadTicks * TICK_MS;
    this._isReloading = false;
    this._reloadElapsedMs = 0;
    this._fireCooldownElapsedMs = Infinity;

    return { switched: true, targetWeaponId };
  }

  /**
   * Attempt to start an optimistic reload.
   *
   * Valid only when not already reloading and the magazine is not full.
   */
  public startReload(): ReloadPredictionResult {
    if (this._isReloading) {
      return { started: false };
    }
    if (this._currentAmmo >= this._maxAmmo) {
      return { started: false };
    }

    this._isReloading = true;
    this._reloadElapsedMs = 0;
    return { started: true };
  }

  // ─── Reconciliation ────────────────────────────────────────────────────────

  /**
   * Snap the local prediction to the server's authoritative weapon state.
   *
   * This is called when the server broadcasts a `WeaponState` update via
   * the `"combat:weapon_state"` event. The local state is *replaced* — no
   * interpolation is applied — keeping the prediction bounded.
   *
   * The `reloadRemainingMs` field is per the protocol contract in
   * milliseconds. However, the current server implementation may report
   * a 0–1 progress ratio in this field (a known transitional state). This
   * method handles both cases:
   *  - If the value is ≤ 1 and `reloading` is true, it is treated as a
   *    progress ratio (fraction of total reload remaining).
   *  - If the value is > 1, it is treated as raw milliseconds remaining.
   */
  public reconcile(state: AuthoritativeWeaponState): void {
    const config = getWeaponById(state.weaponId);
    if (!config) return;

    this._activeWeaponId = state.weaponId;
    this._currentAmmo = state.ammoInMag;
    this._maxAmmo = config.maxAmmo;
    this._reserveAmmo = state.ammoReserve;

    this._reloadDurationMs = config.reloadTicks * TICK_MS;

    if (state.reloading) {
      this._isReloading = true;
      const raw = state.reloadRemainingMs;
      // Determine the remaining reload time in milliseconds.
      // Protocol contract: raw is in ms. Transitional server: raw may be
      // a 0–1 progress ratio. Handle both gracefully.
      let remainingMs: number;
      if (raw >= 0 && raw <= 1) {
        // Treat as a progress ratio: (1 - raw) is the fraction remaining.
        remainingMs = (1 - raw) * this._reloadDurationMs;
      } else {
        // Treat as raw milliseconds per the protocol contract.
        remainingMs = Math.max(0, raw);
      }
      this._reloadElapsedMs = Math.max(
        0,
        this._reloadDurationMs - remainingMs,
      );
    } else {
      this._isReloading = false;
      this._reloadElapsedMs = 0;
    }

    // Reset the fire cooldown on reconciliation (the server's tick will
    // re-establish the cadence gate via lastFireSequence in the input frame).
    this._fireCooldownElapsedMs = Infinity;
    this._fireIntervalMs = config.fireIntervalTicks * TICK_MS;
  }

  /**
   * Reset to the canonical initial state (assault rifle, full magazine,
   * no reload). Called on connection / match reset.
   */
  public reset(): void {
    const config = getWeaponById(DEFAULT_WEAPON)!;
    this._activeWeaponId = DEFAULT_WEAPON;
    this._currentAmmo = config.maxAmmo;
    this._maxAmmo = config.maxAmmo;
    this._reserveAmmo = config.maxReserve;
    this._fireIntervalMs = config.fireIntervalTicks * TICK_MS;
    this._reloadDurationMs = config.reloadTicks * TICK_MS;
    this._isReloading = false;
    this._reloadElapsedMs = 0;
    this._fireCooldownElapsedMs = Infinity;
  }
}
