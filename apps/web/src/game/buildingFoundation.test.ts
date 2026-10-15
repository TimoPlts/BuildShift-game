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
    // cellSize ≈ 5.12, layerHeight ≈ 3.84: (6,4,-6) snaps to cell (1, layer 1, -2).
    expect(worldToGridPosition(6.0, 4.0, -6.0)).toEqual({ x: 1, y: 1, z: -2 });
  });
  it("handles negative coords", () => {
    const g = worldToGridPosition(-1.5, 0, -0.5);
    expect(g.x).toBe(-1); expect(g.z).toBe(-1); expect(g.y).toBe(0);
  });
  it("clamps below ground", () => {
    expect(worldToGridPosition(0, -5, 0).y).toBe(BUILD_GRID.groundLayer);
  });
  it("gridToWorldAnchor", () => {
    // cellSize ≈ 5.12, layerHeight ≈ 3.84.
    const a = gridToWorldAnchor({ x: 3, y: 2, z: -1 });
    expect(a.x).toBeCloseTo(15.36, 6); expect(a.y).toBeCloseTo(7.68, 6); expect(a.z).toBeCloseTo(-5.12, 6);
  });
  it("round-trip", () => {
    const g = { x: 2, y: 1, z: 3 };
    const w = gridToWorldAnchor(g);
    const s = worldToGridPosition(w.x + 0.5, w.y + 0.1, w.z + 0.5);
    expect(s.x).toBe(g.x); expect(s.z).toBe(g.z);
  });
  it("getFootprint all types", () => {
    expect(getFootprint("wall")).toEqual([1, 1, 1]);
    expect(getFootprint("floor")).toEqual([1, 1, 1]);
    expect(getFootprint("ramp")).toEqual([1, 1, 1]); // one-tile ramp
    expect(getFootprint("cone")).toEqual([1, 1, 1]);
  });
  it("gridKey", () => {
    expect(gridKey({ x: 1, y: 0, z: -3 })).toBe("1:0:-3");
  });
  it("wall = 1 cell vertical", () => {
    expect(footprintCells("wall", { x: 0, y: 0, z: 0 })).toHaveLength(1);
  });
  it("floor/ramp/cone cells", () => {
    expect(footprintCells("floor", { x: 1, y: 0, z: 2 })).toHaveLength(1);
    expect(footprintCells("ramp", { x: 0, y: 0, z: 0 })).toHaveLength(1);
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
  it("structure on the same cell as another overlaps", () => {
    // A floor and a wall anchored to the same cell share that cell.
    const w: OccupiedStructure = { buildType: "wall", grid: { x: 0, y: 0, z: 0 } };
    const f: OccupiedStructure = { buildType: "floor", grid: { x: 0, y: 0, z: 0 } };
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
    // In-bounds anchor (grid x=2 → anchor x≈10.24) with the player at x=-20:
    // distance ≈30 > 12.
    expect(computePlacementPreview(mi({ aimOrigin: { x: 12, y: 5, z: 0 }, playerPosition: { x: -20, y: 0, z: 0 } })).reason).toBe("out_of_range");
  });
  it("out_of_bounds outside the shared build volume", () => {
    // aimOrigin x=30 → snapped grid x=5, beyond BUILD_BOUNDS.maxX=2.
    expect(computePlacementPreview(mi({ aimOrigin: { x: 30, y: 5, z: 0 } })).reason).toBe("out_of_bounds");
  });
  it("overlap", () => {
    expect(computePlacementPreview(mi({ occupied: [{ buildType: "wall", grid: { x: 0, y: 0, z: 0 } }] })).reason).toBe("overlap");
  });
  it("overlap against a later occupied structure is detected", () => {
    // The disjoint structure comes first; the colliding wall is last.
    const p = computePlacementPreview(mi({
      occupied: [
        { buildType: "cone", grid: { x: 7, y: 0, z: 7 } },
        { buildType: "floor", grid: { x: 9, y: 0, z: -4 } },
        { buildType: "wall", grid: { x: 0, y: 0, z: 0 } },
      ],
    }));
    expect(p.reason).toBe("overlap");
  });
  it("a floor and a wall on the same tile occupy different slots (no overlap)", () => {
    // Walls are edge pieces: a floor in the wall's tile is a separate slot.
    const p = computePlacementPreview(mi({
      buildType: "floor",
      occupied: [{ buildType: "wall", grid: { x: 0, y: 0, z: 0 } }],
    }));
    expect(p.valid).toBe(true);
    expect(computePlacementPreview(mi({ buildType: "floor", occupied: [{ buildType: "floor", grid: { x: 0, y: 0, z: 0 } }] })).reason).toBe("overlap");
  });
  it("valid with many disjoint occupied structures", () => {
    // 40 floors in a row away from the candidate at (0,0,0).
    const occupied = Array.from({ length: 40 }, (_, i) => ({
      buildType: "floor" as const,
      grid: { x: 5 + i, y: 0, z: 0 },
    }));
    expect(computePlacementPreview(mi({ occupied })).valid).toBe(true);
  });
  it("wall snaps to the aimed edge whatever rotation is selected", () => {
    for (const rotation of [0, 1, 2, 3] as const) {
      // Aim straight down 2 m toward +X from the tile centre → the +X edge.
      const p = computePlacementPreview(mi({ buildType: "wall", rotation, aimOrigin: { x: 2, y: 5, z: 0.1 } }));
      expect(p.valid).toBe(true);
      expect(p.rotation).toBe(1);
    }
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

describe("BuildingStateStore snapshot caching", () => {
  let s: BuildingStateStore;
  beforeEach(() => { s = new BuildingStateStore(); });
  function msAt(id: string, x: number): StructureState {
    return { structureId: id, buildType: "wall", grid: { x, y: 0, z: 0 }, rotation: 0, ownerId: "p1", createdSequence: 0 };
  }
  it("getBuildingState returns a stable reference across unmutated reads", () => {
    s.applyReplicatedState({ a: msAt("a", 0), b: msAt("b", 1) });
    expect(s.getBuildingState()).toBe(s.getBuildingState());
  });
  it("getBuildingState reflects each mutation", () => {
    s.applyReplicatedState({ a: msAt("a", 0) });
    const first = s.getBuildingState();
    expect(Object.keys(first.structures)).toEqual(["a"]);

    s.applyReplicatedState({ b: msAt("b", 2) });
    const second = s.getBuildingState();
    expect(second).not.toBe(first);
    expect(Object.keys(second.structures)).toEqual(["b"]);
    expect(second.structures.b.grid.x).toBe(2);

    s.confirmPlacement({ structure: { ...msAt("c", 3), createdSequence: 4 } });
    const third = s.getBuildingState();
    expect(Object.keys(third.structures).sort()).toEqual(["b", "c"]);
    expect(third.structures.c.grid.x).toBe(3);

    s.reset();
    expect(Object.keys(s.getBuildingState().structures)).toEqual([]);
  });
  it("getOccupiedStructures mixes authoritative + pending and stays stable until mutation", () => {
    s.applyReplicatedState({ a: msAt("a", 0) });
    s.addPending({ sequence: 1, buildType: "floor", grid: { x: 5, y: 0, z: 0 }, rotation: 0 });
    const occ = s.getOccupiedStructures();
    expect(occ).toHaveLength(2);
    expect(occ.some((o) => o.buildType === "floor" && o.grid.x === 5)).toBe(true);
    // Unmutated reads share the cached array (no per-frame reallocation).
    expect(s.getOccupiedStructures()).toBe(occ);

    s.rejectPlacement({ sequence: 1, reason: "overlap" });
    expect(s.getOccupiedStructures()).toHaveLength(1);

    s.addPending({ sequence: 2, buildType: "cone", grid: { x: 6, y: 0, z: 0 }, rotation: 0 });
    expect(s.getOccupiedStructures()).toHaveLength(2);

    s.clearPending();
    expect(s.getOccupiedStructures()).toHaveLength(1);
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
