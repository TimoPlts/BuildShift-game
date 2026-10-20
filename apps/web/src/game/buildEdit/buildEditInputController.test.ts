/**
 * Unit tests for {@link BuildEditInputController} — the presentation-only
 * intent source for piece editing.
 *
 * The controller's event targets are injectable ({@link BuildEditInputEnvironment}),
 * so these tests drive it with a fake event target and a controllable pointer
 * lock / visibility state — no global DOM stubbing, no real browser.
 *
 * Pinned contracts:
 *  - edit intents latch ONLY while the canvas holds pointer lock (mirrors
 *    movement / fire / building input safety);
 *  - `F` toggles edit mode; `Enter` / `C` / `Backspace` latch confirm /
 *    cancel / reset (only while in edit mode);
 *  - the primary-button select state is fed from the routed values
 *    (no mouse listeners of its own): `latchEditSelect` derives the press
 *    edge, the held state, and the release edge;
 *  - releasing pointer lock or hiding the tab drops every latched intent and
 *    exits edit mode.
 */
import { ActionMap } from "../input/actionBindings";
import { afterEach, describe, expect, it } from "vitest";
import {
  BuildEditInputController,
  type BuildEditInputEnvironment,
  type InputEventTarget,
} from "./buildEditInputController";

type Listener = (event: unknown) => void;

class FakeTarget implements InputEventTarget {
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
    this.listeners.get(type)?.forEach((l) => l(event));
  }
}

interface TestEnv extends BuildEditInputEnvironment {
  setLock(element: unknown): void;
  setHidden(hidden: boolean): void;
}

function makeEnv(): { env: TestEnv; targets: Record<string, FakeTarget> } {
  const keyTarget = new FakeTarget();
  const pointerLockTarget = new FakeTarget();
  const visibilityTarget = new FakeTarget();
  let lockElement: unknown = null;
  let hidden = false;
  const env: TestEnv = {
    keyTarget,
    pointerLockTarget,
    visibilityTarget,
    getPointerLockElement: () => lockElement,
    isHidden: () => hidden,
    setLock(element) {
      lockElement = element;
    },
    setHidden(value) {
      hidden = value;
    },
  };
  return {
    env,
    targets: { key: keyTarget, pointerLock: pointerLockTarget, visibility: visibilityTarget },
  };
}

function key(code: string, repeat = false): { code: string; repeat: boolean } {
  return { code, repeat };
}

describe("BuildEditInputController", () => {
  const canvas = {};
  let controller: BuildEditInputController | undefined;

  function setup() {
    const { env, targets } = makeEnv();
    // editCancel is unbound by default; bind it here to cover the latch.
    controller = new BuildEditInputController(canvas as HTMLCanvasElement, env, undefined, new ActionMap({ editCancel: ["KeyC"] }));
    return { env, targets };
  }

  afterEach(() => {
    controller?.dispose();
    controller = undefined;
  });

  it("stays idle until edit mode is toggled on while pointer-locked", () => {
    const { env, targets } = setup();
    env.setLock(canvas);
    expect(controller!.isEditModeActive()).toBe(false);
    targets.key.dispatch("keydown", key("KeyE"));
    expect(controller!.isEditModeActive()).toBe(true);
    targets.key.dispatch("keydown", key("KeyE"));
    expect(controller!.isEditModeActive()).toBe(false);
  });

  it("ignores edit keys while not pointer-locked", () => {
    const { targets } = setup();
    // No pointer lock.
    targets.key.dispatch("keydown", key("KeyE"));
    expect(controller!.isEditModeActive()).toBe(false);
  });

  it("latches confirm / cancel / reset only while in edit mode (polled once each)", () => {
    const { env, targets } = setup();
    env.setLock(canvas);
    // Out of edit mode: the terminal keys are ignored.
    targets.key.dispatch("keydown", key("Enter"));
    targets.key.dispatch("keydown", key("KeyC"));
    targets.key.dispatch("keydown", key("Backspace"));
    expect(controller!.consumeConfirmPressed()).toBe(false);
    expect(controller!.consumeCancelPressed()).toBe(false);
    expect(controller!.consumeResetPressed()).toBe(false);

    targets.key.dispatch("keydown", key("KeyE")); // enter edit mode
    targets.key.dispatch("keydown", key("Enter"));
    targets.key.dispatch("keydown", key("KeyC"));
    targets.key.dispatch("keydown", key("Backspace"));
    expect(controller!.consumeConfirmPressed()).toBe(true);
    expect(controller!.consumeCancelPressed()).toBe(true);
    expect(controller!.consumeResetPressed()).toBe(true);
    // Each latch is one-shot: the next poll has nothing pending.
    expect(controller!.consumeConfirmPressed()).toBe(false);
    expect(controller!.consumeCancelPressed()).toBe(false);
    expect(controller!.consumeResetPressed()).toBe(false);
  });

  it("ignores key auto-repeat", () => {
    const { env, targets } = setup();
    env.setLock(canvas);
    targets.key.dispatch("keydown", key("KeyE")); // enter edit mode
    targets.key.dispatch("keydown", key("Enter"));
    targets.key.dispatch("keydown", key("Enter", true)); // repeat — ignored
    expect(controller!.consumeConfirmPressed()).toBe(true);
    expect(controller!.consumeConfirmPressed()).toBe(false);
  });

  it("derives the select press edge, hold, and release edge from the routed values", () => {
    const { env, targets } = setup();
    env.setLock(canvas);
    controller!.latchEditSelect(false, false);
    // Enter edit mode (F) before feeding routed select state.
    targets.key.dispatch("keydown", key("KeyE"));
    // Press frame: edge + hold.
    controller!.latchEditSelect(true, true);
    expect(controller!.consumeEditSelectPressed()).toBe(true);
    expect(controller!.isEditSelectHeld()).toBe(true);
    expect(controller!.consumeEditSelectReleased()).toBe(false);
    // Hold frames: no edge, still held.
    controller!.latchEditSelect(false, true);
    expect(controller!.consumeEditSelectPressed()).toBe(false);
    expect(controller!.isEditSelectHeld()).toBe(true);
    // Release frame: release edge, no hold.
    controller!.latchEditSelect(false, false);
    expect(controller!.consumeEditSelectReleased()).toBe(true);
    expect(controller!.isEditSelectHeld()).toBe(false);
    expect(controller!.consumeEditSelectReleased()).toBe(false);
  });

  it("feeds no select intent while out of edit mode (button belongs to another layer)", () => {
    const { env, targets } = setup();
    env.setLock(canvas);
    // No edit mode: the routed values are ignored.
    controller!.latchEditSelect(true, true);
    expect(controller!.consumeEditSelectPressed()).toBe(false);
    expect(controller!.isEditSelectHeld()).toBe(false);
    // Entering edit mode afterwards never emits a phantom press or release.
    targets.key.dispatch("keydown", key("KeyE"));
    controller!.latchEditSelect(false, false);
    expect(controller!.consumeEditSelectPressed()).toBe(false);
    expect(controller!.consumeEditSelectReleased()).toBe(false);
    // A fresh press in edit mode works normally.
    controller!.latchEditSelect(true, true);
    expect(controller!.consumeEditSelectPressed()).toBe(true);
  });

  it("exits edit mode and drops latches when pointer lock is released", () => {
    const { env, targets } = setup();
    env.setLock(canvas);
    targets.key.dispatch("keydown", key("KeyE")); // enter edit mode
    targets.key.dispatch("keydown", key("Enter")); // latch confirm
    controller!.latchEditSelect(true, true); // latch select press
    expect(controller!.isEditModeActive()).toBe(true);

    env.setLock(null);
    targets.pointerLock.dispatch("pointerlockchange", {});

    expect(controller!.isEditModeActive()).toBe(false);
    expect(controller!.consumeConfirmPressed()).toBe(false);
    expect(controller!.consumeCancelPressed()).toBe(false);
    expect(controller!.consumeResetPressed()).toBe(false);
    expect(controller!.consumeEditSelectPressed()).toBe(false);
    expect(controller!.isEditSelectHeld()).toBe(false);
  });

  it("drops every intent when the tab is hidden", () => {
    const { env, targets } = setup();
    env.setLock(canvas);
    targets.key.dispatch("keydown", key("KeyE"));
    targets.key.dispatch("keydown", key("KeyC"));
    env.setHidden(true);
    targets.visibility.dispatch("visibilitychange", {});
    expect(controller!.isEditModeActive()).toBe(false);
    expect(controller!.consumeCancelPressed()).toBe(false);
  });

  it("exits edit mode and drops latches on the explicit exitEditMode() call", () => {
    const { env, targets } = setup();
    env.setLock(canvas);
    targets.key.dispatch("keydown", key("KeyE"));
    expect(controller!.isEditModeActive()).toBe(true);
    targets.key.dispatch("keydown", key("Backspace"));
    controller!.exitEditMode();
    expect(controller!.isEditModeActive()).toBe(false);
    expect(controller!.consumeResetPressed()).toBe(false);
  });

  it("latches how edit mode was left: the edit bind again and other binds commit, forced exits discard", () => {
    const { env, targets } = setup();
    env.setLock(canvas);
    expect(controller!.consumeEditExit()).toBeNull();
    targets.key.dispatch("keydown", key("KeyE"));
    targets.key.dispatch("keydown", key("KeyE")); // edit again = confirm
    expect(controller!.isEditModeActive()).toBe(false);
    expect(controller!.consumeEditExit()).toBe("commit");
    expect(controller!.consumeEditExit()).toBeNull();
    for (const code of ["Digit2", "Mouse3", "KeyQ", "Mouse4", "KeyF"]) {
      targets.key.dispatch("keydown", key("KeyE"));
      targets.key.dispatch("keydown", key(code)); // weapon / build bind
      expect(controller!.isEditModeActive(), code).toBe(false);
      expect(controller!.consumeEditExit(), code).toBe("commit");
    }
    targets.key.dispatch("keydown", key("KeyE"));
    controller!.exitEditMode();
    expect(controller!.consumeEditExit()).toBe("discard");
    targets.key.dispatch("keydown", key("KeyE"));
    env.setLock(null);
    targets.pointerLock.dispatch("pointerlockchange", {});
    expect(controller!.consumeEditExit()).toBe("discard");
  });

  it("ignores keys after dispose and removes its listeners", () => {
    const { env, targets } = setup();
    env.setLock(canvas);
    controller!.dispose();
    targets.key.dispatch("keydown", key("KeyE"));
    expect(controller!.isEditModeActive()).toBe(false);
  });
});
