/**
 * Gameplay-input suppression seam — while game UI (e.g. the AI Guide chat
 * input) owns the keyboard, `InputManager` must record no gameplay input at
 * all, and restoring the flag must resume normal capture with no replayed or
 * stuck state.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InputManager } from "./InputManager";

type Listener = (event: unknown) => void;

/** Minimal EventTarget stand-in (mirrors InputManager.test.ts). */
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

describe("InputManager — gameplay-input suppression (UI focus seam)", () => {
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
      removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
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

  it("records no gameplay keys while suppressed, even under pointer lock", () => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement);
    lockCanvas();

    input.setGameplayInputSuppressed(true);
    expect(input.isGameplayInputSuppressed()).toBe(true);

    // Movement: typing "W" into the chat must not move the player.
    windowTarget.dispatch("keydown", { code: "KeyW", repeat: false });
    expect(input.getMovementInput()).toEqual({ x: 0, z: 0 });
    expect(input.isActionHeld("moveForward")).toBe(false);

    // Edges: jump / weapon switch / reload never latch.
    windowTarget.dispatch("keydown", { code: "Space", repeat: false });
    windowTarget.dispatch("keydown", { code: "Digit1", repeat: false });
    windowTarget.dispatch("keydown", { code: "KeyR", repeat: false });
    expect(input.pollJumpPressed()).toBe(false);
    expect(input.consumeWeaponSlot1Pressed()).toBe(false);
    expect(input.consumeReloadPressed()).toBe(false);

    // The suppressed key never ends up in the held set.
    windowTarget.dispatch("keyup", { code: "KeyW" });
    expect(input.isActionHeld("moveForward")).toBe(false);
  });

  it("clears held keys captured just before suppression started", () => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement);
    lockCanvas();

    // Player holds forward while locked, then the chat input takes focus.
    windowTarget.dispatch("keydown", { code: "KeyW", repeat: false });
    expect(input.getMovementInput()).toEqual({ x: 0, z: -1 });

    input.setGameplayInputSuppressed(true);
    expect(input.getMovementInput()).toEqual({ x: 0, z: 0 });
  });

  it("suppresses mouse binds and the primary-action press while focused", () => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement);
    lockCanvas();

    input.setGameplayInputSuppressed(true);

    canvas.dispatch("mousedown", { button: 0, preventDefault: () => {} }); // fire
    canvas.dispatch("mouseup", { button: 0, preventDefault: () => {} });
    windowTarget.dispatch("mousedown", { button: 3, preventDefault: () => {} }); // build wall bind
    expect(input.consumeFirePressed()).toBe(false);
    expect(input.isFireHeld()).toBe(false);
    expect(input.isActionHeld("buildWall")).toBe(false);
  });

  it("restores normal capture after the input blurs (no replay, no stuck state)", () => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement);
    lockCanvas();

    input.setGameplayInputSuppressed(true);
    windowTarget.dispatch("keydown", { code: "KeyW", repeat: false });
    expect(input.getMovementInput()).toEqual({ x: 0, z: 0 });

    input.setGameplayInputSuppressed(false);
    expect(input.isGameplayInputSuppressed()).toBe(false);

    // Nothing is replayed: the previously-typed "W" does not move the player.
    expect(input.getMovementInput()).toEqual({ x: 0, z: 0 });

    // New input works again.
    windowTarget.dispatch("keydown", { code: "KeyW", repeat: false });
    expect(input.getMovementInput()).toEqual({ x: 0, z: -1 });
    windowTarget.dispatch("keydown", { code: "Space", repeat: false });
    expect(input.pollJumpPressed()).toBe(true);
  });

  it("is a no-op when toggled to the same state (no spurious input clear)", () => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement);
    lockCanvas();

    windowTarget.dispatch("keydown", { code: "KeyW", repeat: false });
    expect(input.getMovementInput()).toEqual({ x: 0, z: -1 });

    // Re-applying the same suppression state must not clear captured input.
    input.setGameplayInputSuppressed(false);
    input.setGameplayInputSuppressed(false);
    expect(input.getMovementInput()).toEqual({ x: 0, z: -1 });
  });
});
