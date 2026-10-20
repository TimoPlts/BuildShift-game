import { describe, expect, it } from "vitest";
import {
  BUILD_BOUNDS,
  BUILD_RANGE,
  STRUCTURES,
  isWithinPlacementRange,
  placementAnchorWorld,
  isValidPlacementRotation,
  isWithinBuildBounds,
  normalizePlacementRotation,
  rotatedFootprintExtents,
  structureFootprintCells,
  structureSlots,
  slotsConflict,
  wallEdgeRotation,
  buildCellAt,
} from "./index.js";

const TYPES = ["wall", "floor", "ramp", "cone"] as const;

describe("canonical placement rotation", () => {
  it("rotatable kinds keep the selected quarter turn", () => {
    for (const type of ["wall", "ramp"] as const) {
      expect(STRUCTURES[type].rotationCount).toBe(4);
      for (const r of [0, 1, 2, 3]) {
        expect(normalizePlacementRotation(type, r)).toBe(r);
        expect(isValidPlacementRotation(type, r)).toBe(true);
      }
    }
  });

  it("rotation-invariant kinds always normalize to 0 and accept only 0", () => {
    for (const type of ["floor", "cone"] as const) {
      expect(STRUCTURES[type].rotationCount).toBe(1);
      for (const r of [0, 1, 2, 3]) expect(normalizePlacementRotation(type, r)).toBe(0);
      expect(isValidPlacementRotation(type, 0)).toBe(true);
      for (const r of [1, 2, 3]) expect(isValidPlacementRotation(type, r)).toBe(false);
    }
  });

  it("every normalized selection is a valid rotation (client output ⊆ server input)", () => {
    for (const type of TYPES) for (const r of [0, 1, 2, 3]) {
      expect(isValidPlacementRotation(type, normalizePlacementRotation(type, r))).toBe(true);
    }
  });

  it("rejects non-integer, negative, out-of-range and unknown-kind rotations", () => {
    expect(isValidPlacementRotation("wall", 4)).toBe(false);
    expect(isValidPlacementRotation("wall", -1)).toBe(false);
    expect(isValidPlacementRotation("wall", 1.5)).toBe(false);
    expect(isValidPlacementRotation("bogus", 0)).toBe(false);
  });
});

describe("canonical footprint and build bounds", () => {
  it("every piece — ramps included — occupies exactly its one anchor tile at every rotation", () => {
    expect(rotatedFootprintExtents(STRUCTURES.ramp, 0)).toEqual({ xs: 1, ys: 1, zs: 1 });
    expect(rotatedFootprintExtents(STRUCTURES.ramp, 1)).toEqual({ xs: 1, ys: 1, zs: 1 });
    for (const type of TYPES) for (const r of [0, 1, 2, 3]) {
      expect(structureFootprintCells(type, { x: 1, y: 2, z: -1 }, r)).toEqual([{ x: 1, y: 2, z: -1 }]);
    }
  });

  it("accepts every cell of the build volume and rejects the cells just outside it", () => {
    const { minX, maxX, minZ, maxZ, minLayer, maxLayer } = BUILD_BOUNDS;
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) for (let y = minLayer; y <= maxLayer; y++) {
      expect(isWithinBuildBounds("wall", { x, y, z }, 0)).toBe(true);
    }
    for (const cell of [{ x: maxX + 1, y: 0, z: 0 }, { x: minX - 1, y: 0, z: 0 }, { x: 0, y: 0, z: maxZ + 1 }, { x: 0, y: 0, z: minZ - 1 }, { x: 0, y: maxLayer + 1, z: 0 }, { x: 0, y: minLayer - 1, z: 0 }]) {
      for (const type of TYPES) expect(isWithinBuildBounds(type, cell, 0)).toBe(false);
    }
  });

  it("a one-tile ramp fits at the edge of the build volume at every rotation", () => {
    for (const r of [0, 1, 2, 3]) {
      expect(isWithinBuildBounds("ramp", { x: BUILD_BOUNDS.maxX, y: 0, z: BUILD_BOUNDS.maxZ }, r)).toBe(true);
      expect(isWithinBuildBounds("ramp", { x: BUILD_BOUNDS.maxX + 1, y: 0, z: 0 }, r)).toBe(false);
    }
  });
});

describe("canonical build slots", () => {
  const tile = { x: 0, y: 0, z: 0 };
  const p = (buildType: string, grid: { x: number; y: number; z: number }, rotation = 0) => ({ buildType, grid, rotation });

  it("a ramp and all four walls of its tile coexist", () => {
    const pieces = [p("ramp", tile, 1), p("wall", tile, 0), p("wall", tile, 1), p("wall", tile, 2), p("wall", tile, 3)];
    for (const a of pieces) for (const b of pieces) if (a !== b) expect(slotsConflict(a, b), `${a.buildType}${a.rotation} × ${b.buildType}${b.rotation}`).toBe(false);
  });

  it("floor, ramp, cone and walls in one tile occupy distinct slots", () => {
    const keys = [p("floor", tile), p("ramp", tile, 2), p("cone", tile), p("wall", tile, 0), p("wall", tile, 1)]
      .flatMap((x) => structureSlots(x.buildType, x.grid, x.rotation));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("the same slot conflicts: duplicate floor / ramp / cone, and the same wall edge", () => {
    expect(slotsConflict(p("floor", tile), p("floor", tile))).toBe(true);
    expect(slotsConflict(p("ramp", tile, 0), p("ramp", tile, 3))).toBe(true); // one ramp slot per tile
    expect(slotsConflict(p("cone", tile), p("cone", tile))).toBe(true);
    expect(slotsConflict(p("wall", tile, 1), p("wall", tile, 1))).toBe(true);
  });

  it("canonicalizes a shared edge: the neighbour's opposite wall is the same slot", () => {
    expect(structureSlots("wall", tile, 2)).toEqual(structureSlots("wall", { x: 0, y: 0, z: 1 }, 0));
    expect(structureSlots("wall", tile, 1)).toEqual(structureSlots("wall", { x: 1, y: 0, z: 0 }, 3));
    expect(slotsConflict(p("wall", tile, 2), p("wall", { x: 0, y: 0, z: 1 }, 0))).toBe(true);
    // Different edges, different layers, and different tiles never contest.
    expect(slotsConflict(p("wall", tile, 0), p("wall", tile, 2))).toBe(false);
    expect(slotsConflict(p("wall", tile, 0), p("wall", { x: 0, y: 1, z: 0 }, 0))).toBe(false);
    expect(slotsConflict(p("wall", tile, 1), p("wall", { x: 0, y: 0, z: 1 }, 1))).toBe(false);
  });

  it("supports ramp-to-floor building: floors at the ramp's top layer and adjacent air floors", () => {
    const ramp = p("ramp", tile, 1);
    for (const floor of [p("floor", { x: 0, y: 1, z: 0 }), p("floor", { x: 0, y: 1, z: 1 }), p("floor", { x: 1, y: 1, z: 1 })]) {
      expect(slotsConflict(ramp, floor)).toBe(false);
    }
    expect(slotsConflict(p("floor", { x: 0, y: 1, z: 1 }), p("floor", { x: 0, y: 1, z: 2 }))).toBe(false);
  });

  it("walls snap to the tile edge nearest the aim point; build tiles are centred on grid × cellSize", () => {
    expect(wallEdgeRotation(tile, 0.2, -2)).toBe(0);
    expect(wallEdgeRotation(tile, 2, 0.3)).toBe(1);
    expect(wallEdgeRotation(tile, -0.4, 2.1)).toBe(2);
    expect(wallEdgeRotation(tile, -2.2, 1)).toBe(3);
    expect(buildCellAt(2.4, -2.4, 1)).toEqual({ x: 0, y: 1, z: 0 });
    expect(buildCellAt(2.7, 7.0, 0)).toEqual({ x: 1, y: 0, z: 1 });
  });
});

describe("canonical placement range (full 3D distance)", () => {
  const max = BUILD_RANGE.maxPlacementDistance;
  it("measures to the anchor cell's base corner", () => {
    expect(placementAnchorWorld({ x: 2, y: 1, z: -1 })).toEqual({ x: 10.24, y: 3.84, z: -5.12 });
  });
  it("accepts horizontal and vertical offsets up to the limit", () => {
    expect(isWithinPlacementRange({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 })).toBe(true); // 10.24 m
    expect(isWithinPlacementRange({ x: 10.24 - max, y: 0, z: 0 }, { x: 2, y: 0, z: 0 })).toBe(true); // exactly the limit
    expect(isWithinPlacementRange({ x: 10.24, y: 0, z: 0 }, { x: 2, y: 2, z: 0 })).toBe(true); // 7.68 m straight up
  });
  it("rejects an anchor beyond the limit in 3D even when it is within it horizontally", () => {
    // 10.24 m horizontally (in range on the ground) but 7 m above → 12.40 m.
    expect(isWithinPlacementRange({ x: 0, y: 7, z: 0 }, { x: 2, y: 0, z: 0 })).toBe(false);
    expect(isWithinPlacementRange({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 0 })).toBe(false); // 12.83 m
    expect(isWithinPlacementRange({ x: 10.24 - max - 0.01, y: 0, z: 0 }, { x: 2, y: 0, z: 0 })).toBe(false);
  });
});
