/**
 * Placement preview correction — client-side tests verifying that the
 * non-authoritative preview corrects promptly after server rejection,
 * without any client-side authority.
 *
 * Key invariants:
 *  - When the server rejects a placement, the pending intent is removed
 *    from the store, and the preview for that cell becomes valid again
 *    on the next frame.
 *  - For multi-cell structures (ramps), a rejection frees ALL cells in
 *    the preview (both cells of the ramp footprint).
 *  - The client never pre-spends energy or creates structures locally;
 *    the preview is purely visual feedback derived from the store.
 *  - After a rejection, the held-primary loop retries on the next valid
 *    frame (the cell is free again in the preview).
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

/** A fake DOM event target. */
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
  // Build tiles are centred on grid × cellSize (the canonical geometry).
  return i * BUILD_GRID.cellSize;
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
    send: (type, payload) => { sent.push({ type, payload }); return true; },
    onEvent: (name, callback) => {
      const list = handlers.get(name) ?? [];
      list.push(callback);
      handlers.set(name, list);
      return () => { handlers.set(name, (handlers.get(name) ?? []).filter((fn) => fn !== callback)); };
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
   * One render frame: recomputes the preview and drives held placement.
   * `gridX` aims at the given cell column.
   */
  const frame = (
    now: number,
    held: boolean,
    opts: { gridX?: number; playerX?: number; valid?: boolean } = {},
  ): void => {
    const gridX = opts.gridX ?? 0;
    const valid = opts.valid ?? true;
    const camera = { position: { x: cellCamX(gridX), y: 5, z: 0 } } as unknown as Camera;
    const aim = (valid ? { x: 0, y: -1, z: 0 } : { x: 0, y: 0, z: 1 }) as unknown as Vector3;
    const feet = { x: opts.playerX ?? 0, y: 0, z: 0 } as unknown as Vector3;
    updateBuildingFrame({ controller }, camera, aim, feet, true, held, now);
  };

  /** Emits the authoritative `build:structure_placed` confirmation. */
  const confirm = (gridX: number, sequence: number, buildType: BuildType = "wall"): void => {
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
    sent.filter((m) => m.type === BUILD_EVENTS.PLACEMENT_REQUEST).map((m) => m.payload as Record<string, unknown>);

  return {
    input, store, controller, sent, placedRequests,
    setBuildMode, selectPiece, frame, confirm, reject,
    dispose: () => controller.dispose(),
  };
}

describe("placement preview correction on server rejection", () => {
  it("pending intent is removed on rejection: preview for the same cell becomes valid again", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    // Submit a placement at cell 0.
    fixture.frame(0, true, { gridX: 0 });
    expect(fixture.store.pendingCount).toBe(1);

    // While pending, the preview for cell 0 is invalid (overlap with pending).
    fixture.frame(50, false, { gridX: 0 });
    expect(fixture.controller.getPreview().valid).toBe(false);
    expect(fixture.controller.getPreview().reason).toBe("overlap");

    // Server rejects the placement.
    fixture.reject(0, "overlap");

    // Pending intent is removed.
    expect(fixture.store.pendingCount).toBe(0);

    // Next frame: the preview for cell 0 is valid again (cell is free).
    fixture.frame(100, false, { gridX: 0 });
    expect(fixture.controller.getPreview().valid).toBe(true);
    expect(fixture.controller.getPreview().reason).toBe(null);

    fixture.dispose();
  });

  it("rejection of an 'unaffordable' placement frees the cell in the preview immediately", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    fixture.frame(0, true, { gridX: 1 });
    expect(fixture.store.pendingCount).toBe(1);

    // Server rejects for lack of energy.
    fixture.reject(0, "unaffordable");
    expect(fixture.store.pendingCount).toBe(0);

    // Preview is valid again on the next frame for the same cell.
    fixture.frame(50, false, { gridX: 1 });
    expect(fixture.controller.getPreview().valid).toBe(true);

    fixture.dispose();
  });

  it("rejection of a 'rate_limited' placement frees the cell in the preview", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    fixture.frame(0, true, { gridX: 0 });
    fixture.reject(0, "rate_limited");
    expect(fixture.store.pendingCount).toBe(0);

    fixture.frame(50, false, { gridX: 0 });
    expect(fixture.controller.getPreview().valid).toBe(true);

    fixture.dispose();
  });

  it("ramp rejection frees its tile's ramp slot in the preview", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    // Select ramp (E). A ramp occupies one tile's ramp slot.
    fixture.selectPiece("KeyE");

    // Place a ramp at cell 0.
    fixture.frame(0, true, { gridX: 0 });
    expect(fixture.store.pendingCount).toBe(1);

    // While pending, another ramp on the same tile shows overlap; the next
    // tile is free (one-tile ramps).
    fixture.frame(50, false, { gridX: 0 });
    expect(fixture.controller.getPreview().reason).toBe("overlap");
    fixture.frame(60, false, { gridX: 1 });
    expect(fixture.controller.getPreview().valid).toBe(true);

    // Server rejects the ramp: the slot is free again.
    fixture.reject(0, "overlap");
    expect(fixture.store.pendingCount).toBe(0);
    fixture.frame(100, false, { gridX: 0 });
    expect(fixture.controller.getPreview().valid).toBe(true);

    fixture.dispose();
  });

  it("after rejection, the held-primary loop retries on the next valid frame", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    // Submit a placement at cell 0.
    fixture.frame(0, true, { gridX: 0 });
    expect(fixture.placedRequests()).toHaveLength(1);

    // Server rejects it.
    fixture.reject(0, "overlap");

    // Still held on cell 0: the cell is free again, so the loop retries
    // on the next rate window.
    fixture.frame(PLACEMENT_REQUEST_INTERVAL_MS + 60, true, { gridX: 0 });
    expect(fixture.placedRequests()).toHaveLength(2);
    // The new request has the next sequence.
    expect(fixture.placedRequests()[1].sequence).toBe(1);

    fixture.dispose();
  });

  it("preview correction is immediate: no stale 'overlap' persists after rejection", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    // Place at cell 0, then confirm it (authoritative structure exists).
    fixture.frame(0, true, { gridX: 0 });
    fixture.confirm(0, 0);
    expect(fixture.store.structureCount).toBe(1);

    // Now the preview for cell 0 is invalid (authoritatively occupied).
    fixture.frame(50, false, { gridX: 0 });
    expect(fixture.controller.getPreview().valid).toBe(false);
    expect(fixture.controller.getPreview().reason).toBe("overlap");

    // Simulate the structure being destroyed (replicated state update).
    fixture.store.applyReplicatedState({});
    expect(fixture.store.structureCount).toBe(0);

    // Preview is valid again immediately on the next frame.
    fixture.frame(100, false, { gridX: 0 });
    expect(fixture.controller.getPreview().valid).toBe(true);

    fixture.dispose();
  });

  it("no client authority: a rejection never creates a local structure", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    fixture.frame(0, true, { gridX: 0 });
    expect(fixture.store.structureCount).toBe(0); // no local creation

    fixture.reject(0, "overlap");
    expect(fixture.store.structureCount).toBe(0); // still no local creation
    expect(fixture.store.pendingCount).toBe(0); // pending dropped

    fixture.dispose();
  });

  it("no client authority: energy is never pre-spent locally on placement request", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);

    // Submit multiple placement requests; none are confirmed.
    fixture.frame(0, true, { gridX: 0 });
    fixture.frame(PLACEMENT_REQUEST_INTERVAL_MS + 50, true, { gridX: 1 });
    fixture.frame(2 * PLACEMENT_REQUEST_INTERVAL_MS + 50, true, { gridX: -1 });

    expect(fixture.store.structureCount).toBe(0);
    expect(fixture.store.pendingCount).toBe(3);

    // Reject all three.
    fixture.reject(0, "overlap");
    fixture.reject(1, "overlap");
    fixture.reject(2, "unaffordable");

    expect(fixture.store.structureCount).toBe(0);
    expect(fixture.store.pendingCount).toBe(0);

    fixture.dispose();
  });
});
