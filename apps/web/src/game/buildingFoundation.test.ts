/**
 * Building foundation - client-side contract tests.
 * Covers grid snapping, footprints, overlap, preview, store lifecycle,
 * controller, parsing, and cleanup.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { worldToGridPosition, gridToWorldAnchor, getFootprint, gridKey, footprintCells, footprintsOverlap } from "./building/gridSnap";
import { computePlacementPreview, ABSENT_PREVIEW, type PlacementPreviewInput, type OccupiedStructure } from "./building/placementPreview";
import { BuildingStateStore, parseStructureRejectedEvent } from "./building/buildingStateStore";
import { BuildingController, type BuildingNetworkLike } from "./building/buildingController";
import { BuildingInputController, type BuildingInputEnvironment } from "./building/buildingInputController";
import { parseStructureState, parseBuildingState } from "./network/structureStateParse";
import { BUILD_GRID } from "@buildshift/game-config";
import type { StructureState } from "@buildshift/protocol";

describe("gridSnap", () => {
  it("snaps to correct cell", () => {
    expect(worldToGridPosition(2.5, 2.5, -2.5)).toEqual({ x: 1, y: 1, z: -2 });
  });
  it("handles negative coords", () => {
    const g = worldToGridPosition(-1.5, 0, -0.5);
    expect(g.x).toBe(-1); expect(g.z).toBe(-1); expect(g.y).toBe(0);
  });
  it("clamps below ground", () => {
    expect(worldToGridPosition(0, -5, 0).y).toBe(BUILD_GRID.groundLayer);
  });
  it("gridToWorldAnchor", () => {
    const a = gridToWorldAnchor({ x: 3, y: 2, z: -1 });
    expect(a.x).toBe(6); expect(a.y).toBe(3); expect(a.z).toBe(-2);
  });
  it("round-trip", () => {
    const g = { x: 2, y: 1, z: 3 };
    const w = gridToWorldAnchor(g);
    const s = worldToGridPosition(w.x + 0.5, w.y + 0.1, w.z + 0.5);
    expect(s.x).toBe(g.x); expect(s.z).toBe(g.z);
  });
  it("getFootprint all types", () => {
    expect(getFootprint("wall")).toEqual([1, 2, 1]);
    expect(getFootprint("floor")).toEqual([1, 1, 1]);
    expect(getFootprint("ramp")).toEqual([2, 1, 1]);
    expect(getFootprint("cone")).toEqual([1, 1, 1]);
  });
  it("gridKey", () => {
    expect(gridKey({ x: 1, y: 0, z: -3 })).toBe("1:0:-3");
  });
  it("wall = 2 cells vertical", () => {
    expect(footprintCells("wall", { x: 0, y: 0, z: 0 })).toHaveLength(2);
  });
  it("floor/ramp/cone cells", () => {
    expect(footprintCells("floor", { x: 1, y: 0, z: 2 })).toHaveLength(1);
    expect(footprintCells("ramp", { x: 0, y: 0, z: 0 })).toHaveLength(2);
    expect(footprintCells("cone", { x: 0, y: 0, z: 0 })).toHaveLength(1);
  });
  it("overlap same anchor", () => {
    const a: OccupiedStructure = { buildType: "wall", grid: { x: 0, y: 0, z: 0 } };
    expect(footprintsOverlap(a, a)).toBe(true);
  });
  it("no overlap separate", () => {
    const a: OccupiedStructure = { buildType: "wall", grid: { x: 0, y: 0, z: 0 } };
    const b: OccupiedStructure = { buildType: "wall", grid: { x: 1, y: 0, z: 0 } };
    expect(footprintsOverlap(a, b)).toBe(false);
  });
  it("floor on wall top overlaps", () => {
    const w: OccupiedStructure = { buildType: "wall", grid: { x: 0, y: 0, z: 0 } };
    const f: OccupiedStructure = { buildType: "floor", grid: { x: 0, y: 1, z: 0 } };
    expect(footprintsOverlap(f, w)).toBe(true);
  });
});

describe("placementPreview", () => {
  function mi(o: Partial<PlacementPreviewInput> = {}): PlacementPreviewInput {
    return { aimOrigin: { x: 0, y: 5, z: 0 }, aimDirection: { x: 0, y: -1, z: 0 }, playerPosition: { x: 0, y: 0, z: 0 }, buildType: "wall", rotation: 0, occupied: [], ...o };
  }
  it("valid straight-down", () => {
    const p = computePlacementPreview(mi());
    expect(p.valid).toBe(true); expect(p.grid).toEqual({ x: 0, y: 0, z: 0 });
  });
  it("no_candidate aiming up", () => {
    expect(computePlacementPreview(mi({ aimDirection: { x: 0, y: 1, z: 0 } })).reason).toBe("no_candidate");
  });
  it("no_candidate horizontal", () => {
    expect(computePlacementPreview(mi({ aimDirection: { x: 1, y: 0, z: 0 } })).reason).toBe("no_candidate");
  });
  it("out_of_range", () => {
    // aimOrigin x=30 → grid x=15 → anchor x=30 → distance 30 > 12
    expect(computePlacementPreview(mi({ aimOrigin: { x: 30, y: 5, z: 0 } })).reason).toBe("out_of_range");
  });
  it("overlap", () => {
    expect(computePlacementPreview(mi({ occupied: [{ buildType: "wall", grid: { x: 0, y: 0, z: 0 } }] })).reason).toBe("overlap");
  });
  it("invalid_rotation for wall with non-default rotation", () => {
    // wall has rotationCount=4; the preview checks `rotation % rotationCount !== 0`.
    // rotation=1 → 1 % 4 = 1 ≠ 0 → invalid_rotation.
    expect(computePlacementPreview(mi({ buildType: "wall", rotation: 1 })).reason).toBe("invalid_rotation");
  });
  it("valid rotation for wall at default facing", () => {
    // rotation=0 → 0 % 4 = 0 → passes rotation check → valid.
    expect(computePlacementPreview(mi({ buildType: "wall", rotation: 0 })).valid).toBe(true);
  });
  it("ABSENT_PREVIEW frozen", () => {
    expect(ABSENT_PREVIEW.present).toBe(false);
    expect(Object.isFrozen(ABSENT_PREVIEW)).toBe(true);
  });
});

describe("BuildingStateStore", () => {
  let s: BuildingStateStore;
  beforeEach(() => { s = new BuildingStateStore(); });
  function ms(id: string): StructureState {
    return { structureId: id, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0, ownerId: "p1", createdSequence: 0 };
  }
  it("applyReplicatedState replaces", () => {
    s.applyReplicatedState({ a: ms("a") }); expect(s.structureCount).toBe(1);
    s.applyReplicatedState({}); expect(s.structureCount).toBe(0);
  });
  it("pending + confirm", () => {
    s.addPending({ sequence: 0, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0 });
    s.confirmPlacement({ structure: ms("a") });
    expect(s.pendingCount).toBe(0); expect(s.structureCount).toBe(1);
  });
  it("reject drops pending", () => {
    s.addPending({ sequence: 5, buildType: "floor", grid: { x: 1, y: 0, z: 1 }, rotation: 0 });
    s.rejectPlacement({ sequence: 5, reason: "overlap" });
    expect(s.pendingCount).toBe(0);
  });
  it("clearPending keeps mirror", () => {
    s.applyReplicatedState({ a: ms("a") });
    s.addPending({ sequence: 0, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0 });
    s.clearPending();
    expect(s.structureCount).toBe(1); expect(s.pendingCount).toBe(0);
  });
  it("reset drops all", () => {
    s.applyReplicatedState({ a: ms("a") });
    s.addPending({ sequence: 0, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0 });
    s.reset();
    expect(s.structureCount).toBe(0); expect(s.pendingCount).toBe(0);
  });
});

describe("parsing", () => {
  it("parseStructureState valid", () => {
    expect(parseStructureState({ structureId: "s1", buildType: "wall", grid: { x: 1, y: 0, z: 2 }, rotation: 0, ownerId: "p1", createdSequence: 0 })).not.toBeNull();
  });
  it("rejects missing id", () => {
    expect(parseStructureState({ buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0, ownerId: "p1", createdSequence: 0 })).toBeNull();
  });
  it("rejects bad type", () => {
    expect(parseStructureState({ structureId: "s1", buildType: "tower", grid: { x: 0, y: 0, z: 0 }, rotation: 0, ownerId: "p1", createdSequence: 0 })).toBeNull();
  });
  it("parseBuildingState filters invalid", () => {
    const r = parseBuildingState({ s1: { structureId: "s1", buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0, ownerId: "p1", createdSequence: 0 }, s2: { structureId: "s2", buildType: "tower", grid: { x: 0, y: 0, z: 0 }, rotation: 0, ownerId: "p1", createdSequence: 1 } });
    expect(Object.keys(r.structures)).toHaveLength(1);
  });
  it("parseStructureRejectedEvent valid", () => {
    const p = parseStructureRejectedEvent({ sequence: 3, reason: "overlap" });
    expect(p).not.toBeNull(); expect(p!.sequence).toBe(3);
  });
  it("parseStructureRejectedEvent bad reason", () => {
    expect(parseStructureRejectedEvent({ sequence: 0, reason: "bogus" })).toBeNull();
  });
});

describe("BuildingController", () => {
  function fakeNet() {
    const sent: Array<{ t: string; p?: unknown }> = [];
    const evs = new Map<string, ((p: unknown) => void)[]>();
    const net: BuildingNetworkLike = {
      send: (t, p) => { sent.push({ t, p }); return true; },
      onEvent: (n, cb) => {
        const l = evs.get(n) ?? []; l.push(cb); evs.set(n, l);
        return () => { const x = evs.get(n); if (x) evs.set(n, x.filter(f => f !== cb)); };
      },
    };
    return { net, sent };
  }
  function mkInput() {
    const canvas = {} as HTMLCanvasElement;
    const env: BuildingInputEnvironment = {
      keyTarget: { addEventListener: () => {}, removeEventListener: () => {} },
      mouseTarget: { addEventListener: () => {}, removeEventListener: () => {} },
      pointerLockTarget: { addEventListener: () => {}, removeEventListener: () => {} },
      visibilityTarget: { addEventListener: () => {}, removeEventListener: () => {} },
      getPointerLockElement: () => canvas,
      isHidden: () => false,
    };
    return new BuildingInputController(canvas, env);
  }
  it("requestPlace null when not in build mode", () => {
    const { net, sent } = fakeNet();
    const ctrl = new BuildingController(mkInput(), new BuildingStateStore(), net);
    expect(ctrl.requestPlace()).toBeNull();
    expect(sent).toHaveLength(0);
    ctrl.dispose();
  });
  it("reset clears state", () => {
    const { net } = fakeNet();
    const ctrl = new BuildingController(mkInput(), new BuildingStateStore(), net);
    ctrl.reset();
    expect(ctrl.getPreview().present).toBe(false);
    expect(ctrl.structureCount).toBe(0);
    ctrl.dispose();
  });
  it("dispose idempotent", () => {
    const { net } = fakeNet();
    const ctrl = new BuildingController(mkInput(), new BuildingStateStore(), net);
    ctrl.dispose();
    ctrl.dispose();
    expect(ctrl.isBuildModeActive()).toBe(false);
  });
  it("applyReplicatedBuilding populates", () => {
    const { net } = fakeNet();
    const ctrl = new BuildingController(mkInput(), new BuildingStateStore(), net);
    const st: StructureState = { structureId: "a", buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0, ownerId: "p1", createdSequence: 0 };
    ctrl.applyReplicatedBuilding({ structures: { a: st } });
    expect(ctrl.structureCount).toBe(1);
    ctrl.dispose();
  });
});
