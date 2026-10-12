/**
 * Mode-transition conflict lifecycle tests (overhaul task 12).
 *
 * Wires the PRODUCTION components exactly the way the GameRuntime does — one
 * shared {@link InteractionModeCoordinator} owned by the runtime and threaded
 * into BOTH the building system and the build-edit system — and simulates the
 * runtime's per-frame contract:
 *
 *   route = routePrimaryAction(build, edit, fireEdge, fireHeld)   [gated]
 *   weapon actions     only in effective weapon mode + IN_PROGRESS
 *   updateBuildingFrame(connected, inRound, buildPlaceHeld | press)
 *   updateBuildEditFrame(route.editSelect*)
 *
 * Invariants pinned by the mission flow "place then edit, confirm then
 * shotgun, repeat edit/reset/edit":
 *
 *  - no duplicate listeners: both input controllers share one key /
 *    pointer-lock / visibility surface and each registers exactly ONE
 *    listener per event type; the coordinator registers none;
 *  - no shots in build/edit: the weapon path never acts while build or edit
 *    is the topmost layer;
 *  - no placement in weapon or edit mode: placement intents come out of
 *    effective build mode only, and only while the round is IN_PROGRESS;
 *  - "confirm then shotgun": confirm (Enter) clears the build layer too, so
 *    Digit2 is a weapon switch immediately — not a floor piece selection;
 *  - "repeat edit/reset/edit": reset keeps edit mode on a shared baseline and
 *    the next edit works; the mode loop stays stable;
 *  - no stale edges: latches are drained every frame, so nothing latched
 *    during countdown / another mode can fire after a transition.
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
/** Aim at the centre tile (index 4) of a wall at grid (0,0,-1). */
const EDIT_AIM = { origin: { x: 0, y: 2, z: 0 }, dir: { x: 0, y: 0, z: -1 } };

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
    key.dispatch("keydown", { code, repeat: false });
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

describe("mode-transition conflict lifecycle (shared coordinator)", () => {
  it("registers no duplicate listeners on the shared input surfaces", () => {
    const fixture = createFixture();
    // Both controllers are wired into the SAME surfaces (as in the runtime,
    // where both listen on window/document). Each event type has exactly one
    // listener per controller — two total, no third from the coordinator.
    expect(fixture.key.count("keydown")).toBe(2);
    expect(fixture.pointerLock.count("pointerlockchange")).toBe(2);
    expect(fixture.visibility.count("visibilitychange")).toBe(2);
    // Tearing one system down removes exactly its listeners.
    fixture.buildInput.dispose();
    expect(fixture.key.count("keydown")).toBe(1);
    expect(fixture.pointerLock.count("pointerlockchange")).toBe(1);
    fixture.dispose();
  });

  it("place then edit: placement stops, no shots, the primary becomes tile selection", () => {
    const fixture = createFixture();
    fixture.lock();

    // B: build mode. Hold the primary aimed at the grid: turbo placement.
    fixture.press("KeyB");
    fixture.frame({ fireHeld: true, now: 0 });
    expect(fixture.placementCount()).toBe(1);
    // A fresh cell (the first intent's footprint is pending, so the same
    // cell's preview is invalid until the server answers).
    fixture.frame({
      fireHeld: true,
      now: PLACEMENT_REQUEST_INTERVAL_MS,
      aim: { origin: { x: 5.12, y: 5, z: 0 }, dir: { x: 0, y: -1, z: 0 } },
    });
    expect(fixture.placementCount()).toBe(2);

    // F: edit mode (build underneath). The SAME held primary must NOT place
    // again and must NOT fire — it belongs to the edit layer.
    fixture.press("KeyF");
    expect(fixture.mode.mode).toBe("edit");
    const before = fixture.placementCount();
    fixture.frame({
      firePressed: true,
      fireHeld: true,
      aim: EDIT_AIM,
      now: 2 * PLACEMENT_REQUEST_INTERVAL_MS,
    });
    expect(fixture.placementCount()).toBe(before); // no placement in edit
    // The primary press became an edit tile action on the targeted wall.
    expect(fixture.editActionCount()).toBe(1);
    const editAction = fixture.sent.find(
      (m) => m.type === EDIT_GRID_ACTION_MESSAGE,
    );
    expect(editAction?.payload).toEqual(
      expect.objectContaining({ structureId: "s1", tileIndex: 4 }),
    );
    // No weapon action happened in any of this (rifle ammo untouched: no
    // fire intent ever reached the weapon path in build/edit).
    expect(fixture.weaponSwitchCount()).toBe(0);
    fixture.dispose();
  });

  it("confirm then shotgun: confirm clears the build layer, Digit2 switches immediately", () => {
    const fixture = createFixture();
    fixture.lock();

    // Build mode: Digit2 is a PIECE selection (floor), never a weapon switch.
    fixture.press("KeyB");
    fixture.press("Digit2");
    expect(fixture.buildInput.getSelectedBuildType()).toBe("floor");
    expect(fixture.weapon.activeWeapon).toBe("assault_rifle");
    expect(fixture.weaponSwitchCount()).toBe(0);
    fixture.frame({ fireHeld: true, now: 0 });
    expect(fixture.placementCount()).toBe(1);

    // Edit, change a tile, then confirm (Enter).
    fixture.press("KeyF");
    fixture.frame({ firePressed: true, fireHeld: true, aim: EDIT_AIM });
    expect(fixture.editActionCount()).toBe(1);
    fixture.press("Enter");
    fixture.frame({ aim: EDIT_AIM }); // confirm is consumed on the targeted piece
    // Confirm committed the edit and returned to WEAPON mode — the build
    // layer is gone, so the number keys are combat actions at once.
    expect(fixture.mode.mode).toBe("weapon");
    expect(fixture.buildInput.isBuildModeActive()).toBe(false);

    // "Then shotgun": Digit2 switches the weapon (and does not select floor).
    fixture.press("Digit2");
    fixture.frame();
    expect(fixture.weapon.activeWeapon).toBe("shotgun");
    expect(fixture.weaponSwitchCount()).toBe(1);
    expect(fixture.buildInput.getSelectedBuildType()).toBe("floor"); // unchanged

    // And Digit1 back to the rifle.
    fixture.press("Digit1");
    fixture.frame();
    expect(fixture.weapon.activeWeapon).toBe("assault_rifle");
    expect(fixture.weaponSwitchCount()).toBe(2);

    // Re-entering build mode, Digit2 is a piece selection again (no switch).
    fixture.press("KeyB");
    fixture.press("Digit2");
    fixture.frame();
    expect(fixture.buildInput.getSelectedBuildType()).toBe("floor");
    expect(fixture.weaponSwitchCount()).toBe(2);
    fixture.dispose();
  });

  it("repeat edit / reset / edit: reset keeps the mode, the next edit works", () => {
    const fixture = createFixture();
    fixture.lock();

    fixture.press("KeyB"); // build
    fixture.press("KeyF"); // edit (build underneath)
    expect(fixture.mode.mode).toBe("edit");

    // Edit: toggle the centre tile.
    fixture.frame({ firePressed: true, fireHeld: true, aim: EDIT_AIM });
    expect(fixture.editActionCount()).toBe(1);

    // Reset (Backspace): stays in edit mode, sends the reset terminal ...
    fixture.press("Backspace");
    fixture.frame({ aim: EDIT_AIM });
    expect(fixture.mode.mode).toBe("edit");
    const reset = fixture.sent.filter(
      (m) =>
        m.type === EDIT_GRID_ACTION_MESSAGE &&
        (m.payload as { action?: string })?.action === "reset",
    );
    expect(reset).toHaveLength(1);

    // ... and the next edit works on the (optimistically) reset baseline.
    fixture.frame({ firePressed: true, fireHeld: true, aim: EDIT_AIM });
    expect(fixture.editActionCount()).toBe(3); // toggle + reset + toggle

    // F back to build: placement resumes. B back to weapon: nothing.
    fixture.press("KeyF");
    expect(fixture.mode.mode).toBe("build");
    fixture.frame({ firePressed: true, fireHeld: true, now: 0 });
    expect(fixture.placementCount()).toBe(1);
    fixture.press("KeyB");
    expect(fixture.mode.mode).toBe("weapon");
    fixture.frame({ firePressed: true, fireHeld: true, now: PLACEMENT_REQUEST_INTERVAL_MS });
    expect(fixture.placementCount()).toBe(1); // no placement in weapon mode
    fixture.dispose();
  });

  it("drains every latch each frame: no stale shot / switch / placement across transitions", () => {
    const fixture = createFixture();
    fixture.lock();

    // COUNTDOWN: the primary is held, a slot is pressed, build is armed.
    fixture.press("KeyB");
    fixture.press("Digit2");
    fixture.frame({
      firePressed: true,
      fireHeld: true,
      inRound: false,
      now: 0,
    });
    expect(fixture.placementCount()).toBe(0); // no placement outside the round
    expect(fixture.weaponSwitchCount()).toBe(0); // slot drained, not acted
    expect(fixture.weapon.activeWeapon).toBe("assault_rifle");

    // ROUND START, still holding everything: the edge is GONE (it was
    // consumed every frame during countdown) but the held state persists.
    fixture.frame({ fireHeld: true, inRound: true, now: PLACEMENT_REQUEST_INTERVAL_MS });
    // In build mode the held primary places (build owns it) — and no stale
    // weapon slot / fire edge fired: exactly one placement, zero switches.
    expect(fixture.placementCount()).toBe(1);
    expect(fixture.weaponSwitchCount()).toBe(0);
    expect(fixture.weapon.activeWeapon).toBe("assault_rifle");

    // Weapon mode: a fresh press fires exactly once; the earlier stale
    // countdown press never resurfaces.
    fixture.press("KeyB");
    fixture.frame({ firePressed: true, fireHeld: true });
    fixture.frame({ fireHeld: true }); // held: no second edge
    // (Ammo decremented exactly once — tryFire ran on the press edge only.)
    const fullAmmo = 30; // assault-rifle magazine
    expect(fixture.weapon.currentAmmo).toBe(fullAmmo - 1);
    fixture.dispose();
  });

  it("pointer unlock clears both layers through the shared coordinator", () => {
    const fixture = createFixture();
    fixture.lock();
    fixture.press("KeyB");
    fixture.press("KeyF");
    expect(fixture.mode.mode).toBe("edit");
    fixture.unlock();
    // Both controllers react to the same pointerlockchange event and route
    // to the shared coordinator — the result is weapon mode, once.
    expect(fixture.mode.mode).toBe("weapon");
    expect(fixture.buildInput.isBuildModeActive()).toBe(false);
    expect(fixture.editInput.isEditModeActive()).toBe(false);
    fixture.dispose();
  });
});
