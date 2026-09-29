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

/**
 * Regression test for the pointer-look (POV) turning bug.
 *
 * `InputManager` talks to the global `window` and `document` (plus the canvas
 * it is handed) for its listeners. The Vitest environment is `node`, so those
 * globals are absent; this test installs the smallest possible stand-ins (no
 * full DOM framework) to exercise the real public API of `InputManager`.
 *
 * The bug under test: `consumeLookDelta()` previously returned the *live*
 * accumulator object and then zeroed it, so callers always saw `{0, 0}` even
 * while the player was moving the mouse. These tests pin the contract that
 * must hold: while locked, the accumulated (copied) movement is returned once
 * and the accumulator is cleared; while unlocked, zero is returned and any
 * stale accumulation is wiped on unlock.
 */
describe("InputManager pointer-lock look", () => {
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

  /** Engages pointer lock on the canvas the way the browser reports it. */
  function lockCanvas(): void {
    pointerLockElement = canvas;
    documentTarget.dispatch("pointerlockchange", {});
  }

  /** Releases pointer lock (Esc / blur); the manager must clear input. */
  function unlockCanvas(): void {
    pointerLockElement = null;
    documentTarget.dispatch("pointerlockchange", {});
  }

  function mouseMove(movementX: number, movementY: number): void {
    windowTarget.dispatch("mousemove", { movementX, movementY });
  }

  it("returns the accumulated non-zero look while locked, then zero on the next call", () => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement);
    lockCanvas();
    expect(input.isPointerLocked()).toBe(true);

    mouseMove(12, -5);

    // The accumulated movement is handed to the caller (not zeroed out).
    expect(input.consumeLookDelta()).toEqual({ x: 12, y: -5 });
    // The accumulator must be cleared: a second consume sees no movement.
    expect(input.consumeLookDelta()).toEqual({ x: 0, y: 0 });
  });

  it("accumulates multiple mousemove events between frames", () => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement);
    lockCanvas();

    mouseMove(3, 1);
    mouseMove(4, 2);
    mouseMove(-1, 10);

    // Sum of (3+4-1, 1+2+10) = (6, 13) — no per-frame movement is lost.
    expect(input.consumeLookDelta()).toEqual({ x: 6, y: 13 });
    expect(input.consumeLookDelta()).toEqual({ x: 0, y: 0 });
  });

  it("returns zero look while unlocked, even if mousemove events fire", () => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement);
    expect(input.isPointerLocked()).toBe(false);

    mouseMove(10, 10);

    expect(input.consumeLookDelta()).toEqual({ x: 0, y: 0 });
  });

  it("clears stale accumulation on unlock so re-lock never replays old movement", () => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement);
    lockCanvas();
    mouseMove(20, 20);

    unlockCanvas();

    // The unlock must wipe the accumulator: no stale look is returned.
    expect(input.consumeLookDelta()).toEqual({ x: 0, y: 0 });

    // Re-locking starts clean: only new movement counts from here.
    lockCanvas();
    expect(input.consumeLookDelta()).toEqual({ x: 0, y: 0 });
    mouseMove(1, 2);
    expect(input.consumeLookDelta()).toEqual({ x: 1, y: 2 });
  });
});
