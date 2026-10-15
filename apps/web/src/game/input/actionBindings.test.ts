import { describe, expect, it } from "vitest";
import {
  ActionMap,
  DEFAULT_ACTION_BINDINGS,
  GAME_ACTIONS,
  actionLabel,
  bindingLabel,
  mouseBindingCode,
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
    expect(map.actionsFor("KeyQ")).toEqual(["buildWall"]);
    expect([...map.actionsFor("KeyR")].sort()).toEqual(["buildRotateRight", "reload"]);
    expect([...map.actionsFor("Mouse0")].sort()).toEqual(["editSelect", "primaryAction"]);
    expect(map.actionsFor("KeyP")).toEqual([]);
    expect(map.matches("primaryAction", mouseBindingCode(0))).toBe(true);
    expect(map.matches("primaryAction", mouseBindingCode(2))).toBe(false);
  });

  it("rebinds at runtime (settings-menu hook) and accepts overrides at construction", () => {
    const map = new ActionMap({ buildWall: ["Mouse4"] });
    expect(map.actionsFor("KeyQ")).toEqual([]);
    expect(map.actionsFor("Mouse4")).toEqual(["buildWall"]);
    map.rebind("edit", ["KeyV", "Mouse3"]);
    expect(map.actionsFor("KeyG")).toEqual([]);
    expect(map.actionsFor("KeyV")).toEqual(["edit"]);
    expect(map.bindingsFor("edit")).toEqual(["KeyV", "Mouse3"]);
    expect(map.snapshot().edit).toEqual(["KeyV", "Mouse3"]);
    // The shared defaults are never mutated.
    expect(DEFAULT_ACTION_BINDINGS.edit).toEqual(["KeyG"]);
  });

  it("labels bindings for HUD hints", () => {
    expect(bindingLabel("KeyQ")).toBe("Q");
    expect(bindingLabel("Digit2")).toBe("2");
    expect(bindingLabel("Mouse0")).toBe("LMB");
    expect(bindingLabel(undefined)).toBe("—");
    expect(actionLabel("buildRamp")).toBe("E");
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
