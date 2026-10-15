/**
 * Turbo building — held-primary rapid placement tests.
 *
 * Covers the client half of the server-authoritative building contract for
 * the held primary: the current camera/grid target is used per frame,
 * duplicates are rejected naturally (the pending footprint invalidates the
 * same-cell preview until the server answers), Energy is only ever spent by
 * the server on acceptance (no local pre-spend, so an `unaffordable`
 * rejection never stops the loop), piece changes mid-hold continue the loop,
 * and client requests are rate-limited while the server stays authoritative.
 *
 * The tests drive the real per-frame contract
 * (`updateBuildingFrame` with an injected clock) through a fixture built the
 * same way `primaryActionRouting.test.ts` does — fake DOM targets for the
 * build-mode keyboard input, a fake network that records the canonical
 * `build:placement_request` transport and can emit the authoritative
 * confirmation / rejection events.
 */
import { describe, expect, it } from "vitest";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import {
  BUILD_EVENTS,
  type BuildType,
  type StructureState,
} from "@buildshift/protocol";
import { BUILD_GRID } from "@buildshift/game-config";
import {
  BuildingInputController,
  BuildingStateStore,
  BuildingController,
  PLACEMENT_REQUEST_INTERVAL_MS,
  updateBuildingFrame,
  type BuildingInputEnvironment,
  type BuildingNetworkLike,
  type InputEventTarget,
} from "./index";

/** A fake DOM event target (mirrors the primaryActionRouting test fixture). */
class FakeTarget implements InputEventTarget {
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

/** The world-space X that aims the ground-plane candidate at grid cell `i`. */
function cellCamX(i: number): number {
  // Aim straight down from y=5 hits the ground at (camX, 0, 0); the cell
  // centre of grid column `i` is `i * cellSize + cellSize / 2`.
  return i * BUILD_GRID.cellSize + BUILD_GRID.cellSize / 2;
}

function createFixture() {
  const canvas = {} as HTMLCanvasElement;
  const keyTarget = new FakeTarget();
  const inertTarget = new FakeTarget();
  const environment: BuildingInputEnvironment = {
    keyTarget,
    pointerLockTarget: inertTarget,
    visibilityTarget: inertTarget,
    getPointerLockElement: () => canvas,
    isHidden: () => false,
  };
  const input = new BuildingInputController(canvas, environment);
  const store = new BuildingStateStore();
  const sent: Array<{ type: string; payload?: unknown }> = [];
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  const network: BuildingNetworkLike = {
    send: (type, payload) => {
      sent.push({ type, payload });
      return true;
    },
    onEvent: (name, callback) => {
      const list = handlers.get(name) ?? [];
      list.push(callback);
      handlers.set(name, list);
      return () => {
        handlers.set(
          name,
          (handlers.get(name) ?? []).filter((fn) => fn !== callback),
        );
      };
    },
  };
  const controller = new BuildingController(input, store, network);

  const setBuildMode = (active: boolean): void => {
    if (input.isBuildModeActive() !== active) {
      keyTarget.dispatch("keydown", { code: "KeyB", repeat: false });
    }
  };
  const selectPiece = (code: string): void => {
    keyTarget.dispatch("keydown", { code, repeat: false });
  };

  /**
   * One render frame through the real frame driver: recomputes the preview
   * from the given aim and drives held placement with the given held state
   * and clock. `valid=false` aims horizontally (no ground-plane candidate).
   */
  const frame = (
    now: number,
    held: boolean,
    opts: {
      gridX?: number;
      playerX?: number;
      valid?: boolean;
      connected?: boolean;
    } = {},
  ): void => {
    const gridX = opts.gridX ?? 0;
    const valid = opts.valid ?? true;
    const camera = {
      position: { x: cellCamX(gridX), y: 5, z: 0 },
    } as unknown as Camera;
    const aim = (valid
      ? { x: 0, y: -1, z: 0 }
      : { x: 0, y: 0, z: 1 }) as unknown as Vector3;
    const feet = { x: opts.playerX ?? 0, y: 0, z: 0 } as unknown as Vector3;
    updateBuildingFrame(
      { controller },
      camera,
      aim,
      feet,
      opts.connected ?? true,
      held,
      now,
    );
  };

  /** Emits the authoritative `build:structure_placed` confirmation. */
  const confirm = (
    gridX: number,
    sequence: number,
    buildType: BuildType = "wall",
  ): void => {
    const structure: StructureState = {
      structureId: `s${sequence}`,
      buildType,
      grid: { x: gridX, y: 0, z: 0 },
      rotation: 0,
      ownerId: "p1",
      createdSequence: sequence,
    };
    for (const fn of handlers.get(BUILD_EVENTS.STRUCTURE_PLACED) ?? []) {
      fn({ structure });
    }
  };

  /** Emits the authoritative `build:structure_rejected` rejection. */
  const reject = (sequence: number, reason: string): void => {
    for (const fn of handlers.get(BUILD_EVENTS.STRUCTURE_REJECTED) ?? []) {
      fn({ sequence, reason });
    }
  };

  const placedRequests = (): Array<Record<string, unknown>> =>
    sent
      .filter((m) => m.type === BUILD_EVENTS.PLACEMENT_REQUEST)
      .map((m) => m.payload as Record<string, unknown>);

  return {
    input,
    store,
    controller,
    sent,
    placedRequests,
    setBuildMode,
    selectPiece,
    frame,
    confirm,
    reject,
    dispose: () => controller.dispose(),
  };
}

describe("PLACEMENT_REQUEST_INTERVAL_MS (client rate limit)", () => {
  it("is an integer at or above the server placement-rate window", () => {
    // Server gate: BUILD_RATE.minTicksBetweenPlacements authoritative 30 Hz
    // ticks. The client interval must never request faster than that window.
    const serverWindowMs =
      (10 * 1000) / 30; // 10 ticks at 30 Hz = 333.33 ms
    expect(Number.isInteger(PLACEMENT_REQUEST_INTERVAL_MS)).toBe(true);
    expect(PLACEMENT_REQUEST_INTERVAL_MS).toBeGreaterThanOrEqual(
      serverWindowMs,
    );
  });
});

describe("turbo building: hold", () => {
  it("places immediately on the current camera/grid target when the primary is held", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    fixture.frame(0, true, { gridX: 1 });

    expect(fixture.placedRequests()).toHaveLength(1);
    const intent = fixture.placedRequests()[0];
    expect(intent.grid).toEqual({ x: 1, y: 0, z: 0 });
    expect(intent.buildType).toBe("wall");
    expect(fixture.store.pendingCount).toBe(1);
    fixture.dispose();
  });

  it("rejects duplicates naturally while held on the same cell", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    fixture.frame(0, true, { gridX: 0 });
    expect(fixture.placedRequests()).toHaveLength(1);

    // Still held, still aiming at cell 0: the pending intent occupies the
    // cell, so the preview is invalid and no duplicate is submitted — even
    // after the rate window has passed.
    fixture.frame(100, true, { gridX: 0 });
    fixture.frame(PLACEMENT_REQUEST_INTERVAL_MS + 50, true, { gridX: 0 });
    expect(fixture.placedRequests()).toHaveLength(1);

    // The server confirms the structure: the cell is now authoritatively
    // occupied, so holding on the same cell still yields no duplicate.
    fixture.confirm(0, 0);
    fixture.frame(PLACEMENT_REQUEST_INTERVAL_MS + 200, true, { gridX: 0 });
    expect(fixture.placedRequests()).toHaveLength(1);
    expect(fixture.store.structureCount).toBe(1);
    expect(fixture.store.pendingCount).toBe(0);

    // Moving the aim to a fresh cell resumes placement on the next window.
    fixture.frame(PLACEMENT_REQUEST_INTERVAL_MS + 300, true, { gridX: 1 });
    expect(fixture.placedRequests()).toHaveLength(2);
    expect(fixture.placedRequests()[1].grid).toEqual({ x: 1, y: 0, z: 0 });
    fixture.dispose();
  });
});

describe("turbo building: release", () => {
  it("releasing the primary stops rapid placement; re-holding resumes it", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    fixture.frame(0, true, { gridX: 0 });
    expect(fixture.placedRequests()).toHaveLength(1);

    // Release: no further requests even after the rate window passes and
    // the aim moves to a fresh, valid cell.
    fixture.frame(PLACEMENT_REQUEST_INTERVAL_MS + 50, false, { gridX: 1 });
    fixture.frame(PLACEMENT_REQUEST_INTERVAL_MS + 200, false, { gridX: 2 });
    expect(fixture.placedRequests()).toHaveLength(1);

    // Re-hold on a fresh cell: the last request was long enough ago, so
    // placement resumes immediately.
    fixture.frame(PLACEMENT_REQUEST_INTERVAL_MS + 300, true, { gridX: 1 });
    expect(fixture.placedRequests()).toHaveLength(2);
    expect(fixture.placedRequests()[1].grid).toEqual({ x: 1, y: 0, z: 0 });
    fixture.dispose();
  });

  it("does not place when the primary is not held", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    fixture.frame(0, false, { gridX: 0 });
    fixture.frame(PLACEMENT_REQUEST_INTERVAL_MS + 100, false, { gridX: 1 });
    expect(fixture.sent).toHaveLength(0);
    fixture.dispose();
  });
});

describe("turbo building: rate limit", () => {
  it("bounds held requests to one per rate window while sweeping fresh cells", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    // 60 fps frames for one second, holding the primary and sweeping the
    // aim across five fresh in-range cells (no confirmations, so the only
    // things that can gate requests are the rate limit and the natural
    // duplicate rejection).
    const cells = [-2, -1, 0, 1, 2];
    for (let i = 0; i <= 60; i += 1) {
      fixture.frame(i * 16, true, { gridX: cells[i % cells.length] });
    }

    // t=0 (cell -2), t=336 (frame 21, cell -1), t=672 (frame 42, cell 0):
    // exactly three requests in one second at the 334 ms client interval.
    const requests = fixture.placedRequests();
    expect(requests).toHaveLength(3);
    expect(requests.map((r) => (r.grid as { x: number }).x)).toEqual([
      -2, -1, 0,
    ]);
    fixture.dispose();
  });

  it("does not submit faster than the interval even with an always-valid aim", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    fixture.frame(0, true, { gridX: 0 });
    // Inside the window: even though the aim moves to a fresh, valid cell,
    // the rate limit holds the second request back.
    for (let i = 1; i <= 20; i += 1) {
      fixture.frame(i * 16, true, { gridX: 1 });
    }
    expect(fixture.placedRequests()).toHaveLength(1);

    // Once the window opens, the next frame places immediately.
    fixture.frame(336, true, { gridX: 1 });
    expect(fixture.placedRequests()).toHaveLength(2);
    expect(fixture.placedRequests()[1].grid).toEqual({ x: 1, y: 0, z: 0 });
    fixture.dispose();
  });
});

describe("turbo building: piece switch", () => {
  it("continues rapid placement across piece changes while the primary stays held", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    // Wall at cell 0, confirmed.
    fixture.frame(0, true, { gridX: 0 });
    expect(fixture.placedRequests()).toHaveLength(1);
    fixture.confirm(0, 0, "wall");

    // Switch to floor mid-hold (no release): the next window places a floor.
    fixture.selectPiece("KeyF");
    fixture.frame(PLACEMENT_REQUEST_INTERVAL_MS + 60, true, { gridX: 1 });
    expect(fixture.placedRequests()).toHaveLength(2);
    expect(fixture.placedRequests()[1].buildType).toBe("floor");
    fixture.confirm(1, 1, "floor");

    // Switch to ramp mid-hold: the next window places a ramp (at x=-2: a
    // rotation-0 ramp spans x=-2..-1, inside the shared build bounds and
    // clear of the wall at 0 / floor at 1).
    fixture.selectPiece("KeyE");
    fixture.frame(2 * PLACEMENT_REQUEST_INTERVAL_MS + 120, true, { gridX: -2 });
    expect(fixture.placedRequests()).toHaveLength(3);
    expect(fixture.placedRequests()[2].buildType).toBe("ramp");

    expect(fixture.placedRequests().map((r) => r.buildType)).toEqual([
      "wall", "floor", "ramp",
    ]);
    fixture.dispose();
  });

  it("turbo build continues through the full sequence: ramp → floor → cone → wall", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    // Start with ramp selected (Digit3). Ramp footprint [2,1,1] occupies
    // cells (0,0,0) and (1,0,0).
    fixture.selectPiece("KeyE");
    fixture.frame(0, true, { gridX: 0 });
    expect(fixture.placedRequests()).toHaveLength(1);
    expect(fixture.placedRequests()[0].buildType).toBe("ramp");
    fixture.confirm(0, 0, "ramp");

    // Switch to floor mid-hold: cell 2 is free (ramp occupies 0 and 1).
    fixture.selectPiece("KeyF");
    fixture.frame(PLACEMENT_REQUEST_INTERVAL_MS + 50, true, { gridX: 2 });
    expect(fixture.placedRequests()).toHaveLength(2);
    expect(fixture.placedRequests()[1].buildType).toBe("floor");
    fixture.confirm(2, 1, "floor");

    // Switch to cone mid-hold: cell -1 is free and in range.
    fixture.selectPiece("KeyZ");
    fixture.frame(2 * PLACEMENT_REQUEST_INTERVAL_MS + 100, true, { gridX: -1 });
    expect(fixture.placedRequests()).toHaveLength(3);
    expect(fixture.placedRequests()[2].buildType).toBe("cone");
    fixture.confirm(-1, 2, "cone");

    // Switch back to wall mid-hold: cell -2 is free and in range.
    fixture.selectPiece("KeyQ");
    fixture.frame(3 * PLACEMENT_REQUEST_INTERVAL_MS + 150, true, { gridX: -2 });
    expect(fixture.placedRequests()).toHaveLength(4);
    expect(fixture.placedRequests()[3].buildType).toBe("wall");

    expect(fixture.placedRequests().map((r) => r.buildType)).toEqual([
      "ramp", "floor", "cone", "wall",
    ]);
    fixture.dispose();
  });

  it("piece selection is immediate: the next frame uses the new type without delay", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    // Place a wall at t=0.
    fixture.frame(0, true, { gridX: 0 });
    expect(fixture.placedRequests()).toHaveLength(1);
    expect(fixture.placedRequests()[0].buildType).toBe("wall");
    fixture.confirm(0, 0, "wall");

    // Switch to cone; the selection change is synchronous — no extra frame
    // or state transition is needed. The next valid frame in a new window
    // places the cone.
    fixture.selectPiece("KeyZ");
    // The rate window has not opened yet, so even at t=50 no request.
    fixture.frame(50, true, { gridX: 1 });
    expect(fixture.placedRequests()).toHaveLength(1);

    // Once the window opens, the cone is placed immediately — proving the
    // selection took effect on the key-press frame, not a later frame.
    fixture.frame(PLACEMENT_REQUEST_INTERVAL_MS + 10, true, { gridX: 1 });
    expect(fixture.placedRequests()).toHaveLength(2);
    expect(fixture.placedRequests()[1].buildType).toBe("cone");
    fixture.dispose();
  });

  it("build mode stays active across all piece key presses", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    // Press each piece key in sequence; build mode must remain active.
    fixture.selectPiece("KeyE");
    expect(fixture.input.isBuildModeActive()).toBe(true);
    expect(fixture.input.getSelectedBuildType()).toBe("ramp");

    fixture.selectPiece("KeyF");
    expect(fixture.input.isBuildModeActive()).toBe(true);
    expect(fixture.input.getSelectedBuildType()).toBe("floor");

    fixture.selectPiece("KeyZ");
    expect(fixture.input.isBuildModeActive()).toBe(true);
    expect(fixture.input.getSelectedBuildType()).toBe("cone");

    fixture.selectPiece("KeyQ");
    expect(fixture.input.isBuildModeActive()).toBe(true);
    expect(fixture.input.getSelectedBuildType()).toBe("wall");

    // Turbo placement still works after all switches (cell 0 is free,
    // player at origin, anchor at 0 — well within range).
    fixture.frame(0, true, { gridX: 0 });
    expect(fixture.placedRequests()).toHaveLength(1);
    expect(fixture.placedRequests()[0].buildType).toBe("wall");
    fixture.dispose();
  });
});

describe("turbo building: energy stays server-authoritative", () => {
  it("an unaffordable rejection drops the pending intent and the held loop retries", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    fixture.frame(0, true, { gridX: 0 });
    expect(fixture.placedRequests()).toHaveLength(1);

    // The server rejects for lack of energy: no structure is ever created
    // locally and no energy is pre-spent by the client (the building mirror
    // stays empty — energy bookkeeping is the server's, mirrored only via
    // the authoritative energy sync).
    fixture.reject(0, "unaffordable");
    expect(fixture.store.structureCount).toBe(0);
    expect(fixture.store.pendingCount).toBe(0);

    // Still held on the same cell: the cell is free again, so the loop
    // retries on the next rate window instead of stopping.
    fixture.frame(PLACEMENT_REQUEST_INTERVAL_MS + 60, true, { gridX: 0 });
    expect(fixture.placedRequests()).toHaveLength(2);
    expect(fixture.placedRequests()[1].sequence).toBe(1);
    expect(fixture.store.structureCount).toBe(0);
    fixture.dispose();
  });

  it("a structure enters the mirror only after the server accepts", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    fixture.frame(0, true, { gridX: 0 });
    expect(fixture.store.structureCount).toBe(0);
    expect(fixture.store.pendingCount).toBe(1);

    fixture.confirm(0, 0);
    expect(fixture.store.structureCount).toBe(1);
    expect(fixture.store.pendingCount).toBe(0);
    fixture.dispose();
  });
});

describe("turbo building: connection and mode gates", () => {
  it("does not submit placement requests while disconnected", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    fixture.frame(0, true, { gridX: 0, connected: false });
    fixture.frame(PLACEMENT_REQUEST_INTERVAL_MS + 50, true, { gridX: 0, connected: false });
    expect(fixture.sent).toHaveLength(0);
    expect(fixture.store.pendingCount).toBe(0);

    // Reconnecting while still held places on the current cell.
    fixture.frame(PLACEMENT_REQUEST_INTERVAL_MS + 100, true, { gridX: 0, connected: true });
    expect(fixture.placedRequests()).toHaveLength(1);
    fixture.dispose();
  });

  it("does not place while build mode is inactive even with the primary held", () => {
    const fixture = createFixture();

    fixture.frame(0, true, { gridX: 0 });
    fixture.frame(PLACEMENT_REQUEST_INTERVAL_MS + 50, true, { gridX: 1 });
    expect(fixture.sent).toHaveLength(0);
    fixture.dispose();
  });
});
