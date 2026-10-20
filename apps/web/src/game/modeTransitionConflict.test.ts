/**
 * Mode-transition lifecycle tests for the competitive control scheme.
 *
 * Wires the PRODUCTION components exactly the way the GameRuntime does — one
 * shared {@link InteractionModeCoordinator} threaded into BOTH the building
 * system and the build-edit system, default action bindings — and simulates
 * the runtime's per-frame contract:
 *
 *   route = routePrimaryAction(build, edit, fireEdge, fireHeld)   [gated]
 *   weapon actions     only in effective weapon mode + IN_PROGRESS
 *   updateBuildingFrame(connected, inRound, buildPlaceHeld | press)
 *   updateBuildEditFrame(route.editSelect*)
 *
 * Pinned (default binds: Mouse Button 4 wall, Q floor (temporary), Mouse
 * Button 5 ramp, F cone, E edit, T reset, 1/2 weapons, R reload / rotate —
 * side buttons arrive as real `mousedown` events with DOM buttons 3 / 4):
 *
 *  - dedicated build binds: one key goes weapon → building with that piece,
 *    no mode key first; switching pieces keeps turbo placing while the
 *    primary stays held (no release needed);
 *  - the competitive flow wall → ramp → edit (drag) → shotgun (commits the
 *    edit) → shoot → edit → reset → confirm works without any action
 *    firing, placing, or editing in the wrong mode;
 *  - rapid weapon → wall → weapon → ramp → edit alternation loses no input
 *    and leaves no stray action; R reloads only in weapon mode and rotates
 *    only while building;
 *  - no duplicate listeners, no stale edges, pointer unlock discards.
 */
import { describe, expect, it } from "vitest";
import { BUILD_EVENTS, type StructureState } from "@buildshift/protocol";
import {
  BuildingController,
  PLACEMENT_REQUEST_INTERVAL_MS,
} from "./building/buildingController";
import {
  BuildingInputController,
  type BuildingInputEnvironment,
  type InputEventTarget,
} from "./building/buildingInputController";
import { BuildingStateStore } from "./building/buildingStateStore";
import {
  BuildEditController,
  EDIT_GRID_ACTION_MESSAGE,
} from "./buildEdit/buildEditController";
import {
  BuildEditInputController,
  type BuildEditInputEnvironment,
} from "./buildEdit/buildEditInputController";
import { InteractionModeCoordinator } from "./input/interactionMode";
import { routePrimaryAction } from "./input/primaryActionRouting";
import { WeaponController } from "./weapon/WeaponController";

/** A minimal event-target stand-in that also reports its listener counts. */
class FakeTarget implements InputEventTarget {
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Aim straight down from above the origin — a valid placement preview. */
const PLACE_AIM = { origin: { x: 0, y: 5, z: 0 }, dir: { x: 0, y: -1, z: 0 } };

/** A wall the local session owns (the edit target). */
function wallState(id: string): StructureState {
  return {
    structureId: id,
    buildType: "wall" as const,
    grid: { x: 0, y: 0, z: -1 },
    rotation: 0,
    ownerId: "me",
    createdSequence: 0,
  };
}

interface FrameOpts {
  firePressed?: boolean;
  fireHeld?: boolean;
  slot1?: boolean;
  slot2?: boolean;
  reload?: boolean;
  inRound?: boolean;
  connected?: boolean;
  now?: number;
  aim?: { origin: Vec3; dir: Vec3 };
}

function createFixture() {
  const canvas = {} as HTMLCanvasElement;
  let lockElement: unknown = null;
  // ONE shared surface per event kind — the window/document equivalents.
  const key = new FakeTarget();
  const pointerLock = new FakeTarget();
  const visibility = new FakeTarget();

  const buildEnv: BuildingInputEnvironment = {
    keyTarget: key,
    pointerLockTarget: pointerLock,
    visibilityTarget: visibility,
    getPointerLockElement: () => lockElement as Element | null,
    isHidden: () => false,
  };
  const editEnv: BuildEditInputEnvironment = {
    keyTarget: key,
    pointerLockTarget: pointerLock,
    visibilityTarget: visibility,
    getPointerLockElement: () => lockElement,
    isHidden: () => false,
  };

  const mode = new InteractionModeCoordinator();
  const buildInput = new BuildingInputController(canvas, buildEnv, mode);
  const editInput = new BuildEditInputController(canvas, editEnv, mode);

  const sent: Array<{ type: string; payload?: unknown }> = [];
  // Weapon slot / reload edges latched by the (simulated) centralized
  // InputManager from the shared window keydown events.
  const pendingWeaponKeys = { slot1: false, slot2: false, reload: false };
  const network = {
    send: (type: string, payload?: unknown): boolean => {
      sent.push({ type, payload });
      return true;
    },
    onEvent: (_name: string, _cb: (payload: unknown) => void) => () => undefined,
  };

  const store = new BuildingStateStore();
  const building = new BuildingController(buildInput, store, network);
  building.applyReplicatedBuilding({ structures: { s1: wallState("s1") } });
  const edit = new BuildEditController(editInput, network, () => 0);
  const weapon = new WeaponController();

  const placementCount = (): number =>
    sent.filter((m) => m.type === BUILD_EVENTS.PLACEMENT_REQUEST).length;
  const editActionCount = (): number =>
    sent.filter((m) => m.type === EDIT_GRID_ACTION_MESSAGE).length;
  const weaponSwitchCount = (): number =>
    sent.filter((m) => m.type === "weapon_switch").length;

  /**
   * One simulated render frame — mirrors the GameRuntime's per-frame
   * contract (the same gates, in the same order):
   *   1. route the primary (edge consumed unconditionally, gated on
   *      connected + IN_PROGRESS — the latch can never survive a transition);
   *   2. weapon actions: drained every frame, gated on effective weapon
   *      mode + IN_PROGRESS + connected + not eliminated;
   *   3. building frame: preview always, intents only when connected &&
   *      IN_PROGRESS (held OR press edge);
   *   4. build-edit frame: routed select edges.
   */
  const frame = (o: FrameOpts = {}): void => {
    const connected = o.connected ?? true;
    const inRound = o.inRound ?? true;
    const aim = o.aim ?? PLACE_AIM;
    const aimOrigin = aim.origin;
    const aimDirection = aim.dir;
    const feet: Vec3 = { x: 0, y: 0, z: 0 };

    const route = routePrimaryAction(
      mode.isBuildActive(),
      mode.isEditActive(),
      (o.firePressed ?? false) && connected && inRound,
      (o.fireHeld ?? false) && connected && inRound,
    );

    const active =
      mode.mode === "weapon" && inRound && connected; // + not eliminated
    // The runtime drains these latches every frame, whatever the phase.
    const slot1 = (o.slot1 ?? false) || pendingWeaponKeys.slot1;
    const slot2 = (o.slot2 ?? false) || pendingWeaponKeys.slot2;
    const reload = (o.reload ?? false) || pendingWeaponKeys.reload;
    pendingWeaponKeys.slot1 = pendingWeaponKeys.slot2 = pendingWeaponKeys.reload = false;
    if (slot1 && active) {
      const r = weapon.switchWeapon("assault_rifle");
      if (r.switched && r.targetWeapon)
        sent.push({ type: "weapon_switch", payload: r.targetWeapon });
    }
    if (slot2 && active) {
      const r = weapon.switchWeapon("shotgun");
      if (r.switched && r.targetWeapon)
        sent.push({ type: "weapon_switch", payload: r.targetWeapon });
    }
    if (reload && active) weapon.startReload();
    if (route.weaponFirePressed && active) weapon.tryFire(aimDirection);

    building.updateFrame({ aimOrigin, aimDirection, playerPosition: feet });
    if (connected && inRound) {
      building.pollHeldPlacement(
        o.now ?? 0,
        route.buildPlaceHeld || route.buildPlacePressed,
      );
    }

    edit.updateFrame({
      aimOrigin,
      aimDirection,
      playerPosition: feet,
      building: store.getBuildingState(),
      sessionId: "me",
      connected,
      inRound,
      editSelectPressed: route.editSelectPressed,
      editSelectHeld: route.editSelectHeld,
    });
  };

  /**
   * Press (and release) a key on the shared window surface. The SAME keydown
   * event also reaches the centralized InputManager, which latches the
   * weapon slot / reload edges — the pending edges are drained by the next
   * frame (exactly how the runtime consumes them every frame).
   */
  const press = (code: string): void => {
    const mouse = /^Mouse(\d+)$/.exec(code);
    if (mouse) {
      // A real click: press then release (the release re-arms the button).
      key.dispatch("mousedown", { type: "mousedown", button: Number(mouse[1]) });
      key.dispatch("mouseup", { type: "mouseup", button: Number(mouse[1]) });
    }
    else key.dispatch("keydown", { code, repeat: false });
    if (code === "Digit1") pendingWeaponKeys.slot1 = true;
    else if (code === "Digit2") pendingWeaponKeys.slot2 = true;
    else if (code === "KeyR") pendingWeaponKeys.reload = true;
  };

  const lock = (): void => {
    lockElement = canvas;
    pointerLock.dispatch("pointerlockchange", {});
  };
  const unlock = (): void => {
    lockElement = null;
    pointerLock.dispatch("pointerlockchange", {});
  };

  const dispose = (): void => {
    weapon.dispose();
    edit.dispose();
    building.dispose();
    buildInput.dispose();
    editInput.dispose();
  };

  return {
    mode,
    key,
    pointerLock,
    visibility,
    sent,
    building,
    edit,
    weapon,
    buildInput,
    editInput,
    frame,
    press,
    lock,
    unlock,
    dispose,
    placementCount,
    editActionCount,
    weaponSwitchCount,
  };
}

/** Aim straight down at the centre of build tile (x, z) (tiles are centred on grid × cellSize). */
const aimCell = (x: number, z: number) => ({ origin: { x: x * 5.12, y: 5, z: z * 5.12 }, dir: { x: 0, y: -1, z: 0 } });
/** Aim at wall s1 (grid (0,0,-1)) tile `t` along its panel normal. */
const editAim = (t: number) => ({
  origin: { x: -5.12 / 2 + ((t % 3) + 0.5) * (5.12 / 3), y: 3.84 - (Math.floor(t / 3) + 0.5) * (3.84 / 3), z: 0 },
  dir: { x: 0, y: 0, z: -1 },
});

describe("competitive mode transitions (shared coordinator, default binds)", () => {
  it("registers no duplicate listeners on the shared input surfaces", () => {
    const fixture = createFixture();
    expect(fixture.key.count("keydown")).toBe(2);
    for (const type of ["pointerdown", "pointermove", "pointerup", "mousedown", "mouseup"]) expect(fixture.key.count(type), type).toBe(2);
    expect(fixture.pointerLock.count("pointerlockchange")).toBe(2);
    expect(fixture.visibility.count("visibilitychange")).toBe(2);
    fixture.buildInput.dispose();
    expect(fixture.key.count("keydown")).toBe(1);
    expect(fixture.key.count("pointerdown")).toBe(1);
    expect(fixture.pointerLock.count("pointerlockchange")).toBe(1);
    fixture.dispose();
    expect(fixture.key.count("pointerdown")).toBe(0);
  });

  it("side buttons: Mouse Button 4 (DOM 3) → wall, Mouse Button 5 (DOM 4) → ramp, F → cone, E → edit; none fires or places by itself", () => {
    const fixture = createFixture();
    fixture.lock();
    const before = fixture.sent.length;
    fixture.key.dispatch("mousedown", { type: "mousedown", button: 3 });
    fixture.frame();
    expect([fixture.mode.mode, fixture.buildInput.getSelectedBuildType()]).toEqual(["build", "wall"]);
    fixture.key.dispatch("mousedown", { type: "mousedown", button: 4 });
    fixture.frame();
    expect([fixture.mode.mode, fixture.buildInput.getSelectedBuildType()]).toEqual(["build", "ramp"]);
    fixture.key.dispatch("keydown", { code: "KeyF", repeat: false });
    fixture.frame();
    expect(fixture.buildInput.getSelectedBuildType()).toBe("cone");
    // Selecting pieces sends nothing: no placement, no shot, no edit.
    expect(fixture.sent.length).toBe(before);
    fixture.key.dispatch("keydown", { code: "KeyE", repeat: false });
    fixture.frame();
    expect(fixture.mode.mode).toBe("edit");
    // Released side buttons do nothing (only the press is a bind).
    fixture.key.dispatch("mouseup", { type: "mouseup", button: 3 });
    fixture.frame();
    expect(fixture.mode.mode).toBe("edit");
    expect(fixture.sent.length).toBe(before);
    fixture.dispose();
  });

  it.each([
    ["Mouse3", "wall"],
    ["KeyQ", "floor"],
    ["Mouse4", "ramp"],
    ["KeyF", "cone"],
  ] as const)("weapon → %s with one key: building with that piece, preview and placement immediately", (code, piece) => {
    const fixture = createFixture();
    fixture.lock();
    expect(fixture.mode.mode).toBe("weapon");
    fixture.press(code);
    expect(fixture.mode.mode).toBe("build");
    expect(fixture.buildInput.getSelectedBuildType()).toBe(piece);
    fixture.frame({ aim: aimCell(-1, 0) });
    expect(fixture.building.getPreview().present).toBe(true);
    expect(fixture.building.getPreview().valid).toBe(true);
    fixture.frame({ firePressed: true, fireHeld: true, aim: aimCell(-1, 0) });
    const placed = fixture.sent.filter((m) => m.type === BUILD_EVENTS.PLACEMENT_REQUEST).map((m) => (m.payload as { buildType: string }).buildType);
    expect(placed).toEqual([piece]);
    expect(fixture.weapon.currentAmmo).toBe(30); // no shot
    fixture.dispose();
  });

  it("hold the primary: wall → ramp → floor → cone binds keep turbo placing without a release", () => {
    const fixture = createFixture();
    fixture.lock();
    // The button is already down (firing) when the first build bind lands.
    fixture.frame({ firePressed: true, fireHeld: true, aim: aimCell(-2, 0) });
    const rifleAmmo = fixture.weapon.currentAmmo;
    const plan: Array<[string, string, { origin: Vec3; dir: Vec3 }]> = [
      ["Mouse3", "wall", aimCell(-2, 0)],
      ["Mouse4", "ramp", aimCell(0, 0)],
      ["KeyQ", "floor", aimCell(-1, 1)],
      ["KeyF", "cone", aimCell(2, 1)],
    ];
    plan.forEach(([code, , aim], i) => {
      fixture.press(code);
      fixture.frame({ fireHeld: true, aim, now: (i + 1) * PLACEMENT_REQUEST_INTERVAL_MS });
    });
    const placed = fixture.sent.filter((m) => m.type === BUILD_EVENTS.PLACEMENT_REQUEST).map((m) => (m.payload as { buildType: string }).buildType);
    expect(placed).toEqual(["wall", "ramp", "floor", "cone"]);
    // The held primary never fired once building started.
    expect(fixture.weapon.currentAmmo).toBe(rifleAmmo);
    fixture.dispose();
  });

  it("wall → ramp → edit (drag) → shotgun → shoot → edit → reset → confirm", () => {
    const fixture = createFixture();
    fixture.lock();
    const placements = () => fixture.sent.filter((m) => m.type === BUILD_EVENTS.PLACEMENT_REQUEST).length;
    const edits = () => fixture.sent.filter((m) => m.type === EDIT_GRID_ACTION_MESSAGE).map((m) => m.payload as Record<string, unknown>);

    fixture.press("Mouse3");
    fixture.frame({ firePressed: true, fireHeld: true, aim: aimCell(-2, 0), now: 0 });
    fixture.press("Mouse4");
    fixture.frame({ fireHeld: true, aim: aimCell(0, 0), now: PLACEMENT_REQUEST_INTERVAL_MS });
    fixture.frame({ fireHeld: false, aim: aimCell(0, 0), now: 2 * PLACEMENT_REQUEST_INTERVAL_MS });
    expect(placements()).toBe(2);

    // Edit the owned wall: drag a doorway (centre → bottom-centre).
    fixture.press("KeyE");
    expect(fixture.mode.mode).toBe("edit");
    fixture.frame({ aim: editAim(4) });
    fixture.frame({ firePressed: true, fireHeld: true, aim: editAim(4) });
    fixture.frame({ fireHeld: true, aim: editAim(7) });
    fixture.frame({ fireHeld: false, aim: editAim(7) });
    expect(placements()).toBe(2); // the primary selected tiles, never placed
    expect(fixture.weapon.currentAmmo).toBe(30); // ... and never fired
    expect(edits()).toEqual([]); // the drag is local until confirmed

    // Shotgun: leaves edit (committing the doorway) and switches at once.
    fixture.press("Digit2");
    fixture.frame({ aim: editAim(7) });
    expect(fixture.mode.mode).toBe("weapon");
    expect(fixture.weapon.activeWeapon).toBe("shotgun");
    expect(edits()).toEqual([
      { structureId: "s1", action: "select", tileIndex: 4 },
      { structureId: "s1", action: "select", tileIndex: 7 },
      { structureId: "s1", action: "confirm" },
    ]);

    // Shoot: the first click after the edit fires the shotgun once.
    const shells = fixture.weapon.currentAmmo;
    fixture.frame({ firePressed: true, fireHeld: true, aim: editAim(4) });
    fixture.frame({ fireHeld: false, aim: editAim(4) });
    expect(fixture.weapon.currentAmmo).toBe(shells - 1);
    expect(placements()).toBe(2);

    // Edit again → reset (predicted at once) → confirm with the edit bind.
    fixture.press("KeyE");
    fixture.frame({ aim: editAim(4) });
    const view = fixture.edit.getEditView()!;
    expect(view.draftState).toEqual({ kind: "wall", tiles: [true, true, true, true, false, true, true, false, true] });
    fixture.press("KeyT");
    fixture.frame({ aim: editAim(4) });
    expect(fixture.edit.getEditView()!.draftState).toEqual({ kind: "wall", tiles: Array(9).fill(true) });
    fixture.press("KeyE");
    fixture.frame({ aim: editAim(4) });
    expect(edits().slice(3)).toEqual([
      { structureId: "s1", action: "reset" },
      { structureId: "s1", action: "confirm" },
    ]);
    expect(fixture.mode.mode).toBe("weapon");
    expect(fixture.weapon.currentAmmo).toBe(shells - 1); // no stray shot
    fixture.dispose();
  });

  it("rapid weapon → wall → weapon → ramp → edit alternation: every bind lands, nothing strays", () => {
    const fixture = createFixture();
    fixture.lock();
    const steps: Array<[string, string, string | null]> = [
      ["Mouse3", "build", "wall"],
      ["Digit1", "weapon", null],
      ["Mouse4", "build", "ramp"],
      ["Digit2", "weapon", null],
      ["Mouse3", "build", "wall"],
      ["KeyE", "edit", null],
      ["Digit1", "weapon", null],
      ["KeyF", "build", "cone"],
      ["KeyE", "edit", null],
      ["KeyE", "build", null], // edit again returns to the build layer beneath
    ];
    for (const [code, expected, piece] of steps) {
      fixture.press(code);
      fixture.frame({ aim: editAim(4) });
      expect(fixture.mode.mode, code).toBe(expected);
      if (piece !== null) expect(fixture.buildInput.getSelectedBuildType(), code).toBe(piece);
    }
    expect(fixture.weapon.activeWeapon).toBe("assault_rifle");
    expect(fixture.weaponSwitchCount()).toBe(2); // → shotgun, → rifle
    expect(fixture.placementCount()).toBe(0);
    expect(fixture.editActionCount()).toBe(0); // untouched edits send nothing
    expect(fixture.weapon.currentAmmo).toBe(30);
    fixture.dispose();
  });

  it("R reloads only in weapon mode and rotates only while building", () => {
    const fixture = createFixture();
    fixture.lock();
    fixture.frame({ firePressed: true, aim: aimCell(-1, 0) }); // spend a round
    fixture.press("KeyR");
    fixture.frame();
    expect(fixture.weapon.isReloading).toBe(true);
    expect(fixture.buildInput.getRotation()).toBe(0);
    fixture.weapon.reset();
    fixture.press("Mouse3");
    fixture.press("KeyR");
    fixture.frame();
    expect(fixture.buildInput.getRotation()).toBe(1);
    expect(fixture.weapon.isReloading).toBe(false);
    fixture.dispose();
  });

  it("drains every latch each frame: nothing latched out of round fires after the round starts", () => {
    const fixture = createFixture();
    fixture.lock();
    fixture.press("Digit2");
    fixture.frame({ inRound: false, firePressed: true, fireHeld: true });
    fixture.press("Mouse3");
    fixture.frame({ inRound: false, firePressed: true, fireHeld: true });
    fixture.frame({ aim: aimCell(-1, 0) });
    expect(fixture.weaponSwitchCount()).toBe(0);
    expect(fixture.placementCount()).toBe(0);
    expect(fixture.weapon.currentAmmo).toBe(30);
    fixture.dispose();
  });

  it("pointer unlock clears both layers and discards an unconfirmed edit", () => {
    const fixture = createFixture();
    fixture.lock();
    fixture.press("Mouse3");
    fixture.press("KeyE");
    fixture.frame({ aim: editAim(4) });
    fixture.frame({ firePressed: true, fireHeld: true, aim: editAim(4) });
    fixture.frame({ fireHeld: false, aim: editAim(4) });
    fixture.unlock();
    fixture.frame({ aim: editAim(4) });
    expect(fixture.mode.mode).toBe("weapon");
    expect(fixture.editActionCount()).toBe(0);
    fixture.dispose();
  });
});
