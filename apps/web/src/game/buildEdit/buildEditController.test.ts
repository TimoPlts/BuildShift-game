/**
 * Unit tests for {@link BuildEditController} — the presentation-only client
 * orchestrator for the server-authoritative piece-edit system.
 *
 * These pin the *authoritative route* and the *cleanup* contracts:
 *
 *  - a routed primary-button press/hold on the crosshair submits canonical
 *    `two-player:edit_grid_action` tile intents (`select` / `deselect`) with
 *    the mapped tile index — the controller never edits structures itself;
 *  - the pending state is applied optimistically on send and converges from
 *    the authoritative result broadcast (success) or rolls back
 *    (rejection, with a labelled banner);
 *  - `Enter` / `C` / `Backspace` submit `confirm` / `cancel` / `reset` only
 *    when the piece was actually changed, and confirm/cancel exit edit mode;
 *  - the optional confirm-on-release knob commits on the release edge;
 *  - round reset, disconnect, cancel, and dispose all clear the
 *    presentation state (mode, target, feedback, pending caches).
 *
 * The real {@link BuildEditInputController} is driven through a fake
 * event-target environment, and a fake {@link BuildEditNetworkLike} stands in
 * for the network — so the whole client-side route (keys + routed button →
 * intent → wire message → result → feedback / convergence) is exercised
 * without a server.
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

interface Setup {
  key: FakeTarget;
  network: FakeNetwork;
  controller: BuildEditController;
  setClock(v: number): void;
  lock(): void;
  unlock(): void;
}

function setup(
  _building: BuildingState,
  startClock = 0,
  options?: { confirmOnRelease?: boolean },
): Setup {
  const canvas = {};
  const { env, key } = makeEnv();
  const network = new FakeNetwork();
  let clock = startClock;
  const controller = new BuildEditController(
    new BuildEditInputController(canvas as HTMLCanvasElement, env),
    network,
    () => clock,
    options?.confirmOnRelease !== undefined
      ? { confirmOnRelease: options.confirmOnRelease }
      : undefined,
  );
  return {
    key,
    network,
    controller,
    setClock(v) {
      clock = v;
    },
    lock() {
      env.setLock(canvas);
    },
    unlock() {
      env.setLock(null);
    },
  };
}

/**
 * A render frame aimed straight down -Z from (0, 2, 0) — the crosshair sits
 * on the centre tile (index 4) of a wall at grid (0,0,-1).
 */
function frame(
  building: BuildingState,
  overrides: Partial<BuildEditFrameContext> = {},
): BuildEditFrameContext {
  return {
    aimOrigin: { x: 0, y: 2, z: 0 },
    aimDirection: { x: 0, y: 0, z: -1 },
    playerPosition: { x: 0, y: 0, z: 0 },
    building,
    sessionId: OWNER,
    connected: true,
    inRound: true,
    editSelectPressed: false,
    editSelectHeld: false,
    ...overrides,
  };
}

/** Locks, enters edit mode, and runs one frame aimed at the structures. */
function enterEditMode(s: Setup, building: BuildingState) {
  s.lock();
  s.key.dispatch("keydown", { code: "KeyF", repeat: false });
  s.controller.updateFrame(frame(building));
}

/** One routed primary-button press frame (click). */
function clickFrame(building: BuildingState): BuildEditFrameContext {
  return frame(building, { editSelectPressed: true, editSelectHeld: true });
}

/** A hold frame with no press edge. */
function holdFrame(building: BuildingState): BuildEditFrameContext {
  return frame(building, { editSelectHeld: true });
}

afterEach(() => {
  // Controllers are disposed inside each test; nothing global to reset.
});

describe("BuildEditController — tile selection route", () => {
  it("submits a canonical select intent for the crosshair tile (centre wall tile)", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building));

    expect(s.network.sent).toHaveLength(1);
    expect(s.network.sent[0]!.type).toBe(EDIT_GRID_ACTION_MESSAGE);
    expect(s.network.sent[0]!.payload).toEqual({
      structureId: "wall1",
      action: "select",
      tileIndex: 4,
    });
    // Optimistic pending state: the centre tile is now open.
    const pending = s.controller.getPendingState();
    expect(pending).toEqual({
      kind: "wall",
      tiles: [true, true, true, true, false, true, true, true, true],
    });
  });

  it("re-clicking the same tile submits deselect (back to solid)", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building)); // select tile 4
    s.controller.updateFrame(clickFrame(building)); // same tile again → deselect

    expect(s.network.sent).toHaveLength(2);
    expect(s.network.sent[1]!.payload).toEqual({
      structureId: "wall1",
      action: "deselect",
      tileIndex: 4,
    });
    expect(wallTiles(s.controller.getPendingState())?.every(Boolean)).toBe(true);
  });

  it("maps the crosshair onto the aimed tile (top-left aim selects tile 0)", () => {
    // Aim from above-left so the hit point lands in the top-left tile.
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(
      frame(building, {
        aimOrigin: { x: -2, y: 3.5, z: 0 },
        aimDirection: { x: 0, y: 0, z: -1 },
        editSelectPressed: true,
        editSelectHeld: true,
      }),
    );
    // Hit at (−2, 3.5, −2.56): col 0, row 0 → tile 0.
    expect(s.network.sent[0]!.payload).toEqual({
      structureId: "wall1",
      action: "select",
      tileIndex: 0,
    });
  });

  it("hold-drag paints each new tile once (no re-apply on the same tile)", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    // Press on the centre tile.
    s.controller.updateFrame(clickFrame(building));
    // Hold on the same tile — nothing new.
    s.controller.updateFrame(holdFrame(building));
    s.controller.updateFrame(holdFrame(building));
    // Hold onto a different tile — a fresh toggle.
    s.controller.updateFrame(
      frame(building, {
        aimOrigin: { x: 2, y: 2, z: 0 },
        aimDirection: { x: 0, y: 0, z: -1 },
        editSelectHeld: true,
      }),
    );
    expect(s.network.sent).toHaveLength(2);
    expect(s.network.sent[1]!.payload).toEqual({
      structureId: "wall1",
      action: "select",
      tileIndex: 5, // right column, middle row
    });
    // Release — no intent.
    s.controller.updateFrame(frame(building));
    expect(s.network.sent).toHaveLength(2);
  });

  it("selects ramp halves with the rampVariant payload (no tileIndex)", () => {
    const building = buildingOf([ramp("ramp1")]);
    const s = setup(building);
    // The ramp at grid (0,0,-1) spans x ∈ [-2.56, 7.68]; aim at its right
    // (high) half: hit x=5 → local x=5 > 0 → right.
    enterEditMode(s, building);
    s.controller.updateFrame(
      frame(building, {
        aimOrigin: { x: 5, y: 2, z: 0 },
        aimDirection: { x: 0, y: 0, z: -1 },
        editSelectPressed: true,
        editSelectHeld: true,
      }),
    );
    expect(s.network.sent[0]!.payload).toEqual({
      structureId: "ramp1",
      action: "select",
      rampVariant: "half_right",
    });
    // Same half again → deselect back to full.
    s.controller.updateFrame(
      frame(building, {
        aimOrigin: { x: 5, y: 2, z: 0 },
        aimDirection: { x: 0, y: 0, z: -1 },
        editSelectPressed: true,
        editSelectHeld: true,
      }),
    );
    expect(s.network.sent[1]!.payload).toEqual({
      structureId: "ramp1",
      action: "deselect",
      rampVariant: "half_right",
    });
    expect(s.controller.getPendingState()).toEqual({ kind: "ramp", variant: "full" });
  });

  it("does not send a tile intent for the remote player's structure", () => {
    const building = buildingOf([
      wall("theirs", { x: 0, y: 0, z: -1 }, { ownerId: "them" }),
    ]);
    const s = setup(building);
    enterEditMode(s, building);
    // No owned structure under the crosshair → no target, no send.
    s.controller.updateFrame(clickFrame(building));
    expect(s.network.sent).toHaveLength(0);
    expect(s.controller.getTarget()).toBeNull();
  });

  it("does not send when disconnected or outside the round", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(frame(building, { connected: false, editSelectPressed: true, editSelectHeld: true }));
    s.controller.updateFrame(frame(building, { inRound: false, editSelectPressed: true, editSelectHeld: true }));
    expect(s.network.sent).toHaveLength(0);
  });

  it("does not send when not in edit mode", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    s.lock();
    // No edit mode toggle.
    s.controller.updateFrame(clickFrame(building));
    expect(s.network.sent).toHaveLength(0);
    expect(s.controller.getTarget()).toBeNull();
  });
});

describe("BuildEditController — terminal actions", () => {
  it("confirm sends confirm only when the piece was changed, then exits edit mode", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building)); // touch
    s.key.dispatch("keydown", { code: "Enter", repeat: false });
    s.controller.updateFrame(frame(building));

    expect(s.network.sent).toHaveLength(2);
    expect(s.network.sent[1]!.payload).toEqual({ structureId: "wall1", action: "confirm" });
    expect(s.controller.getMode()).toBe(false);
  });

  it("confirm exits edit mode without sending for an untouched piece", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.key.dispatch("keydown", { code: "Enter", repeat: false });
    s.controller.updateFrame(frame(building));

    expect(s.network.sent).toHaveLength(0);
    expect(s.controller.getMode()).toBe(false);
  });

  it("cancel sends cancel when touched, then exits edit mode", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building)); // touch
    s.key.dispatch("keydown", { code: "KeyC", repeat: false });
    s.controller.updateFrame(frame(building));

    expect(s.network.sent[1]!.payload).toEqual({ structureId: "wall1", action: "cancel" });
    expect(s.controller.getMode()).toBe(false);
  });

  it("reset sends reset when touched and keeps edit mode on", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building)); // touch
    s.key.dispatch("keydown", { code: "Backspace", repeat: false });
    s.controller.updateFrame(frame(building));

    expect(s.network.sent[1]!.payload).toEqual({ structureId: "wall1", action: "reset" });
    expect(s.controller.getMode()).toBe(true);
  });

  it("resets the touched flag: a second reset without edits sends nothing", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building)); // touch
    s.key.dispatch("keydown", { code: "Backspace", repeat: false });
    s.controller.updateFrame(frame(building));
    s.network.emitResult({
      structureId: "wall1",
      success: true,
      editState: { kind: "wall", tiles: [true, true, true, true, true, true, true, true, true] },
    });
    // After the reset, the piece is default again — no new edits, so a
    // confirm has nothing to send (only the select + reset went out).
    s.key.dispatch("keydown", { code: "Enter", repeat: false });
    s.controller.updateFrame(frame(building));
    expect(s.network.sent).toHaveLength(2);
    expect(s.controller.getMode()).toBe(false);
  });

  it("confirms in flight: an earlier tile select is still pending when confirm is sent", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building)); // select (unacked)
    s.key.dispatch("keydown", { code: "Enter", repeat: false });
    s.controller.updateFrame(frame(building)); // confirm sent after select

    const actions = s.network.sent.map((m) => (m.payload as { action: string }).action);
    expect(actions).toEqual(["select", "confirm"]);
  });
});

describe("BuildEditController — fast authoritative edit reset (repeat cycles)", () => {
  it("snaps the pending state to the default immediately, before the result arrives", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building)); // select tile 4 (optimistic: open)
    expect(wallTiles(s.controller.getPendingState())?.[4]).toBe(false);

    // Fast reset: the reset is applied optimistically the moment it is sent.
    s.key.dispatch("keydown", { code: "Backspace", repeat: false });
    s.controller.updateFrame(frame(building));
    // No result has arrived yet — the preview already shows the full/default
    // canonical form (every tile solid).
    expect(s.controller.getPendingState()).toEqual({
      kind: "wall",
      tiles: [true, true, true, true, true, true, true, true, true],
    });
    // The reset intent was submitted (authoritative path unchanged).
    expect(s.network.sent.at(-1)?.payload).toEqual({
      structureId: "wall1",
      action: "reset",
    });

    // The authoritative result converges to the same default state.
    s.network.emitResult({
      structureId: "wall1",
      success: true,
      editState: { kind: "wall", tiles: [true, true, true, true, true, true, true, true, true] },
    });
    expect(s.controller.getPendingState()).toEqual({
      kind: "wall",
      tiles: [true, true, true, true, true, true, true, true, true],
    });
  });

  it("replicates identically across repeated edit → reset → edit cycles", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);

    // Cycle 1: edit tile 4.
    s.controller.updateFrame(clickFrame(building));
    const cycle1Select = s.network.sent[0]?.payload;
    const cycle1Pending = s.controller.getPendingState();

    // Reset and let both in-flight actions resolve to the canonical default.
    s.key.dispatch("keydown", { code: "Backspace", repeat: false });
    s.controller.updateFrame(frame(building));
    s.network.emitResult({
      structureId: "wall1",
      success: true,
      editState: { kind: "wall", tiles: [true, true, true, true, false, true, true, true, true] },
    });
    s.network.emitResult({
      structureId: "wall1",
      success: true,
      editState: { kind: "wall", tiles: [true, true, true, true, true, true, true, true, true] },
    });
    // Back to the canonical baseline — no tile open.
    expect(wallTiles(s.controller.getPendingState())?.every(Boolean)).toBe(true);

    // Cycle 2: the same edit from the reset baseline must replicate exactly.
    s.controller.updateFrame(clickFrame(building));
    const cycle2Select = s.network.sent.at(-1)?.payload;
    const cycle2Pending = s.controller.getPendingState();

    // Identical wire intent and identical pending state for the same edit.
    expect(cycle2Select).toEqual(cycle1Select);
    expect(cycle2Select).toEqual({ structureId: "wall1", action: "select", tileIndex: 4 });
    expect(cycle2Pending).toEqual(cycle1Pending);
    expect(wallTiles(cycle2Pending)?.[4]).toBe(false);
  });

  it("snaps a ramp reset to the full variant immediately", () => {
    const building = buildingOf([ramp("ramp1")]);
    const s = setup(building);
    enterEditMode(s, building);
    const aimAtRightHalf = (overrides: Partial<BuildEditFrameContext> = {}) =>
      frame(building, {
        aimOrigin: { x: 5, y: 2, z: 0 },
        aimDirection: { x: 0, y: 0, z: -1 },
        ...overrides,
      });
    s.controller.updateFrame(aimAtRightHalf({ editSelectPressed: true, editSelectHeld: true }));
    expect(s.controller.getPendingState()).toEqual({ kind: "ramp", variant: "half_right" });

    s.key.dispatch("keydown", { code: "Backspace", repeat: false });
    s.controller.updateFrame(aimAtRightHalf());
    // Fast reset: the preview is immediately the full (canonical) ramp.
    expect(s.controller.getPendingState()).toEqual({ kind: "ramp", variant: "full" });
    expect(s.network.sent.at(-1)?.payload).toEqual({ structureId: "ramp1", action: "reset" });
  });

  it("rolls a rejected fast reset back to the authoritative state (no weakening)", () => {
    // No static editGrid in the mirror: the authoritative state is driven
    // purely by the accepted select result below, so the mirror sync cannot
    // override it.
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building)); // select tile 4 (optimistic: open)
    // The server accepts the select: authoritative state now has tile 4 open.
    s.network.emitResult({
      structureId: "wall1",
      success: true,
      editState: { kind: "wall", tiles: [true, true, true, true, false, true, true, true, true] },
    });

    // Fast reset is applied optimistically (default)...
    s.key.dispatch("keydown", { code: "Backspace", repeat: false });
    s.controller.updateFrame(frame(building));
    expect(wallTiles(s.controller.getPendingState())?.every(Boolean)).toBe(true);

    // ...but the server rejects it, so the optimistic default is discarded and
    // the pending state rolls back to the authoritative (tile 4 open) state.
    s.network.emitResult({ structureId: "wall1", success: false, reason: "invalid_player_state" });
    expect(wallTiles(s.controller.getPendingState())?.[4]).toBe(false);
    expect(s.controller.getFeedback()?.kind).toBe("rejected");
  });

  it("sends nothing and changes nothing for an untouched piece on reset", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(frame(building)); // no edits
    s.key.dispatch("keydown", { code: "Backspace", repeat: false });
    s.controller.updateFrame(frame(building));
    expect(s.network.sent).toHaveLength(0);
    // The piece was never edited: the pending state is already the default.
    expect(wallTiles(s.controller.getPendingState())?.every(Boolean)).toBe(true);
    // Reset keeps edit mode on (a further edit would continue immediately).
    expect(s.controller.getMode()).toBe(true);
  });
});

describe("BuildEditController — result convergence + feedback", () => {
  it("converges the pending state from the success broadcast and stays silent for tile toggles", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building)); // optimistic: tile 4 open
    expect(wallTiles(s.controller.getPendingState())?.[4]).toBe(false);

    // The server confirms with its canonical post-action state.
    const serverTiles = [true, true, true, true, false, true, true, true, true];
    s.network.emitResult({
      structureId: "wall1",
      success: true,
      editState: { kind: "wall", tiles: serverTiles },
    });
    // No feedback banner for plain tile toggles (the shape is the feedback).
    // Advance past the shorter mode-banner TTL first: the "Edit mode on"
    // notice from entering edit mode is still live at t=0, and a tile
    // toggle must not add anything on top of it.
    s.setClock(2_500);
    s.controller.updateFrame(frame(building));
    expect(s.controller.getFeedback()).toBeNull();
    // Pending now equals the authoritative state.
    expect(s.controller.getPendingState()).toEqual({ kind: "wall", tiles: serverTiles });
  });

  it("shows accepted feedback for confirm and info feedback for cancel/reset", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building));
    s.key.dispatch("keydown", { code: "Enter", repeat: false });
    s.controller.updateFrame(frame(building));
    s.network.emitResult({
      structureId: "wall1",
      success: true,
      editState: { kind: "wall", tiles: [true, true, true, true, false, true, true, true, true] },
    });
    expect(s.controller.getFeedback()).toEqual({
      kind: "accepted",
      message: "Edit confirmed",
      structureId: "wall1",
    });
  });

  it("rolls back the optimistic state and shows labelled rejection feedback", () => {
    const building = buildingOf([
      wall("wall1", { x: 0, y: 0, z: -1 }, {
        editGrid: { kind: "wall", tiles: [true, true, true, true, true, true, true, true, true] },
      }),
    ]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building)); // optimistic: tile 4 open
    expect(wallTiles(s.controller.getPendingState())?.[4]).toBe(false);

    // The server rejects (e.g. the round just ended).
    s.network.emitResult({ structureId: "wall1", success: false, reason: "invalid_player_state" });
    const fb = s.controller.getFeedback();
    expect(fb?.kind).toBe("rejected");
    expect(fb?.message).toBe("Editing unavailable now");
    // The pending state rolled back to the authoritative default.
    expect(wallTiles(s.controller.getPendingState())?.[4]).toBe(true);
  });

  it("keeps the optimistic state while earlier actions are still in flight", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building)); // select tile 4 (in flight)
    // A second, different tile is selected before the first answer arrives.
    s.controller.updateFrame(
      frame(building, {
        aimOrigin: { x: 2, y: 2, z: 0 },
        aimDirection: { x: 0, y: 0, z: -1 },
        editSelectPressed: true,
        editSelectHeld: true,
      }),
    );
    // The first result arrives — the second action is still pending, so the
    // optimistic state (both tiles open) is kept.
    s.network.emitResult({
      structureId: "wall1",
      success: true,
      editState: { kind: "wall", tiles: [true, true, true, true, false, true, true, true, true] },
    });
    const pending = s.controller.getPendingState();
    expect(pending?.kind).toBe("wall");
    expect(wallTiles(pending)?.[4]).toBe(false);
    expect(wallTiles(pending)?.[5]).toBe(false);
    // The second result lands — convergence to the server state.
    s.network.emitResult({
      structureId: "wall1",
      success: true,
      editState: { kind: "wall", tiles: [true, true, true, true, false, false, true, true, true] },
    });
    expect(s.controller.getPendingState()).toEqual({
      kind: "wall",
      tiles: [true, true, true, true, false, false, true, true, true],
    });
  });

  it("adopts the replicated editGrid from the mirror (opponent's edits converge)", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    // The mirrored state now carries an edit grid the opponent committed.
    const updated = buildingOf([
      wall("wall1", { x: 0, y: 0, z: -1 }, {
        editGrid: { kind: "wall", tiles: [true, true, true, false, false, false, true, true, true] },
      }),
    ]);
    s.controller.updateFrame(frame(updated));
    expect(s.controller.getPendingState()).toEqual({
      kind: "wall",
      tiles: [true, true, true, false, false, false, true, true, true],
    });
  });

  it("ignores a result for a structure with no local in-flight action (opponent's)", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.network.emitResult({
      structureId: "wall1",
      success: false,
      reason: "not_owned",
    });
    // No banner for someone else's rejection.
    expect(s.controller.getFeedback()?.kind).not.toBe("rejected");
  });

  it("ignores malformed result payloads", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    s.network.emitResult({ success: true }); // missing structureId
    s.network.emitResult(null);
    expect(s.controller.getFeedback()).toBeNull();
  });
});

describe("BuildEditController — confirm on release", () => {
  it("commits on the release edge when the option is enabled", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building, 0, { confirmOnRelease: true });
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building)); // select tile 4
    s.controller.updateFrame(holdFrame(building)); // still held
    s.controller.updateFrame(frame(building)); // release
    const actions = s.network.sent.map((m) => (m.payload as { action: string }).action);
    expect(actions).toEqual(["select", "confirm"]);
    expect(s.controller.getMode()).toBe(false);
  });

  it("does not commit on release when the option is disabled", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building, 0, { confirmOnRelease: false });
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building));
    s.controller.updateFrame(holdFrame(building));
    s.controller.updateFrame(frame(building)); // release
    const actions = s.network.sent.map((m) => (m.payload as { action: string }).action);
    expect(actions).toEqual(["select"]);
    expect(s.controller.getMode()).toBe(true);
  });
});

describe("BuildEditController — edit-mode enter/exit feedback", () => {
  it("shows an info banner when edit mode is entered and exited", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building, 0);
    s.lock();
    s.key.dispatch("keydown", { code: "KeyF", repeat: false });
    s.controller.updateFrame(frame(building));
    expect(s.controller.getFeedback()).toEqual({
      kind: "info",
      message: "Edit mode on",
    });

    s.key.dispatch("keydown", { code: "KeyF", repeat: false });
    s.controller.updateFrame(frame(building));
    expect(s.controller.getFeedback()).toEqual({
      kind: "info",
      message: "Edit mode off",
    });

    // The info banner expires on its (shorter) TTL.
    s.setClock(2_000);
    s.controller.updateFrame(frame(building));
    expect(s.controller.getFeedback()).toBeNull();
  });

  it("does not clobber a live accepted/rejected banner with an exit notice", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building, 0);
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building));
    s.key.dispatch("keydown", { code: "Enter", repeat: false });
    s.controller.updateFrame(frame(building)); // confirm sent + exit
    s.network.emitResult({
      structureId: "wall1",
      success: true,
      editState: { kind: "wall", tiles: [true, true, true, true, false, true, true, true, true] },
    });
    expect(s.controller.getFeedback()?.kind).toBe("accepted");

    // The confirm exit happened inside the result banner's TTL; the verdict
    // stays on screen.
    expect(s.controller.getFeedback()).toEqual({
      kind: "accepted",
      message: "Edit confirmed",
      structureId: "wall1",
    });
  });

  it("shows no exit banner for a forced exit (round reset / disconnect)", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);

    s.controller.reset();
    s.controller.updateFrame(frame(building));
    expect(s.controller.getFeedback()).toBeNull();

    enterEditMode(s, building);
    s.controller.clearOnDisconnect();
    s.controller.updateFrame(frame(building));
    expect(s.controller.getFeedback()).toBeNull();
  });
});

describe("BuildEditController — feedback expiry (injectable clock)", () => {
  it("keeps result feedback until its TTL elapses, then clears it", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building, 0);
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building));
    s.key.dispatch("keydown", { code: "Enter", repeat: false });
    s.controller.updateFrame(frame(building)); // sent at t=0
    s.network.emitResult({
      structureId: "wall1",
      success: true,
      editState: { kind: "wall", tiles: [true, true, true, true, false, true, true, true, true] },
    }); // feedbackUntil = 3000
    expect(s.controller.getFeedback()?.kind).toBe("accepted");

    s.setClock(2_999);
    s.controller.updateFrame(frame(building));
    expect(s.controller.getFeedback()?.kind).toBe("accepted");

    s.setClock(3_000);
    s.controller.updateFrame(frame(building));
    expect(s.controller.getFeedback()).toBeNull();
  });
});

describe("BuildEditController — cleanup triggers", () => {
  it("resets (round reset / rematch): exits mode, clears target + feedback + caches", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building));
    s.network.emitResult({
      structureId: "wall1",
      success: true,
      editState: { kind: "wall", tiles: [true, true, true, true, false, true, true, true, true] },
    });
    expect(s.controller.getTarget()).not.toBeNull();

    s.controller.reset();
    expect(s.controller.getMode()).toBe(false);
    expect(s.controller.getTarget()).toBeNull();
    expect(s.controller.getFeedback()).toBeNull();
    // The pending state is gone (no cache, back to the default derivation).
    s.lock();
    s.key.dispatch("keydown", { code: "KeyF", repeat: false });
    s.controller.updateFrame(frame(building));
    expect(wallTiles(s.controller.getPendingState())?.every(Boolean)).toBe(true);
  });

  it("clears on disconnect: exits mode, clears target + feedback", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(clickFrame(building));
    s.network.emitResult({
      structureId: "wall1",
      success: true,
      editState: { kind: "wall", tiles: [true, true, true, true, false, true, true, true, true] },
    });

    s.controller.clearOnDisconnect();
    expect(s.controller.getMode()).toBe(false);
    expect(s.controller.getTarget()).toBeNull();
    expect(s.controller.getFeedback()).toBeNull();
  });

  it("cancel() clears the target and feedback while keeping the mode", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.updateFrame(frame(building));
    expect(s.controller.getTarget()).not.toBeNull();

    s.controller.cancel();
    expect(s.controller.getTarget()).toBeNull();
    expect(s.controller.getFeedback()).toBeNull();
    // Mode stays on (the player is still in edit mode).
    expect(s.controller.getMode()).toBe(true);
  });

  it("dispose() unsubscribes: later results are ignored", () => {
    const building = buildingOf([wall("wall1")]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.dispose();
    s.network.emitResult({ structureId: "wall1", success: true });
    expect(s.controller.getFeedback()).toBeNull();
    // A frame after dispose reports no target.
    expect(s.controller.updateFrame(frame(building))).toBeNull();
  });
});
