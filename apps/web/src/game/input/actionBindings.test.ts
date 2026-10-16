import { describe, expect, it } from "vitest";
import {
  ActionMap,
  DEFAULT_ACTION_BINDINGS,
  GAME_ACTIONS,
  actionLabel,
  bindingLabel,
  DEFAULT_FLOOR_BINDING,
  MOUSE_BUTTON_4,
  MOUSE_BUTTON_5,
  mouseBindingCode,
  pressedBindingCode,
  attachMouseBindPresses,
} from "./actionBindings";
import { InteractionModeCoordinator } from "./interactionMode";

describe("gameplay action map", () => {
  it("binds every action in the default config (editCancel deliberately unbound)", () => {
    for (const action of GAME_ACTIONS) {
      if (action === "editCancel") continue;
      expect(DEFAULT_ACTION_BINDINGS[action].length, action).toBeGreaterThan(0);
    }
    expect(DEFAULT_ACTION_BINDINGS.editCancel).toEqual([]);
  });

  it("gives every build piece its own dedicated key, distinct from weapons, movement and edit", () => {
    const piece = ["buildWall", "buildFloor", "buildRamp", "buildCone"] as const;
    const others = ["moveForward", "moveBackward", "moveLeft", "moveRight", "jump", "crouch", "weaponSlot1", "weaponSlot2", "edit"] as const;
    const pieceKeys = piece.flatMap((a) => DEFAULT_ACTION_BINDINGS[a]);
    expect(new Set(pieceKeys).size).toBe(pieceKeys.length);
    for (const a of others) for (const code of DEFAULT_ACTION_BINDINGS[a]) expect(pieceKeys, `${a} ${code}`).not.toContain(code);
  });

  it("resolves a code to all of its (contextual) actions", () => {
    const map = new ActionMap();
    expect(map.actionsFor(MOUSE_BUTTON_4)).toEqual(["buildWall"]);
    expect([...map.actionsFor("KeyR")].sort()).toEqual(["buildRotateRight", "reload"]);
    expect([...map.actionsFor("Mouse0")].sort()).toEqual(["editSelect", "primaryAction"]);
    expect(map.actionsFor("KeyP")).toEqual([]);
    expect(map.matches("primaryAction", mouseBindingCode(0))).toBe(true);
    expect(map.matches("primaryAction", mouseBindingCode(2))).toBe(false);
  });

  it("rebinds at runtime (settings-menu hook) and accepts overrides at construction", () => {
    const map = new ActionMap({ buildWall: ["KeyH"] });
    expect(map.actionsFor(MOUSE_BUTTON_4)).toEqual([]);
    expect(map.actionsFor("KeyH")).toEqual(["buildWall"]);
    map.rebind("edit", ["KeyV", "Mouse3"]);
    expect(map.actionsFor("KeyE")).toEqual([]);
    expect(map.actionsFor("KeyV")).toEqual(["edit"]);
    expect(map.bindingsFor("edit")).toEqual(["KeyV", "Mouse3"]);
    expect(map.snapshot().edit).toEqual(["KeyV", "Mouse3"]);
    // The shared defaults are never mutated.
    expect(DEFAULT_ACTION_BINDINGS.edit).toEqual(["KeyE"]);
  });

  it("labels bindings for HUD hints", () => {
    expect(bindingLabel("KeyQ")).toBe("Q");
    expect(bindingLabel("Digit2")).toBe("2");
    expect(bindingLabel("Mouse0")).toBe("LMB");
    expect(bindingLabel(undefined)).toBe("—");
    expect(actionLabel("buildRamp")).toBe("M5");
    expect(actionLabel("buildWall")).toBe("M4");
  });

  it("defaults: Mouse Button 4 → wall, Mouse Button 5 → ramp, F → cone, E → edit (side buttons are DOM buttons 3 / 4)", () => {
    expect([MOUSE_BUTTON_4, MOUSE_BUTTON_5]).toEqual([mouseBindingCode(3), mouseBindingCode(4)]);
    const map = new ActionMap();
    expect(map.actionsFor(mouseBindingCode(3))).toEqual(["buildWall"]);
    expect(map.actionsFor(mouseBindingCode(4))).toEqual(["buildRamp"]);
    expect(map.actionsFor("KeyF")).toEqual(["buildCone"]);
    expect(map.actionsFor("KeyE")).toEqual(["edit"]);
    // Neither side button fires or selects an edit tile (no stray primary).
    for (const code of [MOUSE_BUTTON_4, MOUSE_BUTTON_5]) {
      expect(map.matches("primaryAction", code)).toBe(false);
      expect(map.matches("editSelect", code)).toBe(false);
    }
  });

  it("the floor bind is isolated and never shares a code with movement (A is moveLeft)", () => {
    expect(DEFAULT_ACTION_BINDINGS.buildFloor).toEqual([DEFAULT_FLOOR_BINDING]);
    expect(DEFAULT_ACTION_BINDINGS.moveLeft).toEqual(["KeyA"]);
    expect(DEFAULT_ACTION_BINDINGS.buildFloor).not.toContain("KeyA");
  });

  it("no default code drives two actions except the deliberate contextual pairs", () => {
    const map = new ActionMap();
    const contextual = new Set(["KeyR", "Mouse0"]); // reload/rotate, fire/edit-select
    const codes = new Set(Object.values(DEFAULT_ACTION_BINDINGS).flat());
    for (const code of codes) {
      if (contextual.has(code)) continue;
      expect(map.actionsFor(code), code).toHaveLength(1);
    }
  });

  it("one physical mouse press is reported once, whichever events the browser delivers", () => {
    const listeners = new Map<string, (e: unknown) => void>();
    const target = { addEventListener: (t: string, f: (e: unknown) => void) => listeners.set(t, f), removeEventListener: (t: string) => listeners.delete(t) };
    const presses: string[] = [];
    const releases: string[] = [];
    const detach = attachMouseBindPresses(target, (c) => presses.push(c), (c) => releases.push(c));
    const fire = (type: string, button: number, buttons: number) => listeners.get(type)!({ type, button, buttons, pointerType: type.startsWith("pointer") ? "mouse" : undefined });
    // pointerdown + compatibility mousedown → one press.
    fire("pointerdown", 3, 8); fire("mousedown", 3, 8); fire("mouseup", 3, 0); fire("pointerup", 3, 0);
    // mousedown only (pointerdown not seen) → one press.
    fire("mousedown", 4, 16); fire("mouseup", 4, 0);
    // Chorded: LMB held (turbo), then Mouse Button 4 arrives as a pointermove.
    fire("pointerdown", 0, 1); fire("pointermove", 3, 9); fire("mousedown", 3, 9); fire("pointermove", 3, 1); fire("pointerup", 0, 0);
    // Plain moves while held never re-press.
    fire("pointermove", -1, 0);
    expect(presses).toEqual(["Mouse3", "Mouse4", "Mouse0", "Mouse3"]);
    expect(releases).toEqual(["Mouse3", "Mouse4", "Mouse3", "Mouse0"]);
    detach();
    expect(listeners.size).toBe(0);
  });

  it("key and mouse presses resolve to binding codes through one path", () => {
    expect(pressedBindingCode({ type: "keydown", code: "KeyF", repeat: false })).toBe("KeyF");
    expect(pressedBindingCode({ type: "keydown", code: "KeyF", repeat: true })).toBeNull(); // auto-repeat
    expect(pressedBindingCode({ type: "mousedown", button: 3 })).toBe(MOUSE_BUTTON_4);
    expect(pressedBindingCode({ type: "mousedown", button: 4 })).toBe(MOUSE_BUTTON_5);
    expect(pressedBindingCode({ type: "mouseup", button: 3 })).toBeNull();
    expect(pressedBindingCode(null)).toBeNull();
  });
});

describe("interaction mode coordinator — direct transitions and edit exits", () => {
  it("piece binds enter build from weapon or edit; weapon binds return to weapon from anywhere", () => {
    const m = new InteractionModeCoordinator();
    m.selectBuild();
    expect(m.mode).toBe("build");
    m.selectWeapon();
    expect(m.mode).toBe("weapon");
    m.toggleEdit();
    m.selectBuild();
    expect(m.mode).toBe("build");
    expect(m.consumeEditExit()).toBe("commit");
    m.toggleEdit();
    m.selectWeapon();
    expect(m.mode).toBe("weapon");
    expect(m.consumeEditExit()).toBe("commit");
  });

  it("the edit bind again commits back to the layer beneath", () => {
    const m = new InteractionModeCoordinator();
    m.selectBuild();
    m.toggleEdit();
    expect(m.mode).toBe("edit");
    m.toggleEdit();
    expect(m.mode).toBe("build");
    expect(m.consumeEditExit()).toBe("commit");
    expect(m.consumeEditExit()).toBeNull();
  });

  it("forced exits discard, and a later commit never overrides a discard in the same frame", () => {
    const m = new InteractionModeCoordinator();
    m.toggleEdit();
    m.clearAll();
    expect(m.mode).toBe("weapon");
    expect(m.consumeEditExit()).toBe("discard");
    m.toggleEdit();
    m.clearEdit();
    m.toggleEdit();
    m.exitToWeapon();
    // discard (first session) then a fresh session that committed: the fresh
    // session's entry cleared the latch, so its commit is what remains.
    expect(m.consumeEditExit()).toBe("commit");
    // Leaving when not editing records nothing.
    m.selectWeapon();
    m.clearAll();
    expect(m.consumeEditExit()).toBeNull();
  });
});
