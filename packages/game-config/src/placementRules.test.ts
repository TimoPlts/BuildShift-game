import { describe, expect, it } from "vitest";
import {
  BUILD_BOUNDS,
  STRUCTURES,
  isValidPlacementRotation,
  isWithinBuildBounds,
  normalizePlacementRotation,
  rotatedFootprintExtents,
  structureFootprintCells,
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
  it("rotations 1 and 3 swap the ramp footprint onto Z", () => {
    expect(rotatedFootprintExtents(STRUCTURES.ramp, 0)).toEqual({ xs: 2, ys: 1, zs: 1 });
    expect(rotatedFootprintExtents(STRUCTURES.ramp, 1)).toEqual({ xs: 1, ys: 1, zs: 2 });
    expect(structureFootprintCells("ramp", { x: 0, y: 0, z: 0 }, 2)).toEqual([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]);
    expect(structureFootprintCells("ramp", { x: 0, y: 0, z: 0 }, 3)).toEqual([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }]);
    for (const type of ["wall", "floor", "cone"] as const) for (const r of [0, 1, 2, 3]) {
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

  it("a ramp anchored at the edge fits only when its rotated footprint does", () => {
    const edge = { x: BUILD_BOUNDS.maxX, y: 0, z: 0 };
    expect(isWithinBuildBounds("ramp", edge, 0)).toBe(false); // runs to x = maxX + 1
    expect(isWithinBuildBounds("ramp", edge, 2)).toBe(false);
    expect(isWithinBuildBounds("ramp", edge, 1)).toBe(true); // runs along Z instead
    expect(isWithinBuildBounds("ramp", { x: 0, y: 0, z: BUILD_BOUNDS.maxZ }, 1)).toBe(false);
    expect(isWithinBuildBounds("ramp", { x: 0, y: 0, z: BUILD_BOUNDS.maxZ }, 0)).toBe(true);
  });
});
