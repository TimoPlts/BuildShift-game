import type { LocalMovementInput } from "@buildshift/simulation";

const MOVEMENT_CODES = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);
const JUMP_CODE = "Space";

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
  /** Latched the most recent jump key-down edge; consumed per update tick. */
  private jumpRequested = false;
  private pointerLocked = false;
  private disposed = false;

  public constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.addEventListener("click", this.requestPointerLock);
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
    const delta = this.lookDelta;
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;

    if (!this.pointerLocked) {
      return { x: 0, y: 0 };
    }

    return delta;
  }

  /**
   * Returns whether a jump was requested since the previous call, then clears
   * the latch. The runtime consumes this once per update tick so a single
   * Space press produces at most one jump even if the key is still held.
   */
  public consumeJumpRequested(): boolean {
    const wasRequested = this.jumpRequested;
    this.jumpRequested = false;
    return wasRequested;
  }

  /**
   * Requests browser pointer lock on the canvas. Browsers throttle repeated
   * requests for a short time after a release; the resulting rejection is
   * harmless and swallowed. Escape always releases pointer lock through
   * normal browser behaviour.
   */
  public requestPointerLock(): void {
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
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.canvas.removeEventListener("click", this.requestPointerLock);
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
    // so holding Space does not produce continuous jumps.
    if (event.code === JUMP_CODE && this.pointerLocked && !event.repeat) {
      this.jumpRequested = true;
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
    // Drop any in-flight jump so an old key-down can't trigger a jump after
    // the pointer is released (blur / Esc / hidden tab).
    this.jumpRequested = false;
  };
}

