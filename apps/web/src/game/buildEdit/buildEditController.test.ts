/**
 * Unit tests for {@link BuildEditController} — the competitive edit flow on
 * the canonical edit grid (presentation/input only; the server stays the
 * authority).
 *
 * Pins:
 *
 *  - the edit bind locks the owned piece under the crosshair into a local
 *    draft; dragging the routed primary button across the canonical tiles
 *    selects them **locally** — nothing is sent per tile or per hover;
 *  - the drag selects every tile the crosshair path crosses, including tiles
 *    crossed between two samples (fast drag / low frame rate), never toggles
 *    a revisited tile back, and is not corrupted by leaving the grid;
 *  - reset previews the default form immediately; confirm (or the edit bind
 *    again) sends only the canonical difference over the existing
 *    `two-player:edit_grid_action` route (restores before removals, or one
 *    `reset`), then `confirm`, shown optimistically and rolled back on a
 *    rejection;
 *  - another player's piece is never targeted; an invalid floor pattern is
 *    never sent; forced exits (round reset, disconnect, pointer unlock)
 *    discard the draft.
 *
 * The real {@link BuildEditInputController} (standalone, default bindings:
 * edit G, confirm Enter, reset T) is driven through fake event targets and a
 * fake network.
 */
import { afterEach, describe, expect, it } from "vitest";
import type {
  BuildingState,
  StructureEditState,
  StructureState,
} from "@buildshift/protocol";
import {
  BuildEditController,
  EDIT_GRID_ACTION_MESSAGE,
  editDiffActions,
  type BuildEditFrameContext,
  type BuildEditNetworkLike,
} from "./buildEditController";
import {
  BuildEditInputController,
  type BuildEditInputEnvironment,
  type InputEventTarget,
} from "./buildEditInputController";

type Listener = (event: unknown) => void;
class FakeTarget implements InputEventTarget {
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

interface TestEnv extends BuildEditInputEnvironment {
  setLock(element: unknown): void;
}

function makeEnv(): { env: TestEnv; key: FakeTarget; pointerLock: FakeTarget } {
  const keyTarget = new FakeTarget();
  const pointerLockTarget = new FakeTarget();
  const visibilityTarget = new FakeTarget();
  let lockElement: unknown = null;
  const env: TestEnv = {
    keyTarget,
    pointerLockTarget,
    visibilityTarget,
    getPointerLockElement: () => lockElement,
    isHidden: () => false,
    setLock(el) {
      lockElement = el;
    },
  };
  return { env, key: keyTarget, pointerLock: pointerLockTarget };
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

/** A wall at grid (0,0,-1): AABB x ∈ [-2.56,2.56], y ∈ [0,3.84], z ∈ [-7.68,-2.56]. */
function wall(
  id: string,
  grid: { x: number; y: number; z: number } = { x: 0, y: 0, z: -1 },
  overrides: Partial<StructureState> = {},
): StructureState {
  return {
    structureId: id,
    buildType: "wall",
    grid,
    rotation: 0,
    ownerId: OWNER,
    createdSequence: 0,
    ...overrides,
  };
}
function ramp(id: string, grid: { x: number; y: number; z: number } = { x: 0, y: 0, z: -1 }): StructureState {
  return { structureId: id, buildType: "ramp", grid, rotation: 0, ownerId: OWNER, createdSequence: 0 };
}

/** Read the tile array off a pending state (null for ramp / absent). */
function wallTiles(state: StructureEditState | null): boolean[] | null {
  return state !== null && state.kind !== "ramp" ? state.tiles : null;
}

function buildingOf(structures: StructureState[]): BuildingState {
  const map: Record<string, StructureState> = {};
  for (const s of structures) {
    map[s.structureId] = s;
  }
  return { structures: map };
}

function floorPiece(id: string, ownerId = OWNER): StructureState {
  return { structureId: id, buildType: "floor", grid: { x: 0, y: 0, z: -1 }, rotation: 0, ownerId, createdSequence: 0 };
}

const LH = 3.84;
const CS = 5.12;
/** Camera ray onto wall (0,0,-1)'s panel at tile `t` (col = t % 3, row 0 = top). */
function wallAim(t: number): { aimOrigin: { x: number; y: number; z: number }; aimDirection: { x: number; y: number; z: number } } {
  const col = t % 3;
  const row = Math.floor(t / 3);
  return { aimOrigin: { x: -CS / 2 + (col + 0.5) * (CS / 3), y: LH - (row + 0.5) * (LH / 3), z: 0 }, aimDirection: { x: 0, y: 0, z: -1 } };
}
/** Camera ray onto the wall panel plane at an arbitrary (x, y). */
function wallPoint(x: number, y: number) {
  return { aimOrigin: { x, y, z: 0 }, aimDirection: { x: 0, y: 0, z: -1 } };
}
/** Straight down onto floor (0,0,-1)'s quadrant `t` (col = X half, row = Z half). */
function floorAim(t: number) {
  const col = t % 2;
  const row = Math.floor(t / 2);
  return { aimOrigin: { x: (col - 0.5) * (CS / 2), y: 5, z: -CS + (row - 0.5) * (CS / 2) }, aimDirection: { x: 0, y: -1, z: 0 } };
}

function setup(structures: StructureState[] = [wall("w1")], options?: { confirmOnRelease?: boolean }) {
  const { env, key, pointerLock } = makeEnv();
  env.setLock(canvas);
  const input = new BuildEditInputController(canvas as HTMLCanvasElement, env);
  const network = new FakeNetwork();
  const controller = new BuildEditController(input, network, () => 0, options);
  let building = buildingOf(structures);
  const ctx = (aim: ReturnType<typeof wallPoint>, routed: { pressed?: boolean; held?: boolean } = {}, extra: Partial<BuildEditFrameContext> = {}): BuildEditFrameContext => ({
    ...aim,
    playerPosition: { x: 0, y: 0, z: 0 },
    building,
    sessionId: OWNER,
    connected: true,
    inRound: true,
    editSelectPressed: routed.pressed ?? false,
    editSelectHeld: routed.held ?? false,
    ...extra,
  });
  const press = (code: string) => key.dispatch("keydown", { code, repeat: false });
  const frame = (aim: ReturnType<typeof wallPoint>, routed: { pressed?: boolean; held?: boolean } = {}, extra: Partial<BuildEditFrameContext> = {}) =>
    controller.updateFrame(ctx(aim, routed, extra));
  /** Edit bind, then one frame aiming at the piece (locks the draft). */
  const enterEdit = (aim = wallAim(4)) => { press("KeyG"); frame(aim); };
  /** A drag through the given aims: press at the first, hold through the rest, release. */
  const drag = (aims: ReturnType<typeof wallPoint>[]) => {
    aims.forEach((aim, i) => frame(aim, { pressed: i === 0, held: true }));
    frame(aims[aims.length - 1]!, { held: false });
  };
  const draftTiles = () => wallTiles(controller.getEditView()?.draftState ?? null);
  const removed = () => (draftTiles() ?? []).flatMap((solid, i) => (solid ? [] : [i]));
  const sent = () => network.sent.filter((m) => m.type === EDIT_GRID_ACTION_MESSAGE).map((m) => m.payload as Record<string, unknown>);
  const setBuilding = (next: StructureState[]) => { building = buildingOf(next); };
  live.push(() => { controller.dispose(); input.dispose(); });
  return { controller, input, network, env, pointerLock, press, frame, enterEdit, drag, draftTiles, removed, sent, setBuilding };
}

const canvas = {};
const live: Array<() => void> = [];
afterEach(() => { while (live.length) live.pop()!(); });

describe("BuildEditController — locking the edit target", () => {
  it("the edit bind locks the owned piece under the crosshair into an untouched draft (nothing sent)", () => {
    const t = setup();
    t.enterEdit();
    expect(t.controller.getMode()).toBe(true);
    expect(t.controller.getTarget()?.structureId).toBe("w1");
    const view = t.controller.getEditView()!;
    expect(view.changed).toBe(false);
    expect(view.hoverTile).toBe(4);
    expect(t.sent()).toEqual([]);
  });

  it("keeps the locked piece while the crosshair moves off it", () => {
    const t = setup();
    t.enterEdit();
    t.frame(wallPoint(40, 1));
    expect(t.controller.getTarget()?.structureId).toBe("w1");
    expect(t.controller.getEditView()?.hoverTile).toBeNull();
  });

  it("never targets another player's piece (ownership): no draft, nothing sent", () => {
    const t = setup([wall("theirs", undefined, { ownerId: "opponent" })]);
    t.enterEdit();
    expect(t.controller.getTarget()).toBeNull();
    expect(t.controller.getEditView()).toBeNull();
    t.drag([wallAim(4), wallAim(5)]);
    t.press("Enter");
    t.frame(wallAim(4));
    expect(t.sent()).toEqual([]);
  });
});

describe("BuildEditController — drag selection (local, canonical tiles)", () => {
  it("one tile: a press selects it locally; nothing is sent", () => {
    const t = setup();
    t.enterEdit();
    t.drag([wallAim(4)]);
    expect(t.removed()).toEqual([4]);
    expect(t.controller.getEditView()!.changed).toBe(true);
    expect(t.controller.getPendingState()).toEqual(t.controller.getEditView()!.draftState);
    expect(t.sent()).toEqual([]);
  });

  it("two adjacent tiles: dragging across selects both", () => {
    const t = setup();
    t.enterEdit();
    t.drag([wallAim(4), wallAim(5)]);
    expect(t.removed()).toEqual([4, 5]);
  });

  it("three tiles: a drag along the bottom row selects all three", () => {
    const t = setup();
    t.enterEdit();
    t.drag([wallAim(6), wallAim(7), wallAim(8)]);
    expect(t.removed()).toEqual([6, 7, 8]);
  });

  it("fast drag: one frame from tile 3 straight to tile 5 also selects tile 4", () => {
    const t = setup();
    t.enterEdit();
    t.drag([wallAim(3), wallAim(5)]);
    expect(t.removed()).toEqual([3, 4, 5]);
  });

  it("low frame rate: two samples spanning the wall select every tile on the path", () => {
    const t = setup();
    t.enterEdit();
    // Top-left to bottom-left in a single sample: crosses 0 → 3 → 6.
    t.drag([wallAim(0), wallAim(6)]);
    expect(t.removed()).toEqual([0, 3, 6]);
    // A sample straight through the centre (exact corner crossing is
    // covered by the supercover walk: no tile on the path is skipped).
    const u = setup();
    u.enterEdit();
    u.drag([wallPoint(-2.4, 2.5), wallPoint(2.4, 2.5)]);
    expect(u.removed()).toEqual([3, 4, 5]);
  });

  it("revisiting a tile keeps it selected (the drag mode is fixed by the first tile)", () => {
    const t = setup();
    t.enterEdit();
    t.drag([wallAim(3), wallAim(4), wallAim(3), wallAim(4)]);
    expect(t.removed()).toEqual([3, 4]);
  });

  it("pressing a selected tile starts a restoring drag", () => {
    const t = setup();
    t.enterEdit();
    t.drag([wallAim(3), wallAim(4), wallAim(5)]);
    t.drag([wallAim(4), wallAim(5)]);
    expect(t.removed()).toEqual([3]);
  });

  it("dragging outside the grid does not corrupt the selection", () => {
    const t = setup();
    t.enterEdit();
    // Centre → out past the left edge (crossing tile 3) → far outside above →
    // a frame where the ray misses the panel plane entirely → release.
    t.frame(wallAim(4), { pressed: true, held: true });
    t.frame(wallPoint(-6, 1.92), { held: true });
    t.frame(wallPoint(-6, 9), { held: true });
    t.frame({ aimOrigin: { x: 0, y: 2, z: 0 }, aimDirection: { x: 1, y: 0, z: 0 } }, { held: true });
    t.frame(wallPoint(-6, 9), { held: false });
    expect(t.removed()).toEqual([3, 4]);
    // A press that starts outside the grid selects from the first tile reached.
    t.frame(wallPoint(9, 0.64), { pressed: true, held: true });
    t.frame(wallAim(8), { held: true });
    t.frame(wallAim(8), { held: false });
    expect(t.removed()).toEqual([3, 4, 8]);
  });
});

describe("BuildEditController — confirm sends only the canonical difference", () => {
  it("confirm sends the removals then confirm, exits edit, and shows the result optimistically", () => {
    const t = setup();
    t.enterEdit();
    t.drag([wallAim(4), wallAim(7)]);
    t.press("Enter");
    t.frame(wallAim(4));
    expect(t.sent()).toEqual([
      { structureId: "w1", action: "select", tileIndex: 4 },
      { structureId: "w1", action: "select", tileIndex: 7 },
      { structureId: "w1", action: "confirm" },
    ]);
    expect(t.controller.getMode()).toBe(false);
    // Optimistic: the next time the piece is targeted it shows the doorway.
    t.enterEdit();
    expect(t.removed()).toEqual([4, 7]);
  });

  it("the edit bind again confirms (commit exit)", () => {
    const t = setup();
    t.enterEdit();
    t.drag([wallAim(1)]);
    t.press("KeyG");
    t.frame(wallAim(1));
    expect(t.sent().map((m) => m.action)).toEqual(["select", "confirm"]);
    expect(t.controller.getMode()).toBe(false);
  });

  it("restores are sent before removals", () => {
    const t = setup([wall("w1", undefined, { editGrid: { kind: "wall", tiles: [false, true, true, true, true, true, true, true, true] } })]);
    t.enterEdit();
    t.drag([wallAim(0)]); // restore 0
    t.drag([wallAim(8)]); // remove 8
    t.press("Enter");
    t.frame(wallAim(8));
    expect(t.sent()).toEqual([
      { structureId: "w1", action: "deselect", tileIndex: 0 },
      { structureId: "w1", action: "select", tileIndex: 8 },
      { structureId: "w1", action: "confirm" },
    ]);
  });

  it("an unchanged draft sends nothing on confirm", () => {
    const t = setup();
    t.enterEdit();
    t.drag([wallAim(4)]);
    t.drag([wallAim(4)]); // back to solid
    t.press("Enter");
    t.frame(wallAim(4));
    expect(t.sent()).toEqual([]);
    expect(t.controller.getMode()).toBe(false);
  });

  it("a rejection rolls the optimistic result back with a reason banner", () => {
    const t = setup();
    t.enterEdit();
    t.drag([wallAim(4)]);
    t.press("Enter");
    t.frame(wallAim(4));
    t.network.emitResult({ structureId: "w1", success: false, reason: "not_owned" });
    expect(t.controller.getFeedback()).toMatchObject({ kind: "rejected", message: "Not your structure" });
    t.network.emitResult({ structureId: "w1", success: false, reason: "not_owned" });
    t.enterEdit();
    expect(t.removed()).toEqual([]); // back to the authoritative full wall
  });

  it("a confirmed edit converges on the authoritative results (accepted banner)", () => {
    const t = setup();
    t.enterEdit();
    t.drag([wallAim(4)]);
    t.press("Enter");
    t.frame(wallAim(4));
    const window: StructureEditState = { kind: "wall", tiles: [true, true, true, true, false, true, true, true, true] };
    t.network.emitResult({ structureId: "w1", success: true, editState: window });
    t.network.emitResult({ structureId: "w1", success: true, editState: window });
    expect(t.controller.getFeedback()).toMatchObject({ kind: "accepted", message: "Edit confirmed" });
  });
});

describe("BuildEditController — reset", () => {
  it("reset previews the default form immediately; confirm sends one reset", () => {
    const t = setup([wall("w1", undefined, { editGrid: { kind: "wall", tiles: [true, true, true, true, false, true, true, false, true] } })]);
    t.enterEdit();
    expect(t.removed()).toEqual([4, 7]);
    t.press("KeyT");
    t.frame(wallAim(4));
    expect(t.removed()).toEqual([]); // predicted reset, before any round trip
    expect(t.sent()).toEqual([]);
    expect(t.controller.getEditView()!.changed).toBe(true);
    t.press("Enter");
    t.frame(wallAim(4));
    expect(t.sent()).toEqual([
      { structureId: "w1", action: "reset" },
      { structureId: "w1", action: "confirm" },
    ]);
  });

  it("reset on an untouched default piece sends nothing", () => {
    const t = setup();
    t.enterEdit();
    t.press("KeyT");
    t.frame(wallAim(4));
    t.press("Enter");
    t.frame(wallAim(4));
    expect(t.sent()).toEqual([]);
  });
});

describe("BuildEditController — validity, ramps, gating, forced exits", () => {
  it("an empty floor pattern is invalid: shown, never sent, and edit mode stays on", () => {
    const t = setup([floorPiece("f1")]);
    t.press("KeyG");
    t.frame(floorAim(0));
    t.drag([floorAim(0), floorAim(1), floorAim(3), floorAim(2)]);
    expect(t.controller.getEditView()!.invalidReason).toBe("Floor cannot be fully opened");
    t.press("Enter");
    t.frame(floorAim(0));
    expect(t.sent()).toEqual([]);
    expect(t.controller.getMode()).toBe(true);
    expect(t.controller.getFeedback()).toMatchObject({ kind: "rejected" });
    // Restoring one quadrant makes it valid: restore first, then removals.
    t.drag([floorAim(3)]);
    t.press("Enter");
    t.frame(floorAim(0));
    expect(t.sent().map((m) => [m.action, m.tileIndex])).toEqual([["select", 0], ["select", 1], ["select", 2], ["confirm", undefined]]);
  });

  it("a ramp press picks the width half under the crosshair; confirm sends that variant", () => {
    const t = setup([ramp("r1")]);
    t.press("KeyG");
    // Ramp (rotation 0) at grid (0,0,-1): the climber's left half is +Z.
    const down = (z: number) => ({ aimOrigin: { x: 2.56, y: 6, z }, aimDirection: { x: 0, y: -1, z: 0 } });
    t.frame(down(-5.12 + 1.28));
    t.frame(down(-5.12 + 1.28), { pressed: true, held: true });
    t.frame(down(-5.12 + 1.28), { held: false });
    expect(t.controller.getEditView()!.draftState).toEqual({ kind: "ramp", variant: "half_left" });
    t.press("Enter");
    t.frame(down(-5.12 + 1.28));
    expect(t.sent()).toEqual([
      { structureId: "r1", action: "select", rampVariant: "half_left" },
      { structureId: "r1", action: "confirm" },
    ]);
  });

  it("nothing is selected or sent while disconnected or out of round", () => {
    for (const extra of [{ connected: false }, { inRound: false }]) {
      const t = setup();
      t.press("KeyG");
      t.frame(wallAim(4), {}, extra);
      t.frame(wallAim(4), { pressed: true, held: true }, extra);
      t.press("Enter");
      t.frame(wallAim(4), {}, extra);
      expect(t.sent()).toEqual([]);
    }
  });

  it("forced exits discard the draft: round reset, disconnect, pointer unlock", () => {
    for (const exit of ["reset", "disconnect", "unlock"] as const) {
      const t = setup();
      t.enterEdit();
      t.drag([wallAim(4)]);
      if (exit === "reset") t.controller.reset();
      else if (exit === "disconnect") t.controller.clearOnDisconnect();
      else { t.env.setLock(null); t.pointerLock.dispatch("pointerlockchange", {}); }
      t.frame(wallAim(4));
      expect(t.sent(), exit).toEqual([]);
      expect(t.controller.getMode(), exit).toBe(false);
    }
  });

  it("the edit target being destroyed drops the draft", () => {
    const t = setup();
    t.enterEdit();
    t.drag([wallAim(4)]);
    t.setBuilding([]);
    t.frame(wallAim(4));
    expect(t.controller.getEditView()).toBeNull();
    expect(t.controller.getFeedback()).toMatchObject({ message: "Edit target lost" });
  });

  it("confirm-on-release (option) applies the drag when the button is released", () => {
    const t = setup(undefined, { confirmOnRelease: true });
    t.enterEdit();
    t.drag([wallAim(6), wallAim(7)]);
    expect(t.sent().map((m) => m.action)).toEqual(["select", "select", "confirm"]);
    expect(t.controller.getMode()).toBe(false);
  });
});

describe("editDiffActions", () => {
  const full = (): StructureEditState => ({ kind: "wall", tiles: Array(9).fill(true) });
  it("is empty for equal states and a single reset for the default target", () => {
    expect(editDiffActions("wall", full(), full())).toEqual([]);
    const edited: StructureEditState = { kind: "wall", tiles: [false, ...Array(8).fill(true)] };
    expect(editDiffActions("wall", edited, full())).toEqual([{ action: "reset" }]);
  });
  it("ramp: a half variant is one select; full is a reset", () => {
    expect(editDiffActions("ramp", { kind: "ramp", variant: "full" }, { kind: "ramp", variant: "half_right" })).toEqual([{ action: "select", rampVariant: "half_right" }]);
    expect(editDiffActions("ramp", { kind: "ramp", variant: "half_right" }, { kind: "ramp", variant: "full" })).toEqual([{ action: "reset" }]);
  });
});
