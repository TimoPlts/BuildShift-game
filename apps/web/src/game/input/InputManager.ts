import type { LocalMovementInput } from "@buildshift/simulation";
import { ActionMap, mouseBindingCode, type GameAction } from "./actionBindings";

/**
 * Pointer-lock look-input guard. A single mousemove whose movement is
 * physically impossible — at least {@link LOOK_SPIKE_MIN_PX} pixels on one
 * axis arriving faster than {@link LOOK_SPIKE_MAX_PX_PER_MS} since the previous
 * look event (14+ full turns per second at the default sensitivity) — is a
 * corrupt sample, not player motion: browsers emit such spikes under pointer
 * lock (accelerated-movement spikes, absolute pointing devices / remote
 * desktops warping the cursor, the lock-acquisition jump). It is dropped and
 * counted. Real flicks and low-frame-rate batches (large deltas spread over
 * tens of milliseconds) are always applied in full — no smoothing.
 */
export const LOOK_SPIKE_MIN_PX = 300;
export const LOOK_SPIKE_MAX_PX_PER_MS = 40;

/** Look-input diagnostics (shown in the developer overlay). */
export interface LookInputStats {
  /** Look events applied. */
  events: number;
  /** Largest single-event |movement| applied (pixels). */
  maxEventPx: number;
  /** Corrupt single-event spikes dropped. */
  rejectedSpikes: number;
  /** Largest dropped spike (pixels), 0 when none. */
  maxRejectedPx: number;
  /** Pointer-lock acquisitions. */
  lockAcquisitions: number;
  /** Whether the browser granted raw (unadjusted) pointer-lock movement. */
  unadjustedMovement: boolean;
}

/** Accumulated pointer-lock mouse movement in pixels since the last frame. */
export interface LookDelta {
  x: number;
  y: number;
}

/**
 * The weapon input frame: all weapon-related input edges captured in one
 * struct. This is the canonical shape consumed by the
 * {@link WeaponNetworkClient} (`processWeaponInput`) to drive the local
 * weapon prediction and send typed intents to the authoritative
 * {@link NetworkClient}.
 */
export interface WeaponInputFrame {
  /** Key 1 edge (assault rifle). */
  weaponSlot1Pressed: boolean;
  /** Key 2 edge (shotgun). */
  weaponSlot2Pressed: boolean;
  /** Key R edge (reload). */
  reloadPressed: boolean;
  /** Left-mouse press edge (single-shot trigger). */
  firePressed: boolean;
  /** Left-mouse held (continuous fire for auto weapons). */
  isFiring: boolean;
}

/**
 * Owns every browser input signal used by the local game loop:
 *
 * - keyboard state (movement intent)
 * - accumulated pointer-lock mouse movement (look delta)
 * - pointer-lock lifecycle (request, release, listeners)
 * - mouse button state (fire / left-click)
 * - weapon switch / reload key edges
 *
 * Physical inputs are resolved through the shared {@link ActionMap}
 * (`moveForward`, `jump`, `weaponSlot1`, `primaryAction`, …): nothing here
 * depends on literal key codes, so the bindings are configurable.
 *
 * Real gameplay input is only active while the canvas has pointer lock;
 * while unlocked, both movement and look report zero so the player cannot
 * move while interacting with browser UI. All listeners live here (never in
 * React or in the camera/player classes) so React StrictMode remounts can
 * never leave duplicates behind.
 */
export class InputManager {
  private readonly heldCodes = new Set<string>();
  private readonly lookDelta = { x: 0, y: 0 };
  private readonly lookDeltaOut: LookDelta = { x: 0, y: 0 };
  private readonly movementOut: LocalMovementInput = { x: 0, z: 0 };
  private jumpPressed = false;
  private pointerLocked = false;
  private inputCleared = false;
  private readonly inputClearedListeners = new Set<() => void>();
  private disposed = false;

  private fireHeld = false;
  private firePressed = false;
  private weaponSlot1Pressed = false;
  private weaponSlot2Pressed = false;
  private reloadPressed = false;
  private lastLookEventMs: number | null = null;
  private readonly lookStats: LookInputStats = {
    events: 0,
    maxEventPx: 0,
    rejectedSpikes: 0,
    maxRejectedPx: 0,
    lockAcquisitions: 0,
    unadjustedMovement: false,
  };

  /** The shared gameplay action map (also handed to the build/edit inputs). */
  public readonly actions: ActionMap;

  public constructor(private readonly canvas: HTMLCanvasElement, actions: ActionMap = new ActionMap()) {
    this.actions = actions;
    canvas.addEventListener("click", this.requestPointerLock);
    canvas.addEventListener("mousedown", this.handleMouseDown);
    canvas.addEventListener("mouseup", this.handleMouseUp);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.clearInput);
    window.addEventListener("mousemove", this.handleMouseMove);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  public isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  public isFireHeld(): boolean {
    return this.fireHeld;
  }

  public isFiring(): boolean {
    return this.fireHeld && this.pointerLocked;
  }

  public getMovementInput(): LocalMovementInput {
    if (!this.pointerLocked) {
      this.movementOut.x = 0;
      this.movementOut.z = 0;
      return this.movementOut;
    }
    this.movementOut.x = Number(this.isActionHeld("moveRight")) - Number(this.isActionHeld("moveLeft"));
    this.movementOut.z = Number(this.isActionHeld("moveBackward")) - Number(this.isActionHeld("moveForward"));
    return this.movementOut;
  }

  /** Whether any key bound to `action` is currently held. */
  public isActionHeld(action: GameAction): boolean {
    for (const code of this.actions.bindingsFor(action)) {
      if (this.heldCodes.has(code)) return true;
    }
    return false;
  }

  /**
   * Whether a `crouch` binding is currently held while the pointer is locked.
   *
   * Like movement, crouch intent is only active under pointer lock so the
   * player cannot crouch while interacting with browser UI. The key is tracked
   * in {@link heldCodes} (cleared on blur / unlock / visibility change via
   * {@link clearInput}).
   */
  public isCrouchHeld(): boolean {
    return this.isActionHeld("crouch") && this.pointerLocked;
  }

  /** Look-input diagnostics (a snapshot copy). */
  public getLookStats(): LookInputStats {
    return { ...this.lookStats };
  }

  public consumeLookDelta(): LookDelta {
    this.lookDeltaOut.x = this.lookDelta.x;
    this.lookDeltaOut.y = this.lookDelta.y;
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    if (!this.pointerLocked) {
      this.lookDeltaOut.x = 0;
      this.lookDeltaOut.y = 0;
    }
    return this.lookDeltaOut;
  }

  public pollJumpPressed(): boolean {
    const wasPressed = this.jumpPressed;
    this.jumpPressed = false;
    return wasPressed;
  }

  public consumeFirePressed(): boolean {
    const wasPressed = this.firePressed;
    this.firePressed = false;
    return wasPressed;
  }

  public consumeWeaponSlot1Pressed(): boolean {
    const wasPressed = this.weaponSlot1Pressed;
    this.weaponSlot1Pressed = false;
    return wasPressed;
  }

  public consumeWeaponSlot2Pressed(): boolean {
    const wasPressed = this.weaponSlot2Pressed;
    this.weaponSlot2Pressed = false;
    return wasPressed;
  }

  public consumeReloadPressed(): boolean {
    const wasPressed = this.reloadPressed;
    this.reloadPressed = false;
    return wasPressed;
  }

  /**
   * Returns the full weapon input frame in a single call, consuming all
   * latched weapon edges (switch, reload, fire) and reading the current
   * fire-hold state.
   *
   * This is the canonical integration point for the
   * {@link WeaponNetworkClient}. The GameRuntime calls this once per render
   * frame and passes the result to `WeaponNetworkClient.processWeaponInput()`,
   * which sends the typed intents through the
   * {@link NetworkClient} and drives the local {@link WeaponPrediction}.
   *
   * All edges are cleared atomically: calling this method consumes the
   * latches so a subsequent individual consume would return false.
   */
  public consumeWeaponInputFrame(): WeaponInputFrame {
    const frame: WeaponInputFrame = {
      weaponSlot1Pressed: this.weaponSlot1Pressed,
      weaponSlot2Pressed: this.weaponSlot2Pressed,
      reloadPressed: this.reloadPressed,
      firePressed: this.firePressed,
      isFiring: this.fireHeld && this.pointerLocked,
    };
    this.weaponSlot1Pressed = false;
    this.weaponSlot2Pressed = false;
    this.reloadPressed = false;
    this.firePressed = false;
    return frame;
  }

  public consumeInputCleared(): boolean {
    const cleared = this.inputCleared;
    this.inputCleared = false;
    return cleared;
  }

  public subscribeInputCleared(listener: () => void): () => void {
    this.inputClearedListeners.add(listener);
    return () => {
      this.inputClearedListeners.delete(listener);
    };
  }

  private readonly requestPointerLock = (): void => {
    if (this.disposed || this.pointerLocked) return;
    if (typeof this.canvas.requestPointerLock !== "function") return;
    // Prefer raw, unaccelerated relative movement (no OS acceleration path,
    // no absolute-position warping); fall back to the default lock where the
    // option is unsupported.
    const plain = (): void => {
      try {
        const request = this.canvas.requestPointerLock();
        if (request && typeof (request as Promise<void>).catch === "function") {
          (request as Promise<void>).catch(() => undefined);
        }
      } catch {
        // Older engines: nothing to do.
      }
    };
    try {
      const request = (this.canvas.requestPointerLock as (options?: { unadjustedMovement?: boolean }) => unknown)({ unadjustedMovement: true });
      if (request && typeof (request as Promise<void>).then === "function") {
        (request as Promise<void>).then(
          () => { this.lookStats.unadjustedMovement = true; },
          () => { if (!this.disposed && !this.pointerLocked) plain(); },
        );
      }
    } catch {
      plain();
    }
  };

  public dispose(): void {
    if (this.disposed) return;
    this.canvas.removeEventListener("click", this.requestPointerLock);
    this.canvas.removeEventListener("mousedown", this.handleMouseDown);
    this.canvas.removeEventListener("mouseup", this.handleMouseUp);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.clearInput);
    window.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.clearInput();
    this.disposed = true;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const actions = this.actions.actionsFor(event.code);
    if (actions.length === 0) return;
    this.heldCodes.add(event.code);
    if (!this.pointerLocked || event.repeat) return;
    for (const action of actions) {
      if (action === "jump") this.jumpPressed = true;
      else if (action === "weaponSlot1") this.weaponSlot1Pressed = true;
      else if (action === "weaponSlot2") this.weaponSlot2Pressed = true;
      else if (action === "reload") this.reloadPressed = true;
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.heldCodes.delete(event.code);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.pointerLocked) return;
    const dx = Number.isFinite(event.movementX) ? event.movementX : 0;
    const dy = Number.isFinite(event.movementY) ? event.movementY : 0;
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    const now = typeof event.timeStamp === "number" && event.timeStamp > 0 ? event.timeStamp : null;
    const elapsed = now !== null && this.lastLookEventMs !== null ? now - this.lastLookEventMs : null;
    if (now !== null) this.lastLookEventMs = now;
    if (size >= LOOK_SPIKE_MIN_PX && elapsed !== null && size / Math.max(elapsed, 1) > LOOK_SPIKE_MAX_PX_PER_MS) {
      this.lookStats.rejectedSpikes += 1;
      this.lookStats.maxRejectedPx = Math.max(this.lookStats.maxRejectedPx, size);
      return;
    }
    this.lookStats.events += 1;
    if (size > this.lookStats.maxEventPx) this.lookStats.maxEventPx = size;
    this.lookDelta.x += dx;
    this.lookDelta.y += dy;
  };

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (!this.pointerLocked || !this.actions.matches("primaryAction", mouseBindingCode(event.button))) return;
    this.fireHeld = true;
    this.firePressed = true;
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (!this.actions.matches("primaryAction", mouseBindingCode(event.button))) return;
    this.fireHeld = false;
  };

  private readonly handlePointerLockChange = (): void => {
    const wasLocked = this.pointerLocked;
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (this.pointerLocked && !wasLocked) {
      this.lookStats.lockAcquisitions += 1;
      // The first locked event is timed against the lock itself, so a
      // lock-acquisition jump is judged by the same physical-rate rule.
      this.lastLookEventMs = typeof performance !== "undefined" ? performance.now() : null;
    }
    if (!this.pointerLocked) {
      this.clearInput();
    }
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.clearInput();
    }
  };

  private readonly clearInput = (): void => {
    this.heldCodes.clear();
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    this.jumpPressed = false;
    this.fireHeld = false;
    this.firePressed = false;
    this.weaponSlot1Pressed = false;
    this.weaponSlot2Pressed = false;
    this.reloadPressed = false;
    this.inputCleared = true;
    for (const listener of this.inputClearedListeners) {
      listener();
    }
  };
}
