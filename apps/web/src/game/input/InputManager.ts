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
      return { x: 0, z: 0 };
    }
    return {
      x: Number(this.heldCodes.has("KeyD")) - Number(this.heldCodes.has("KeyA")),
      z: Number(this.heldCodes.has("KeyS")) - Number(this.heldCodes.has("KeyW")),
    };
  }

  public consumeLookDelta(): LookDelta {
    const delta = { x: this.lookDelta.x, y: this.lookDelta.y };
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    if (!this.pointerLocked) {
      return { x: 0, y: 0 };
    }
    return delta;
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
    try {
      const request = this.canvas.requestPointerLock();
      if (request && typeof (request as Promise<void>).catch === "function") {
        (request as Promise<void>).catch(() => undefined);
      }
    } catch {
      // Older engines: nothing to do.
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
    if (MOVEMENT_CODES.has(event.code)) {
      this.heldCodes.add(event.code);
    }
    if (event.code === JUMP_CODE && this.pointerLocked && !event.repeat) {
      this.jumpPressed = true;
    }
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
    if (!this.pointerLocked) return;
    this.lookDelta.x += event.movementX;
    this.lookDelta.y += event.movementY;
  };

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || !this.pointerLocked) return;
    this.fireHeld = true;
    this.firePressed = true;
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    this.fireHeld = false;
  };

  private readonly handlePointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
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
