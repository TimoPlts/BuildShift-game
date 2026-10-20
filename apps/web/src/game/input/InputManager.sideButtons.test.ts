/**
 * Side mouse buttons (Mouse Button 4 / 5 = DOM buttons 3 / 4) are build binds:
 * while the game holds pointer lock their browser back/forward default is
 * cancelled, they never fire the weapon, and they reach the action map like
 * any key (rebindable).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InputManager } from "./InputManager";
import { ActionMap } from "./actionBindings";

type Listener = (event: unknown) => void;
class Target {
  private readonly l = new Map<string, Set<Listener>>();
  addEventListener(t: string, f: Listener) { (this.l.get(t) ?? this.l.set(t, new Set()).get(t)!).add(f); }
  removeEventListener(t: string, f: Listener) { this.l.get(t)?.delete(f); }
  dispatch(t: string, e: unknown) { this.l.get(t)?.forEach((f) => f(e)); }
  count(t: string) { return this.l.get(t)?.size ?? 0; }
}

describe("InputManager side mouse buttons", () => {
  let win: Target;
  let doc: Target;
  let canvas: Target;
  let lockElement: unknown;
  let input: InputManager;

  const mouse = (type: string, button: number, target: unknown = canvas) => {
    const event = { type, button, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    win.dispatch(type, event);
    if (type === "mousedown" || type === "mouseup") canvas.dispatch(type, event);
    return event;
  };

  const create = (actions?: ActionMap) => {
    input = new InputManager(canvas as unknown as HTMLCanvasElement, actions);
  };
  beforeEach(() => {
    win = new Target(); doc = new Target(); canvas = new Target(); lockElement = null;
    (globalThis as any).window = { addEventListener: win.addEventListener.bind(win), removeEventListener: win.removeEventListener.bind(win) };
    (globalThis as any).document = { hidden: false, get pointerLockElement() { return lockElement; }, addEventListener: doc.addEventListener.bind(doc), removeEventListener: doc.removeEventListener.bind(doc) };
    create();
  });
  afterEach(() => input.dispose());

  const lock = () => { lockElement = canvas; doc.dispatch("pointerlockchange", {}); };

  it("cancels back/forward navigation for buttons 3 and 4 while pointer-locked (down, up, auxclick)", () => {
    lock();
    for (const button of [3, 4]) for (const type of ["mousedown", "mouseup", "auxclick"]) {
      expect(mouse(type, button, null).defaultPrevented, `${type} ${button}`).toBe(true);
    }
    // The primary / secondary buttons keep their defaults.
    expect(mouse("mousedown", 0, null).defaultPrevented).toBe(false);
    expect(mouse("mouseup", 2, null).defaultPrevented).toBe(false);
  });

  it("also cancels a side-button press aimed at the game canvas before lock; leaves other page elements alone", () => {
    expect(mouse("mouseup", 3, canvas).defaultPrevented).toBe(true);
    expect(mouse("mouseup", 3, { tagName: "BUTTON" }).defaultPrevented).toBe(false);
  });

  it("side buttons never fire the weapon", () => {
    lock();
    mouse("mousedown", 3);
    mouse("mousedown", 4);
    expect(input.isFireHeld()).toBe(false);
    expect(input.consumeFirePressed()).toBe(false);
    mouse("mouseup", 3);
    mouse("mouseup", 4);
    mouse("mousedown", 0);
    expect(input.isFireHeld()).toBe(true);
  });

  it("a mouse bind drives its action like a key (here a rebound jump on Mouse Button 4)", () => {
    input.dispose();
    create(new ActionMap({ jump: ["Mouse3"], buildWall: [] }));
    lock();
    mouse("mousedown", 3);
    expect(input.pollJumpPressed()).toBe(true);
    mouse("mouseup", 3);
    expect(input.pollJumpPressed()).toBe(false);
  });

  it("the right mouse button (edit reset) opens no context menu during gameplay and never fires", () => {
    lock();
    const menu = { type: "contextmenu", button: 2, target: null, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    win.dispatch("contextmenu", menu);
    expect(menu.defaultPrevented).toBe(true);
    mouse("mousedown", 2);
    expect(input.isFireHeld()).toBe(false);
    expect(input.consumeFirePressed()).toBe(false);
    mouse("mouseup", 2);
    expect(input.isPointerLocked()).toBe(true); // RMB never releases the lock
  });

  it("outside gameplay (no lock, not the canvas) the context menu is left alone", () => {
    const menu = { type: "contextmenu", button: 2, target: { tagName: "DIV" }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    win.dispatch("contextmenu", menu);
    expect(menu.defaultPrevented).toBe(false);
  });

  it("removes the navigation guards on dispose", () => {
    expect([win.count("auxclick"), win.count("contextmenu")]).toEqual([1, 1]);
    input.dispose();
    expect([win.count("auxclick"), win.count("contextmenu")]).toEqual([0, 0]);
    create();
  });
});
