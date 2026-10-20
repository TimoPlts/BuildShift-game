/**
 * Stale-edge lifecycle (overhaul task 12) — driven through the REAL
 * `InputManager` latch semantics with the runtime's new per-frame contract:
 *
 *   edge = input.consumeFirePressed() && connected && inRound
 *   held = input.isFiring() && connected && inRound
 *
 * The fire press, weapon-slot presses, and reload press latches are
 * consumed EVERY frame (unconditionally), while the ACTIONS are gated on
 * the round/phase + connection. The contract these tests pin:
 *
 *  - a fire press during the COUNTDOWN phase produces NO shot when the
 *    round starts (the edge was consumed and dropped; only the HELD state
 *    — the live mouse-button state — persists into the round);
 *  - a fire press while DISCONNECTED produces no stale shot on reconnect;
 *  - a Digit2 press during the countdown produces no stale weapon switch on
 *    round start (the slot latch is drained every frame);
 *  - the "hold fire through the countdown" behaviour is preserved: the held
 *    read is true the moment the round starts, so firing begins without a
 *    re-click — but the discarded edge never double-fires.
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
      bucket = new Set();
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

describe("InputManager stale-edge lifecycle (per-frame drain contract)", () => {
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

  /**
   * One runtime render frame under the new contract: every edge is consumed
   * unconditionally; the gated values are what the actions may use.
   */
  function runtimeFrame(connected: boolean, inRound: boolean) {
    const i = input as InputManager;
    return {
      fireEdge: i.consumeFirePressed() && connected && inRound,
      fireHeld: i.isFiring() && connected && inRound,
      slot1: i.consumeWeaponSlot1Pressed() && connected && inRound,
      slot2: i.consumeWeaponSlot2Pressed() && connected && inRound,
      reload: i.consumeReloadPressed() && connected && inRound,
    };
  }

  function mouseDown(): void {
    canvas.dispatch("mousedown", { button: 0 });
  }

  it("a fire press during countdown leaves no stale shot when the round starts", () => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement);
    lockCanvas();

    // COUNTDOWN frame: the player clicks fire. The edge is consumed (and
    // dropped — not in the round) and must not survive to the next frame.
    mouseDown();
    const countdownFrame = runtimeFrame(true, false);
    expect(countdownFrame.fireEdge).toBe(false);

    // ROUND START frame (button still held): no stale edge ...
    const startFrame = runtimeFrame(true, true);
    expect(startFrame.fireEdge).toBe(false);
    // ... but the HELD state persists, so firing starts from the hold —
    // "hold fire through the countdown" is preserved without a re-click.
    expect(startFrame.fireHeld).toBe(true);
  });

  it("a fire press while disconnected leaves no stale shot on reconnect", () => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement);
    lockCanvas();

    mouseDown();
    const offlineFrame = runtimeFrame(false, true);
    expect(offlineFrame.fireEdge).toBe(false);
    expect(offlineFrame.fireHeld).toBe(false);

    // Reconnect, still holding: the edge was already drained ...
    const reconnectFrame = runtimeFrame(true, true);
    expect(reconnectFrame.fireEdge).toBe(false);
    // ... while the live hold resumes immediately.
    expect(reconnectFrame.fireHeld).toBe(true);
  });

  it("a Digit2 press during countdown leaves no stale weapon switch on round start", () => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement);
    lockCanvas();

    windowTarget.dispatch("keydown", { code: "Digit2", repeat: false });
    const countdownFrame = runtimeFrame(true, false);
    expect(countdownFrame.slot2).toBe(false);

    const startFrame = runtimeFrame(true, true);
    expect(startFrame.slot2).toBe(false); // drained — no stale switch
  });

  it("a reload press while disconnected leaves no stale reload on reconnect", () => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement);
    lockCanvas();

    windowTarget.dispatch("keydown", { code: "KeyR", repeat: false });
    const offlineFrame = runtimeFrame(false, true);
    expect(offlineFrame.reload).toBe(false);

    const reconnectFrame = runtimeFrame(true, true);
    expect(reconnectFrame.reload).toBe(false); // drained — no stale reload
  });

  it("a fresh press in-round still fires exactly one edge", () => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement);
    lockCanvas();

    mouseDown();
    const first = runtimeFrame(true, true);
    expect(first.fireEdge).toBe(true);
    const second = runtimeFrame(true, true);
    expect(second.fireEdge).toBe(false); // the edge is single-shot
    expect(second.fireHeld).toBe(true); // the hold persists
  });
});
