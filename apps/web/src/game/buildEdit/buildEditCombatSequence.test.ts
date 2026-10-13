/**
 * Sequence regression coverage for the canonical combat loop
 *
 *   edit-window → authoritative confirm → (switch + fire) weapon → reset
 *
 * driven through the *real* presentation modules the runtime wires together:
 *
 *  - the centralized {@link InputManager} (fire / weapon-slot / reload edges +
 *    pointer-lock lifecycle),
 *  - the {@link InteractionModeCoordinator} (shared build + edit layer owner),
 *  - the {@link BuildingInputController} (KeyB) and
 *    {@link BuildEditInputController} (KeyF / Enter / Backspace),
 *  - the {@link BuildEditController} (edit intents + result convergence),
 *  - the {@link WeaponController} (fire-rate gate),
 *  - {@link routePrimaryAction} (the single primary-button ownership decision).
 *
 * `frame()` reproduces the runtime's per-frame order (route → weapon → edit →
 * tick) so the tests pin the actual transition behaviour:
 *
 *  - confirming an edit hands the primary button to the weapon **immediately**
 *    (the next press fires; no re-entry, no stale build placement);
 *  - each fire press fires exactly once (no double-shot) and the legitimate
 *    fire-rate interval still limits rapid pulls;
 *  - the build layer never owns the primary while editing or in weapon mode
 *    (no accidental placement);
 *  - reset returns the piece to its canonical default while edit mode stays
 *    on, so edit → reset → edit repeats from the same baseline;
 *  - repeated edit → confirm → fire → reset cycles replicate identically
 *    (no listener / state accumulation across cycles).
 */
import { describe, expect, it } from "vitest";
import type { BuildingState, StructureState } from "@buildshift/protocol";
import { InteractionModeCoordinator } from "../input/interactionMode";
import { routePrimaryAction } from "../input/primaryActionRouting";
import { InputManager } from "../input/InputManager";
import {
  BuildingInputController,
  type BuildingInputEnvironment,
} from "../building/buildingInputController";
import type { InputEventTarget } from "./buildEditInputController";
import {
  BuildEditController,
  EDIT_GRID_ACTION_MESSAGE,
  type BuildEditNetworkLike,
} from "./buildEditController";
import { BuildEditInputController } from "./buildEditInputController";
import { WeaponController } from "../weapon/WeaponController";

type Listener = (event: unknown) => void;
class FakeEventTarget implements InputEventTarget {
  private readonly listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, l: Listener): void {
    let b = this.listeners.get(type);
    if (!b) {
      b = new Set<Listener>();
      this.listeners.set(type, b);
    }
    b.add(l);
  }
  removeEventListener(type: string, l: Listener): void {
    this.listeners.get(type)?.delete(l);
  }
  dispatch(type: string, e: unknown): void {
    this.listeners.get(type)?.forEach((l) => l(e));
  }
}

class FakeNetwork implements BuildEditNetworkLike {
  sent: Array<{ type: string; payload?: unknown }> = [];
  private resultListener: ((payload: unknown) => void) | null = null;
  send(type: string, payload?: unknown): boolean {
    this.sent.push({ type, payload });
    return true;
  }
  onEvent(name: string, cb: (payload: unknown) => void): () => void {
    if (name === EDIT_GRID_ACTION_MESSAGE) {
      this.resultListener = cb;
    }
    return () => {
      if (this.resultListener === cb) {
        this.resultListener = null;
      }
    };
  }
  emitResult(payload: unknown): void {
    this.resultListener?.(payload);
  }
}

const OWNER = "me";

/** A wall at grid (0,0,-1); the crosshair (aimed -Z from (0,2,0)) sits on tile 4. */
function wall(id: string): StructureState {
  return {
    structureId: id,
    buildType: "wall",
    grid: { x: 0, y: 0, z: -1 },
    rotation: 0,
    ownerId: OWNER,
    createdSequence: 0,
  };
}

function buildingOf(): BuildingState {
  return { structures: { wall1: wall("wall1") } };
}

interface FrameResult {
  route: ReturnType<typeof routePrimaryAction>;
  fired: boolean;
  mode: string;
}

interface Fixture {
  canvasRef: unknown;
  coordinator: InteractionModeCoordinator;
  inputManager: InputManager;
  editController: BuildEditController;
  buildInput: BuildingInputController;
  network: FakeNetwork;
  weapon: WeaponController;
  lock(): void;
  keyDown(code: string): void;
  mouseDown(): void;
  mouseUp(): void;
  /** One render frame in the runtime's order (route → weapon → edit → tick). */
  frame(): FrameResult;
  /** Advance the frame clock by dt ms without running a frame. */
  advance(ms: number): void;
  dispose(): void;
}

const FRAME_MS = 16;

function createFixture(): Fixture {
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeEventTarget();
  const canvasTarget = new FakeEventTarget();
  let pointerLockElement: unknown = null;

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

  const canvas = canvasTarget as unknown as HTMLCanvasElement;
  const inputManager = new InputManager(canvas);

  const coordinator = new InteractionModeCoordinator();

  const editEnv = {
    keyTarget: windowTarget,
    pointerLockTarget: documentTarget,
    visibilityTarget: documentTarget,
    getPointerLockElement: () => pointerLockElement,
    isHidden: () => false,
  };
  const buildEnv: BuildingInputEnvironment = {
    keyTarget: windowTarget,
    pointerLockTarget: documentTarget,
    visibilityTarget: documentTarget,
    getPointerLockElement: () => pointerLockElement as Element | null,
    isHidden: () => false,
  };
  const buildInput = new BuildingInputController(canvas, buildEnv, coordinator);
  const editInput = new BuildEditInputController(
    canvas,
    editEnv,
    coordinator,
  );

  const network = new FakeNetwork();
  let clock = 0;
  const editController = new BuildEditController(
    editInput,
    network,
    () => clock,
  );
  const weapon = new WeaponController();

  const building = buildingOf();

  return {
    canvasRef: canvasTarget,
    coordinator,
    inputManager,
    editController,
    buildInput,
    network,
    weapon,
    lock() {
      pointerLockElement = canvasTarget;
      documentTarget.dispatch("pointerlockchange", {});
    },
    keyDown(code) {
      windowTarget.dispatch("keydown", { code, repeat: false });
    },
    mouseDown() {
      canvasTarget.dispatch("mousedown", { button: 0 });
    },
    mouseUp() {
      canvasTarget.dispatch("mouseup", { button: 0 });
    },
    frame(): FrameResult {
      // 1. route the shared primary button (consumes the fire press edge).
      const route = routePrimaryAction(
        coordinator.isBuildActive(),
        coordinator.isEditActive(),
        inputManager.consumeFirePressed(),
        inputManager.isFiring(),
      );

      // 2. weapon input (the runtime's handleWeaponInput; connection + phase
      //    are always live in this fixture).
      const weaponActive = coordinator.mode === "weapon";
      if (inputManager.consumeWeaponSlot1Pressed() && weaponActive) {
        weapon.switchWeapon("assault_rifle");
      }
      if (inputManager.consumeWeaponSlot2Pressed() && weaponActive) {
        weapon.switchWeapon("shotgun");
      }
      if (inputManager.consumeReloadPressed() && weaponActive) {
        weapon.startReload();
      }
      let fired = false;
      if (route.weaponFirePressed && weaponActive) {
        fired = weapon.tryFire({ x: 0, y: 0, z: -1 }).fired;
      }

      // 3. edit intents (routed primary into tile selection).
      editController.updateFrame({
        aimOrigin: { x: 0, y: 2, z: 0 },
        aimDirection: { x: 0, y: 0, z: -1 },
        playerPosition: { x: 0, y: 0, z: 0 },
        building,
        sessionId: OWNER,
        connected: true,
        inRound: true,
        editSelectPressed: route.editSelectPressed,
        editSelectHeld: route.editSelectHeld,
      });

      // 4. per-frame tick (keeps the fire-rate cooldown honest).
      weapon.tick(FRAME_MS);
      clock += FRAME_MS;

      return { route, fired, mode: coordinator.mode };
    },
    advance(ms) {
      clock += ms;
      weapon.tick(ms);
    },
    dispose() {
      editController.dispose();
      buildInput.dispose();
      inputManager.dispose();
    },
  };
}

/** Enter build mode (KeyB) then edit mode (KeyF), one frame per step. */
function enterBuildEdit(f: Fixture): void {
  f.keyDown("KeyB");
  f.frame();
  f.keyDown("KeyF");
  f.frame();
}

/** Edit the centre tile (a routed primary press) and let the result land. */
function editCentreTile(f: Fixture): void {
  f.mouseDown();
  f.frame();
  f.mouseUp();
  f.frame();
  f.network.emitResult({
    structureId: "wall1",
    success: true,
    editState: {
      kind: "wall",
      tiles: [true, true, true, true, false, true, true, true, true],
    },
  });
}

describe("edit → confirm → shotgun → reset combat sequence", () => {
  it("confirm → fire: the weapon fires on the first click after confirm (immediate, single)", () => {
    const f = createFixture();
    f.lock();
    enterBuildEdit(f);
    expect(f.coordinator.mode).toBe("edit");
    editCentreTile(f);

    // confirm → commit-exit to weapon
    f.keyDown("Enter");
    f.frame();
    expect(f.coordinator.mode).toBe("weapon");
    expect(f.network.sent.at(-1)?.payload).toEqual({
      structureId: "wall1",
      action: "confirm",
    });

    // first click after confirm fires immediately (no re-entry needed)
    f.mouseDown();
    const r = f.frame();
    f.mouseUp();
    expect(r.fired).toBe(true);
    // ...and the build layer never owned the primary (no accidental placement)
    expect(r.route.buildPlacePressed).toBe(false);
    expect(r.route.buildPlaceHeld).toBe(false);
    f.dispose();
  });

  it("switches to the shotgun and fires it right after confirm", () => {
    const f = createFixture();
    f.lock();
    enterBuildEdit(f);
    editCentreTile(f);
    f.keyDown("Enter");
    f.frame(); // confirm → weapon
    expect(f.weapon.activeWeapon).toBe("assault_rifle");

    f.keyDown("Digit2");
    f.frame();
    expect(f.weapon.activeWeapon).toBe("shotgun");

    f.mouseDown();
    const r = f.frame();
    f.mouseUp();
    expect(r.fired).toBe(true);
    expect(f.weapon.activeWeapon).toBe("shotgun");
    f.dispose();
  });

  it("a single fire press fires exactly once (no double-shot)", () => {
    const f = createFixture();
    f.lock();
    f.keyDown("Digit2");
    f.frame();

    f.mouseDown();
    let shots = f.frame().fired ? 1 : 0;
    // the edge is consumed: the next frame (button still held) adds nothing
    shots += f.frame().fired ? 1 : 0;
    f.mouseUp();
    f.frame();
    shots += f.frame().fired ? 1 : 0;

    expect(shots).toBe(1);
    f.dispose();
  });

  it("preserves the shotgun fire-rate limit for rapid re-pulls", () => {
    const f = createFixture();
    f.lock();
    f.keyDown("Digit2");
    f.frame();

    // first pull fires
    f.mouseDown();
    expect(f.frame().fired).toBe(true);
    f.mouseUp();

    // a second pull within the 500 ms interval (2 shots/s) is gated
    f.mouseDown();
    expect(f.frame().fired).toBe(false);
    f.mouseUp();

    // ...and once the interval has elapsed, the next pull fires again
    f.advance(520);
    f.mouseDown();
    expect(f.frame().fired).toBe(true);
    f.mouseUp();

    f.dispose();
  });

  it("keeps the fire-rate limit honest across an edit → confirm → fire round trip", () => {
    const f = createFixture();
    f.lock();
    f.keyDown("Digit2");
    f.frame();

    // Fire the shotgun, then immediately go edit → confirm → fire again.
    f.mouseDown();
    expect(f.frame().fired).toBe(true); // first shot
    f.mouseUp();

    // Enter edit + confirm almost instantly (well under the 500 ms interval).
    enterBuildEdit(f);
    f.keyDown("Enter"); // confirm an untouched piece (nothing to send) → weapon
    f.frame();
    expect(f.coordinator.mode).toBe("weapon");

    // The weapon input is immediately available (routing is correct) ... but
    // the legitimate fire-rate cooldown from the first shot is still in
    // effect, so this pull is gated (no "free" shot by re-entering the loop).
    f.mouseDown();
    expect(f.frame().fired).toBe(false);
    f.mouseUp();

    // Once the interval has elapsed, the same pull fires again.
    f.advance(520);
    f.mouseDown();
    expect(f.frame().fired).toBe(true);
    f.mouseUp();

    f.dispose();
  });

  it("reset returns the piece to its default while edit mode stays on (repeatable baseline)", () => {
    const f = createFixture();
    f.lock();
    enterBuildEdit(f);

    // touch a tile, then reset it (Backspace) — the reset lands because the
    // piece was changed, and edit mode must stay on for a repeatable cycle.
    f.mouseDown();
    f.frame();
    f.mouseUp();
    f.frame();
    expect(f.network.sent.at(-1)?.payload).toEqual({
      structureId: "wall1",
      action: "select",
      tileIndex: 4,
    });

    f.keyDown("Backspace");
    f.frame();
    expect(f.coordinator.mode).toBe("edit"); // reset keeps edit mode on
    expect(f.network.sent.at(-1)?.payload).toEqual({
      structureId: "wall1",
      action: "reset",
    });
    // the pending state snaps to the canonical default immediately
    expect(f.editController.getPendingState()).toEqual({
      kind: "wall",
      tiles: [true, true, true, true, true, true, true, true, true],
    });
    f.dispose();
  });

  it("resets to the default and re-edits from an identical canonical baseline", () => {
    const f = createFixture();
    f.lock();
    enterBuildEdit(f);

    const click = (): void => {
      f.mouseDown();
      f.frame();
      f.mouseUp();
      f.frame();
    };
    const expectSelect = (action: string): void => {
      expect(f.network.sent.at(-1)?.payload).toEqual({
        structureId: "wall1",
        action,
        tileIndex: 4,
      });
    };

    // Cycle 1: select the centre tile from the default baseline.
    click();
    expectSelect("select");

    // Reset (touched) → the piece is back to its canonical default form and
    // edit mode stays on, so the next edit starts from the same baseline.
    f.keyDown("Backspace");
    f.frame();
    f.network.emitResult({
      structureId: "wall1",
      success: true,
      editState: {
        kind: "wall",
        tiles: [true, true, true, true, true, true, true, true, true],
      },
    });
    expect(f.coordinator.mode).toBe("edit");

    // Cycle 2: the identical edit from the reset baseline replicates exactly.
    click();
    expectSelect("select"); // not a deselect — the baseline was reset

    f.dispose();
  });

  it("holds a fire press through the confirm without double-firing the weapon", () => {
    const f = createFixture();
    f.lock();
    enterBuildEdit(f);
    editCentreTile(f);

    // Hold the primary button while confirming: the held button must not turn
    // into a shot the instant the edit is confirmed (single-shot, no double).
    f.mouseDown();
    f.keyDown("Enter");
    const confirmFrame = f.frame();
    // still in edit mode on this frame's route (mode flips at the frame end)
    expect(confirmFrame.fired).toBe(false);

    // release, then a fresh click fires exactly once
    f.mouseUp();
    f.frame();
    f.mouseDown();
    let shots = f.frame().fired ? 1 : 0;
    f.frame(); // still held — no second shot
    f.mouseUp();
    f.frame();
    shots += f.frame().fired ? 1 : 0;
    expect(shots).toBe(1);
    f.dispose();
  });

  it("repeats the edit → confirm → fire loop without accumulating state", () => {
    const f = createFixture();
    f.lock();
    f.keyDown("Digit2"); // weapon mode: switch to shotgun up front
    f.frame();
    f.keyDown("KeyB");
    f.frame();

    const CYCLES = 3;
    let shots = 0;
    for (let i = 0; i < CYCLES; i++) {
      // enter edit mode (confirm commits-exits to weapon each cycle)
      if (f.coordinator.mode !== "edit") {
        f.keyDown("KeyF");
        f.frame();
      }
      // edit the centre tile
      f.mouseDown();
      f.frame();
      f.mouseUp();
      f.frame();
      // confirm → commit-exit to weapon
      f.keyDown("Enter");
      f.frame();
      expect(f.coordinator.mode).toBe("weapon");
      // the fire-rate interval has elapsed, so this pull is eligible
      f.advance(520);
      f.mouseDown();
      shots += f.frame().fired ? 1 : 0;
      f.mouseUp();
      f.frame();
      // let the in-flight edit actions resolve so no pending state carries
      // over into the next cycle (the authoritative baseline stays clean).
      f.network.emitResult({
        structureId: "wall1",
        success: true,
        editState: {
          kind: "wall",
          tiles: [true, true, true, true, false, true, true, true, true],
        },
      });
      f.network.emitResult({
        structureId: "wall1",
        success: true,
        editState: {
          kind: "wall",
          tiles: [true, true, true, true, false, true, true, true, true],
        },
      });
    }

    // Repeatable: the weapon fires once every cycle ...
    expect(shots).toBe(CYCLES);
    // ...and exactly two edit intents per cycle (select + confirm) went out —
    // no stale confirm / placement / duplicate edges accumulated across loops.
    expect(f.network.sent.length).toBe(CYCLES * 2);
    expect(f.coordinator.mode).toBe("weapon");
    f.dispose();
  });
});
