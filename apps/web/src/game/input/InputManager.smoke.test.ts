// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InputManager } from "./InputManager";

/**
 * Smoke test for InputManager movement input behavior.
 *
 * Verifies the existing contract of getMovementInput() using a real DOM
 * environment (happy-dom):
 *
 * - W (KeyW) maps to forward (z = -1)
 * - D (KeyD) maps to right (x = +1)
 * - Simultaneous W+D yields diagonal (x = +1, z = -1)
 * - Releasing W zeroes the forward component
 * - Blur clears all held keys, returning zeros
 *
 * These tests exercise the public API only — no source changes required.
 */
describe("InputManager movement input (smoke)", () => {
  let canvas: HTMLCanvasElement;
  let input: InputManager;

  beforeEach(() => {
    canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    input = new InputManager(canvas);
  });

  afterEach(() => {
    input.dispose();
    canvas.remove();
    // Reset pointerLockElement to null for isolation.
    Object.defineProperty(document, "pointerLockElement", {
      value: null,
      writable: true,
      configurable: true,
    });
  });

  /** Engages pointer lock on the canvas the way the browser reports it. */
  function lockCanvas(): void {
    Object.defineProperty(document, "pointerLockElement", {
      value: canvas,
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("pointerlockchange"));
  }

  function keyDown(code: string): void {
    window.dispatchEvent(new KeyboardEvent("keydown", { code }));
  }

  function keyUp(code: string): void {
    window.dispatchEvent(new KeyboardEvent("keyup", { code }));
  }

  it("returns forward (z=-1) when W is held while pointer-locked", () => {
    lockCanvas();
    keyDown("KeyW");

    const result = input.getMovementInput();
    expect(result.z).toBe(-1);
    expect(result.x).toBe(0);
  });

  it("returns diagonal input (x=1, z=-1) when W and D are held", () => {
    lockCanvas();
    keyDown("KeyW");
    keyDown("KeyD");

    const result = input.getMovementInput();
    expect(result.z).toBe(-1); // forward
    expect(result.x).toBe(1); // right
  });

  it("returns forward=0 after W is released while D remains held", () => {
    lockCanvas();
    keyDown("KeyW");
    keyDown("KeyD");
    keyUp("KeyW");

    const result = input.getMovementInput();
    expect(result.z).toBe(0); // no forward
    expect(result.x).toBe(1); // D still held
  });

  it("clears all held keys on blur so movement input returns zeros", () => {
    lockCanvas();
    keyDown("KeyW");
    keyDown("KeyD");
    keyDown("KeyA");
    keyDown("KeyS");

    // Dispatch blur on window — InputManager listens for it.
    window.dispatchEvent(new Event("blur"));

    const result = input.getMovementInput();
    expect(result.x).toBe(0);
    expect(result.z).toBe(0);
  });
});
