import type { LocalMovementInput } from "@buildshift/simulation";

const MOVEMENT_CODES = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);
const JUMP_CODE = "Space";

/** Weapon switch key: key 1 → assault rifle. */
const WEAPON_SLOT_1_CODE = "Digit1";
/** Weapon switch key: key 2 → shotgun. */
const WEAPON_SLOT_2_CODE = "Digit2";
/** Reload key. */
const RELOAD_CODE = "KeyR";

/** Accumulated pointer-lock mouse movement in pixels since the last frame. */
export interface LookDelta {
  x: number;
  y: number;
}

/**
 * Owns every browser input signal used by the local game loop:
 *
 * - keyboard state (WASD intent)
 * - accumulated pointer-lock mouse movement (look delta)
 * - pointer-lock lifecycle (request, release, listeners)
 * - mouse button state (fire / left-click)
 * - weapon switch / reload key edges (1, 2, R)
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
  /**
   * Latched the most recent jump key-down edge, pending the next fixed
   * simulation step. It is intentionally *not* cleared per render frame — only
   * when a fixed step polls it (see {@link pollJumpPressed}) or when input is
   * cleared — so a press can never be consumed before a simulation step runs.
   */
  private jumpPressed = false;
  private pointerLocked = false;
  /**
   * Latched true whenever {@link clearInput} ran (unlock / blur / hidden /
   * dispose) since the last frame, so the runtime can drop the controller's
   * buffered jump / coyote state on exactly the same triggers.
   */
  private inputCleared = false;
  private readonly inputClearedListeners = new Set<() => void>();
  private disposed = false;

  // ── Fire (left-mouse) state ─────────────────────────────────────────────
  /** Whether the left mouse button is currently held down (while pointer-locked). */
  private fireHeld = false;
  /**
   * Latched true when a left-mouse press edge is detected (pointer-locked).
   * Consumed by {@link consumeFirePressed}. Cleared on input-clear events.
   */
  private firePressed = false;

  // ── Weapon switch / reload key edges ────────────────────────────────────
  /** Latched when key 1 was pressed (assault rifle switch). */
  private weaponSlot1Pressed = false;
  /** Latched when key 2 was pressed (shotgun switch). */
  private weaponSlot2Pressed = false;
  /** Latched when key R was pressed (reload). */
  private reloadPressed = false;

  public constructor(private readonly canvas: HTMLCanvasElement) {
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

  /** True while the canvas currently has browser pointer lock. */
  public isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  /** True while the left mouse button is currently held down (pointer-locked). */
  public isFireHeld(): boolean {
    return this.fireHeld;
  }

  /**
   * The player's **fire intent** for the current simulation tick: true while
   * the left mouse button is held down AND the canvas has pointer lock.
   *
   * This is a *hold* signal (not a per-tick edge) so holding the button
   * produces continuous fire. The shared {@link canFire} cooldown gate —
   * evaluated with the locally-tracked `lastFireSequence` by the prediction
   * layer — decides on each tick whether the held intent actually releases a
   * shot (hold-to-auto-fire semantics). It is zero while pointer lock is not
   * active, matching movement/jump behaviour, so a stale click can never fire
   * after unlock.
   */
  public isFiring(): boolean {
    return this.fireHeld && this.pointerLocked;
  }

  /**
   * Player-local WASD intent: +X is camera-right and -Z is camera-forward.
   * The shared simulation rotates this by the camera yaw into world space.
   * Returns zero while pointer lock is not active.
   */
  public getMovementInput(): LocalMovementInput {
    if (!this.pointerLocked) {
      return { x: 0, z: 0 };
    }

    return {
      x: Number(this.heldCodes.has("KeyD")) - Number(this.heldCodes.has("KeyA")),
      z: Number(this.heldCodes.has("KeyS")) - Number(this.heldCodes.has("KeyW")),
    };
  }

  /**
   * Returns the accumulated mouse movement in pixels since the previous
   * call and resets the accumulator. Multiple mousemove events between
   * frames are summed so no movement is lost; the result is zero while
   * pointer lock is not active.
   */
  public consumeLookDelta(): LookDelta {
    // Snapshot the accumulated values into a fresh object BEFORE clearing the
    // accumulator. `this.lookDelta` is the live accumulator, so returning it
    // directly and then zeroing it would hand the caller the same object that
    // was just reset (always zero). Copying the numbers preserves the
    // accumulated movement while still clearing the accumulator for the next
    // frame.
    const delta = {
      x: this.lookDelta.x,
      y: this.lookDelta.y,
    };
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;

    if (!this.pointerLocked) {
      return { x: 0, y: 0 };
    }

    return delta;
  }

  /**
   * Returns whether a jump key-down edge is pending, and clears the latch.
   *
   * This is polled **once per fixed simulation step** (inside the runtime's
   * fixed-step loop), never per render frame. Polling per step — rather than
   * consuming the edge before the accumulator advances — is what guarantees a
   * press can never be consumed at render-frame time with no step actually
   * running, which was the source of silently-lost jumps. Once polled by a
   * step the press is handed to the shared {@link JumpController}, which
   * buffers/coyote-times it and decides the launch; the browser-level latch
   * here only captures the raw edge.
   */
  public pollJumpPressed(): boolean {
    const wasPressed = this.jumpPressed;
    this.jumpPressed = false;
    return wasPressed;
  }

  /**
   * Returns true if the left mouse button was pressed (fire edge) since the
   * last call, and clears the latch. Edge-triggered like the look delta.
   *
   * The edge is only latched while pointer lock is active, matching the
   * behaviour of movement and jump. The latch is cleared on blur, visibility
   * change, and pointer-lock release (via {@link clearInput}).
   */
  public consumeFirePressed(): boolean {
    const wasPressed = this.firePressed;
    this.firePressed = false;
    return wasPressed;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Weapon key edge polling (key 1, key 2, key R)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Returns true if the key 1 (assault rifle switch) edge is pending,
   * and clears the latch. Only latched while pointer lock is active.
   */
  public consumeWeaponSlot1Pressed(): boolean {
    const wasPressed = this.weaponSlot1Pressed;
    this.weaponSlot1Pressed = false;
    return wasPressed;
  }

  /**
   * Returns true if the key 2 (shotgun switch) edge is pending,
   * and clears the latch. Only latched while pointer lock is active.
   */
  public consumeWeaponSlot2Pressed(): boolean {
    const wasPressed = this.weaponSlot2Pressed;
    this.weaponSlot2Pressed = false;
    return wasPressed;
  }

  /**
   * Returns true if the key R (reload) edge is pending,
   * and clears the latch. Only latched while pointer lock is active.
   */
  public consumeReloadPressed(): boolean {
    const wasPressed = this.reloadPressed;
    this.reloadPressed = false;
    return wasPressed;
  }

  /**
   * Returns whether raw input was cleared since the previous call, then
   * resets the signal. This pull API remains available for callers that only
   * need to inspect the latch; the game runtime uses the synchronous
   * subscription below so hidden-tab render throttling cannot delay safety.
   */
  public consumeInputCleared(): boolean {
    const cleared = this.inputCleared;
    this.inputCleared = false;
    return cleared;
  }

  /**
   * Observe input-clear events synchronously. The game runtime uses this
   * event-driven path to send a neutral authoritative input even when browser
   * rendering is paused or throttled after a blur / hidden-tab transition.
   */
  public subscribeInputCleared(listener: () => void): () => void {
    this.inputClearedListeners.add(listener);
    return () => {
      this.inputClearedListeners.delete(listener);
    };
  }

  /**
   * Requests browser pointer lock on the canvas. Browsers throttle repeated
   * requests for a short time after a release; the resulting rejection is
   * harmless and swallowed. Escape always releases pointer lock through
   * normal browser behaviour.
   *
   * Defined as an arrow-function class field (not a prototype method) so that
   * when it is registered as the canvas `click` listener, `this` stays lexically
   * bound to the InputManager. A normal method would lose `this` when invoked
   * by the DOM as a bare event handler, and the pointer-lock click would fail.
   * Being a single stable field also means `removeEventListener` in `dispose()`
   * receives the exact same function reference that was added.
   */
  private readonly requestPointerLock = (): void => {
    if (this.disposed || this.pointerLocked) {
      return;
    }

    // The Pointer Lock API may be absent (older engines); treat it as a no-op.
    if (typeof this.canvas.requestPointerLock !== "function") {
      return;
    }

    try {
      // Modern browsers return a Promise that rejects on throttle; swallow it.
      const request = this.canvas.requestPointerLock();
      if (request && typeof (request as Promise<void>).catch === "function") {
        (request as Promise<void>).catch(() => undefined);
      }
    } catch {
      // Older engines invoke requestPointerLock synchronously and throw on
      // throttle; nothing to do until the next user gesture.
    }
  };

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.canvas.removeEventListener("click", this.requestPointerLock);
    this.canvas.removeEventListener("mousedown", this.handleMouseDown);
    this.canvas.removeEventListener("mouseup", this.handleMouseUp);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.clearInput);
    window.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener(
      "pointerlockchange",
      this.handlePointerLockChange,
    );
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
    this.clearInput();
    this.disposed = true;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (MOVEMENT_CODES.has(event.code)) {
      this.heldCodes.add(event.code);
    }
    // Jump is an edge (a single key-down), latched only while locked so a
    // stale jump can never fire after unlock. `repeat` key-downs are ignored
    // so holding Space does not produce continuous jumps. The latch is read
    // per fixed simulation step (see pollJumpPressed), not per render frame.
    if (event.code === JUMP_CODE && this.pointerLocked && !event.repeat) {
      this.jumpPressed = true;
    }

    // Weapon switch / reload edges: latched only while pointer-locked and
    // not on key repeat, matching jump/fire edge semantics.
    if (this.pointerLocked && !event.repeat) {
      if (event.code === WEAPON_SLOT_1_CODE) {
        this.weaponSlot1Pressed = true;
      } else if (event.code === WEAPON_SLOT_2_CODE) {
        this.weaponSlot2Pressed = true;
      } else if (event.code === RELOAD_CODE) {
        this.reloadPressed = true;
      }
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.heldCodes.delete(event.code);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.pointerLocked) {
      return;
    }

    this.lookDelta.x += event.movementX;
    this.lookDelta.y += event.movementY;
  };

  /**
   * Left-mouse-down on the canvas. Latches the fire edge only while pointer
   * lock is active, matching movement/jump behaviour.
   */
  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || !this.pointerLocked) {
      return;
    }

    this.fireHeld = true;
    this.firePressed = true;
  };

  /**
   * Left-mouse-up on the canvas. Clears the held state regardless of pointer
   * lock so a stale "held" flag can never persist after unlock.
   */
  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }

    this.fireHeld = false;
  };

  private readonly handlePointerLockChange = (): void => {
    this.pointerLocked =
      document.pointerLockElement === this.canvas;
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
    // Drop any pending jump so an old key-down can't trigger a jump after the
    // pointer is released (blur / Esc / hidden tab). The controller's buffered
    // jump / coyote state is reset separately by the player (it has no access
    // to the input layer).
    this.jumpPressed = false;
    // Drop any pending fire press so a stale left-click can't trigger a shot
    // after the pointer is released (blur / Esc / hidden tab).
    this.fireHeld = false;
    this.firePressed = false;
    // Drop any pending weapon switch / reload edges so a stale key-down can't
    // trigger a weapon action after the pointer is released.
    this.weaponSlot1Pressed = false;
    this.weaponSlot2Pressed = false;
    this.reloadPressed = false;
    // Signal the runtime to drop the controller's buffered jump / coyote state
    // on exactly these triggers, so a stale buffered press can't fire later.
    this.inputCleared = true;
    for (const listener of this.inputClearedListeners) {
      listener();
    }
  };
}
