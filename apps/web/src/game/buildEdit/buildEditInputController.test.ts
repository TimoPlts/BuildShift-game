/**
 * Unit tests for {@link BuildEditInputController} — the presentation-only
 * keyboard intent source for build editing.
 *
 * The controller's event targets are injectable ({@link BuildEditInputEnvironment}),
 * so these tests drive it with a fake event target and a controllable pointer
 * lock / visibility state — no global DOM stubbing, no real browser.
 *
 * Pinned contracts:
 *  - edit intents latch ONLY while the canvas holds pointer lock (mirrors
 *    movement / fire / building input safety);
 *  - `F` toggles edit mode; `5`–`9` latch a chosen edit; `Enter` latches an
 *    apply press (apply + edit choices only while in edit mode);
 *  - releasing pointer lock or hiding the tab drops every latched intent and
 *    exits edit mode.
 */
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
    controller = new BuildEditInputController(canvas as HTMLCanvasElement, env);
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
    targets.key.dispatch("keydown", key("KeyF"));
    expect(controller!.isEditModeActive()).toBe(true);
    targets.key.dispatch("keydown", key("KeyF"));
    expect(controller!.isEditModeActive()).toBe(false);
  });

  it("ignores edit keys while not pointer-locked", () => {
    const { targets } = setup();
    // No pointer lock.
    targets.key.dispatch("keydown", key("KeyF"));
    expect(controller!.isEditModeActive()).toBe(false);
  });

  it("latches an edit choice only while in edit mode (polled once per frame)", () => {
    const { env, targets } = setup();
    env.setLock(canvas);
    targets.key.dispatch("keydown", key("KeyF")); // enter edit mode
    expect(controller!.consumeEditSelection()).toBeNull();
    targets.key.dispatch("keydown", key("Digit5"));
    expect(controller!.consumeEditSelection()).toBe("door");
    // The latch is one-shot: the next poll has nothing pending.
    expect(controller!.consumeEditSelection()).toBeNull();
  });

  it("does not latch an edit choice while out of edit mode", () => {
    const { env, targets } = setup();
    env.setLock(canvas);
    targets.key.dispatch("keydown", key("Digit5"));
    expect(controller!.consumeEditSelection()).toBeNull();
  });

  it("latches an apply press only while in edit mode", () => {
    const { env, targets } = setup();
    env.setLock(canvas);
    targets.key.dispatch("keydown", key("Enter"));
    expect(controller!.consumeApplyPressed()).toBe(false);

    targets.key.dispatch("keydown", key("KeyF")); // enter edit mode
    targets.key.dispatch("keydown", key("Enter"));
    expect(controller!.consumeApplyPressed()).toBe(true);
    expect(controller!.consumeApplyPressed()).toBe(false);
  });

  it("ignores key auto-repeat", () => {
    const { env, targets } = setup();
    env.setLock(canvas);
    targets.key.dispatch("keydown", key("KeyF")); // enter edit mode
    targets.key.dispatch("keydown", key("Digit5"));
    targets.key.dispatch("keydown", key("Digit5", true)); // repeat — ignored
    expect(controller!.consumeEditSelection()).toBe("door");
    expect(controller!.consumeEditSelection()).toBeNull();
  });

  it("exits edit mode and drops latches when pointer lock is released", () => {
    const { env, targets } = setup();
    env.setLock(canvas);
    targets.key.dispatch("keydown", key("KeyF")); // enter edit mode
    targets.key.dispatch("keydown", key("Digit6")); // latch window
    targets.key.dispatch("keydown", key("Enter")); // latch apply
    expect(controller!.isEditModeActive()).toBe(true);

    env.setLock(null);
    targets.pointerLock.dispatch("pointerlockchange", {});

    expect(controller!.isEditModeActive()).toBe(false);
    expect(controller!.consumeEditSelection()).toBeNull();
    expect(controller!.consumeApplyPressed()).toBe(false);
  });

  it("drops every intent when the tab is hidden", () => {
    const { env, targets } = setup();
    env.setLock(canvas);
    targets.key.dispatch("keydown", key("KeyF"));
    targets.key.dispatch("keydown", key("Digit7"));
    env.setHidden(true);
    targets.visibility.dispatch("visibilitychange", {});
    expect(controller!.isEditModeActive()).toBe(false);
    expect(controller!.consumeEditSelection()).toBeNull();
  });

  it("exits edit mode on the explicit exitEditMode() call", () => {
    const { env, targets } = setup();
    env.setLock(canvas);
    targets.key.dispatch("keydown", key("KeyF"));
    expect(controller!.isEditModeActive()).toBe(true);
    controller!.exitEditMode();
    expect(controller!.isEditModeActive()).toBe(false);
  });

  it("ignores keys after dispose and removes its listeners", () => {
    const { env, targets } = setup();
    env.setLock(canvas);
    controller!.dispose();
    targets.key.dispatch("keydown", key("KeyF"));
    expect(controller!.isEditModeActive()).toBe(false);
  });
});
