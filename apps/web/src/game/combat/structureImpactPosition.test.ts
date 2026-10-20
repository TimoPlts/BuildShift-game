/**
 * Unit tests for the build-impact presentation position resolver.
 *
 * The resolver is pure: it reads the replicated building mirror and maps a
 * structure's anchor grid cell to a world-space point (raised to the
 * structure's mid-height) for the impact spark. It returns null for unknown
 * structures so the runtime skips presentation rather than inventing a
 * location. The expected values below are derived from the shared
 * `@buildshift/game-config` build grid (cellSize ≈ 5.12, layerHeight ≈ 3.84, groundY 0)
 * and per-build footprints.
 */
import { describe, expect, it } from "vitest";
import type { BuildingState, StructureState } from "@buildshift/protocol";
import { resolveStructureImpactPosition } from "./structureImpactPosition";

function makeStructure(overrides: Partial<StructureState> = {}): StructureState {
  return {
    structureId: "s1",
    buildType: "wall",
    grid: { x: 2, y: 0, z: 3 },
    rotation: 0,
    ownerId: "p1",
    createdSequence: 1,
    ...overrides,
  };
}

describe("resolveStructureImpactPosition", () => {
  it("returns null for a structure that is not in the mirror", () => {
    const building: BuildingState = { structures: {} };
    expect(resolveStructureImpactPosition(building, "missing")).toBeNull();
  });

  it("maps the anchor grid cell to the structure's world-space centre", () => {
    // wall footprint [1,1,1] at grid (2,0,3): anchor (10.24,0,15.36),
    // mid-height = (1 layer * 3.84) / 2 = 1.92 -> (10.24, 1.92, 15.36).
    const building: BuildingState = {
      structures: { s1: makeStructure() },
    };
    expect(resolveStructureImpactPosition(building, "s1")).toEqual({
      x: 10.24,
      y: 1.92,
      z: 15.36,
    });
  });

  it("raises the impact to mid-height for stacked / elevated layers", () => {
    // floor footprint [1,1,1] at layer 1 (grid y=1): anchor y = (1-0)*3.84 = 3.84,
    // mid-height = (1 layer * 3.84) / 2 = 1.92 -> y = 5.76.
    const building: BuildingState = {
      structures: {
        f1: makeStructure({
          structureId: "f1",
          buildType: "floor",
          grid: { x: 0, y: 1, z: 0 },
        }),
      },
    };
    expect(resolveStructureImpactPosition(building, "f1")).toEqual({
      x: 0,
      y: 5.76,
      z: 0,
    });
  });

  it("tracks arbitrary grid anchors (including negative cells)", () => {
    const building: BuildingState = {
      structures: {
        w2: makeStructure({
          structureId: "w2",
          grid: { x: -4, y: 0, z: 7 },
        }),
      },
    };
    const pos = resolveStructureImpactPosition(building, "w2");
    expect(pos).not.toBeNull();
    expect(pos!.x).toBe(-20.48);
    expect(pos!.z).toBe(35.84);
    expect(pos!.y).toBe(1.92); // wall mid-height on the ground layer
  });
});
