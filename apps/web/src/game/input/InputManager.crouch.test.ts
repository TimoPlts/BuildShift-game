/**
 * Behavioral tests for the crouch input hook ({@link InputManager.isCrouchHeld}).
 *
 * Crouch (KeyC) is tracked exactly like the WASD movement keys: recorded when
 * the key is pressed, reported only while the pointer is locked, and cleared
 * on key-up, blur, or pointer-unlock. It never appears in the movement-vector
 * payload — it travels in its own protocol field.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InputManager } from "./InputManager";

type Listener = (event: unknown) => void;

/** Minimal EventTarget stand-in: records listeners and can dispatch to them. */
class FakeEventTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    let bucket = this.listeners.get(type);
    if (!bucket) {
      bucket = new Set<Listener>();
      this.listeners.set(type, bucket);
    }
    bucket.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: unknown): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

describe("InputManager crouch", () => {
  let canvas: FakeEventTarget;
  let windowTarget: FakeEventTarget;
  let documentTarget: FakeEventTarget;
  let pointerLockElement: unknown;
  let input: InputManager | undefined;

  beforeEach(() => {
    canvas = new FakeEventTarget();
    windowTarget = new FakeEventTarget();
    documentTarget = new FakeEventTarget();
    pointerLockElement = null;

    const documentStub = {
      hidden: false,
      get pointerLockElement(): unknown {
        return pointerLockElement;
      },
      addEventListener: documentTarget.addEventListener.bind(documentTarget),
      removeEventListener:
        documentTarget.removeEventListener.bind(documentTarget),
    };
    const windowStub = {
      addEventListener: windowTarget.addEventListener.bind(windowTarget),
      removeEventListener:
        windowTarget.removeEventListener.bind(windowTarget),
    };
    (globalThis as unknown as { window: unknown }).window = windowStub;
    (globalThis as unknown as { document: unknown }).document = documentStub;
  });

  afterEach(() => {
    input?.dispose();
    input = undefined;
  });

  function lockCanvas(): void {
    pointerLockElement = canvas;
    documentTarget.dispatch("pointerlockchange", {});
  }

  function unlockCanvas(): void {
    pointerLockElement = null;
    documentTarget.dispatch("pointerlockchange", {});
  }

  function keyDown(code: string): void {
    windowTarget.dispatch("keydown", { code, repeat: false });
  }

  function keyUp(code: string): void {
    windowTarget.dispatch("keyup", { code });
  }

  it("reports crouch held while C is pressed and the pointer is locked", () => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement);
    lockCanvas();

    expect(input.isCrouchHeld()).toBe(false);
    keyDown("KeyC");
    expect(input.isCrouchHeld()).toBe(true);
    // Still held on subsequent reads while the key stays down.
    expect(input.isCrouchHeld()).toBe(true);
    keyUp("KeyC");
    expect(input.isCrouchHeld()).toBe(false);
  });

  it("does not report crouch while unlocked even if C is pressed", () => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement);

    // Pressed before locking: recorded, but not active until locked.
    keyDown("KeyC");
    expect(input.isCrouchHeld()).toBe(false);

    lockCanvas();
    expect(input.isCrouchHeld()).toBe(true);

    keyUp("KeyC");
    expect(input.isCrouchHeld()).toBe(false);
  });

  it("clears the held crouch on pointer unlock", () => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement);
    lockCanvas();
    keyDown("KeyC");
    expect(input.isCrouchHeld()).toBe(true);

    unlockCanvas();
    expect(input.isCrouchHeld()).toBe(false);
  });

  it("crouch is independent of the movement vector", () => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement);
    lockCanvas();
    keyDown("KeyC");
    // Crouching without moving reports no movement direction.
    expect(input.getMovementInput()).toEqual({ x: 0, z: 0 });
    expect(input.isCrouchHeld()).toBe(true);
  });
});
