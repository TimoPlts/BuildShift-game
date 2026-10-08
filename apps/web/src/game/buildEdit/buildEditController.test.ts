/**
 * Unit tests for {@link BuildEditController} — the presentation-only client
 * orchestrator for the server-authoritative build-edit system.
 *
 * These pin the *authoritative route* and the *cleanup* contracts:
 *
 *  - an apply press submits a canonical `build:edit_request`
 *    (`BUILD_EDIT_EVENTS.EDIT_REQUEST`) carrying `{structureId, editType}` —
 *    the controller never edits structures itself;
 *  - an authoritative `build:edit_result`
 *    (`BUILD_EDIT_EVENTS.EDIT_RESULT`) turns into accepted/rejected feedback
 *    (with the rejection reason mapped to a short label), then expires on the
 *    (injectable) clock;
 *  - the chosen edit is clamped to what the targeted structure allows, so the
 *    preview always reflects an applicable edit;
 *  - cancellation, round reset, disconnect and dispose all clear the
 *    presentation state (mode, target, feedback) and (on reset/disconnect)
 *    force edit mode off.
 *
 * The real {@link BuildEditInputController} is driven through a fake
 * event-target environment, and a fake {@link BuildEditNetworkLike} stands in
 * for the network — so the whole client-side route (keys → intent → wire
 * message → result → feedback) is exercised without a server.
 */
import { afterEach, describe, expect, it } from "vitest";
import { BUILD_EDIT_EVENTS } from "@buildshift/protocol";
import type { BuildingState, StructureState } from "@buildshift/protocol";
import {
  BuildEditController,
  supportedEditsFor,
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
    if (name === BUILD_EDIT_EVENTS.EDIT_RESULT) {
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

function wall(id: string, grid: { x: number; y: number; z: number }): StructureState {
  return { structureId: id, buildType: "wall", grid, rotation: 0, ownerId: OWNER, createdSequence: 0 };
}
function floor(id: string, grid: { x: number; y: number; z: number }): StructureState {
  return { structureId: id, buildType: "floor", grid, rotation: 0, ownerId: OWNER, createdSequence: 0 };
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

function setup(_building: BuildingState, startClock = 0): Setup {
  const canvas = {};
  const { env, key } = makeEnv();
  const network = new FakeNetwork();
  let clock = startClock;
  const controller = new BuildEditController(
    new BuildEditInputController(canvas as HTMLCanvasElement, env),
    network,
    () => clock,
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

/** A render frame aimed straight down -Z at the structures at z=-3. */
function frame(building: BuildingState, overrides: Partial<Parameters<BuildEditController["updateFrame"]>[0]> = {}) {
  return {
    aimOrigin: { x: 0, y: 2, z: 0 },
    aimDirection: { x: 0, y: 0, z: -1 },
    playerPosition: { x: 0, y: 0, z: 0 },
    building,
    sessionId: OWNER,
    connected: true,
    ...overrides,
  };
}

/** Locks, enters edit mode, and runs one frame aimed at the structures. */
function enterEditMode(s: Setup, building: BuildingState) {
  s.lock();
  s.key.dispatch("keydown", { code: "KeyF", repeat: false });
  s.controller.updateFrame(frame(building));
}

afterEach(() => {
  // Controllers are disposed inside each test; nothing global to reset.
});

describe("supportedEditsFor", () => {
  it("allows all four opening edits on a wall", () => {
    expect(supportedEditsFor("wall").sort()).toEqual(
      ["door", "half_bottom", "half_top", "window"].sort(),
    );
  });
  it("allows only the bottom-half edit on a floor", () => {
    expect(supportedEditsFor("floor")).toEqual(["half_bottom"]);
  });
  it("allows no edits on a cone", () => {
    expect(supportedEditsFor("cone")).toEqual([]);
  });
});

describe("BuildEditController — authoritative route", () => {
  it("submits a canonical build:edit_request for the targeted owned wall", () => {
    const building = buildingOf([wall("wall1", { x: 0, y: 0, z: -3 })]);
    const s = setup(building);
    enterEditMode(s, building);
    s.key.dispatch("keydown", { code: "Digit5", repeat: false }); // door
    s.controller.updateFrame(frame(building));
    s.key.dispatch("keydown", { code: "Enter", repeat: false }); // apply
    s.controller.updateFrame(frame(building));

    expect(s.network.sent).toHaveLength(1);
    expect(s.network.sent[0]!.type).toBe(BUILD_EDIT_EVENTS.EDIT_REQUEST);
    expect(s.network.sent[0]!.payload).toEqual({ structureId: "wall1", editType: "door" });
    // No accepted/rejected feedback until the server replies — only the
    // edit-mode enter (info) banner is on screen.
    expect(s.controller.getFeedback()?.kind).toBe("info");
  });

  it("turns an accepted result into accepted feedback", () => {
    const building = buildingOf([wall("wall1", { x: 0, y: 0, z: -3 })]);
    const s = setup(building);
    enterEditMode(s, building);
    s.key.dispatch("keydown", { code: "Digit5", repeat: false });
    s.controller.updateFrame(frame(building));
    s.key.dispatch("keydown", { code: "Enter", repeat: false });
    s.controller.updateFrame(frame(building));

    s.network.emitResult({ structureId: "wall1", success: true });
    const fb = s.controller.getFeedback();
    expect(fb?.kind).toBe("accepted");
    expect(fb?.message).toBe("Edit applied");
  });

  it("names the confirmed edit in the accepted feedback", () => {
    const building = buildingOf([wall("wall1", { x: 0, y: 0, z: -3 })]);
    const s = setup(building);
    enterEditMode(s, building);
    s.network.emitResult({ structureId: "wall1", success: true, editType: "door" });
    expect(s.controller.getFeedback()?.message).toBe("Edit applied: Door");

    s.network.emitResult({ structureId: "wall1", success: true, editType: "half_top" });
    expect(s.controller.getFeedback()?.message).toBe("Edit applied: Top half");

    // A cleared opening ("" editType) gets its own message.
    s.network.emitResult({ structureId: "wall1", success: true, editType: "" });
    expect(s.controller.getFeedback()?.message).toBe("Opening cleared");
  });

  it("ignores an out-of-vocabulary editType on the wire", () => {
    const building = buildingOf([wall("wall1", { x: 0, y: 0, z: -3 })]);
    const s = setup(building);
    s.network.emitResult({ structureId: "wall1", success: true, editType: "bogus" });
    // The corrupt field is dropped; the accepted message falls back.
    expect(s.controller.getFeedback()?.message).toBe("Edit applied");
  });

  it("turns a rejected result into labelled rejected feedback", () => {
    const building = buildingOf([wall("wall1", { x: 0, y: 0, z: -3 })]);
    const s = setup(building);
    enterEditMode(s, building);
    s.key.dispatch("keydown", { code: "Digit5", repeat: false });
    s.controller.updateFrame(frame(building));
    s.key.dispatch("keydown", { code: "Enter", repeat: false });
    s.controller.updateFrame(frame(building));

    s.network.emitResult({ structureId: "wall1", success: false, reason: "not_owned" });
    const fb = s.controller.getFeedback();
    expect(fb?.kind).toBe("rejected");
    expect(fb?.message).toBe("Not your structure");
  });

  it("ignores malformed result payloads", () => {
    const building = buildingOf([wall("wall1", { x: 0, y: 0, z: -3 })]);
    const s = setup(building);
    s.network.emitResult({ success: true }); // missing structureId
    expect(s.controller.getFeedback()).toBeNull();
  });

  it("does not send an edit when disconnected", () => {
    const building = buildingOf([wall("wall1", { x: 0, y: 0, z: -3 })]);
    const s = setup(building);
    enterEditMode(s, building);
    s.key.dispatch("keydown", { code: "Digit5", repeat: false });
    s.controller.updateFrame(frame(building));
    s.key.dispatch("keydown", { code: "Enter", repeat: false });
    // Not connected → no send.
    s.controller.updateFrame(frame(building, { connected: false }));
    expect(s.network.sent).toHaveLength(0);
  });

  it("does not send an edit with no target", () => {
    const building = buildingOf([wall("wall1", { x: 0, y: 0, z: -3 })]);
    const s = setup(building);
    s.lock();
    // Not in edit mode → no target.
    s.key.dispatch("keydown", { code: "Enter", repeat: false });
    s.controller.updateFrame(frame(building));
    expect(s.network.sent).toHaveLength(0);
    expect(s.controller.getTarget()).toBeNull();
  });
});

describe("BuildEditController — selection clamping", () => {
  it("clamps an invalid edit to the first edit the target allows (floor)", () => {
    const building = buildingOf([floor("floor1", { x: 0, y: 0, z: -3 })]);
    const s = setup(building);
    s.lock();
    s.key.dispatch("keydown", { code: "KeyF", repeat: false });
    // Choose "door" (Digit5) — invalid on a floor; it must clamp to half_bottom.
    s.key.dispatch("keydown", { code: "Digit5", repeat: false });
    s.controller.updateFrame(frame(building));
    expect(s.controller.getTarget()?.structureId).toBe("floor1");
    expect(s.controller.getSelectedEdit()).toBe("half_bottom");
  });

  it("keeps a valid choice across frames", () => {
    const building = buildingOf([wall("wall1", { x: 0, y: 0, z: -3 })]);
    const s = setup(building);
    s.lock();
    s.key.dispatch("keydown", { code: "KeyF", repeat: false });
    s.key.dispatch("keydown", { code: "Digit6", repeat: false }); // window
    s.controller.updateFrame(frame(building));
    expect(s.controller.getSelectedEdit()).toBe("window");
    s.controller.updateFrame(frame(building)); // no new choice → stays
    expect(s.controller.getSelectedEdit()).toBe("window");
  });
});

describe("BuildEditController — edit-mode enter/exit feedback", () => {
  it("shows an info banner when edit mode is entered and exited", () => {
    const building = buildingOf([wall("wall1", { x: 0, y: 0, z: -3 })]);
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
    const building = buildingOf([wall("wall1", { x: 0, y: 0, z: -3 })]);
    const s = setup(building, 0);
    enterEditMode(s, building);
    s.network.emitResult({ structureId: "wall1", success: true, editType: "door" });
    expect(s.controller.getFeedback()?.kind).toBe("accepted");

    // Exiting within the result banner's TTL keeps the server's verdict on screen.
    s.key.dispatch("keydown", { code: "KeyF", repeat: false });
    s.controller.updateFrame(frame(building));
    expect(s.controller.getFeedback()).toEqual({
      kind: "accepted",
      message: "Edit applied: Door",
      structureId: "wall1",
    });
  });

  it("shows no exit banner for a forced exit (round reset / disconnect)", () => {
    const building = buildingOf([wall("wall1", { x: 0, y: 0, z: -3 })]);
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
  it("keeps feedback until its TTL elapses, then clears it", () => {
    const building = buildingOf([wall("wall1", { x: 0, y: 0, z: -3 })]);
    const s = setup(building, 0);
    enterEditMode(s, building);
    s.key.dispatch("keydown", { code: "Digit5", repeat: false });
    s.controller.updateFrame(frame(building));
    s.key.dispatch("keydown", { code: "Enter", repeat: false });
    s.controller.updateFrame(frame(building)); // sent at t=0
    s.network.emitResult({ structureId: "wall1", success: true }); // feedbackUntil = 3000
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
  it("resets (round reset / rematch): exits mode, clears target + feedback", () => {
    const building = buildingOf([wall("wall1", { x: 0, y: 0, z: -3 })]);
    const s = setup(building);
    enterEditMode(s, building);
    s.key.dispatch("keydown", { code: "Digit5", repeat: false });
    s.controller.updateFrame(frame(building));
    s.network.emitResult({ structureId: "wall1", success: true });
    expect(s.controller.getTarget()).not.toBeNull();
    expect(s.controller.getFeedback()).not.toBeNull();

    s.controller.reset();
    expect(s.controller.getMode()).toBe(false);
    expect(s.controller.getTarget()).toBeNull();
    expect(s.controller.getFeedback()).toBeNull();
    expect(s.controller.getSelectedEdit()).toBe("door");
  });

  it("clears on disconnect: exits mode, clears target + feedback", () => {
    const building = buildingOf([wall("wall1", { x: 0, y: 0, z: -3 })]);
    const s = setup(building);
    enterEditMode(s, building);
    s.key.dispatch("keydown", { code: "Digit5", repeat: false });
    s.controller.updateFrame(frame(building));
    s.network.emitResult({ structureId: "wall1", success: true });

    s.controller.clearOnDisconnect();
    expect(s.controller.getMode()).toBe(false);
    expect(s.controller.getTarget()).toBeNull();
    expect(s.controller.getFeedback()).toBeNull();
  });

  it("cancel() clears the preview and feedback while keeping the mode", () => {
    const building = buildingOf([wall("wall1", { x: 0, y: 0, z: -3 })]);
    const s = setup(building);
    enterEditMode(s, building);
    s.key.dispatch("keydown", { code: "Digit5", repeat: false });
    s.controller.updateFrame(frame(building));
    s.network.emitResult({ structureId: "wall1", success: true });

    s.controller.cancel();
    expect(s.controller.getTarget()).toBeNull();
    expect(s.controller.getFeedback()).toBeNull();
    // Mode stays on (the player is still in edit mode; only the transient
    // preview/feedback were cleared).
    expect(s.controller.getMode()).toBe(true);
  });

  it("dispose() unsubscribes: later results are ignored", () => {
    const building = buildingOf([wall("wall1", { x: 0, y: 0, z: -3 })]);
    const s = setup(building);
    enterEditMode(s, building);
    s.controller.dispose();
    s.network.emitResult({ structureId: "wall1", success: true });
    expect(s.controller.getFeedback()).toBeNull();
    // A frame after dispose reports no target.
    expect(s.controller.updateFrame(frame(building))).toBeNull();
  });
});
