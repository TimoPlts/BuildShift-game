/**
 * Unit tests for `computeStructureObstacles` — verifies that the world-space
 * AABBs computed from the building state match the expected grid-to-world
 * conversion.
 *
 * Contracts pinned here:
 *  - a single wall at grid (0,0,0) produces the correct AABB;
 *  - rotation swaps X/Z extents correctly;
 *  - multi-cell footprints (ramp: [2,1,1]) span the correct range;
 *  - elevated structures have the correct Y range;
 *  - an empty building state produces an empty array.
 */
import { describe, expect, it } from "vitest";
import { BUILD_GRID, VERTICAL_MOVEMENT } from "@buildshift/game-config";
import { computeStructureObstacles } from "./structureObstacles";
import type { BuildingState } from "@buildshift/protocol";

const { cellSize, layerHeight, groundLayer } = BUILD_GRID;
const GROUND_Y = VERTICAL_MOVEMENT.groundY;

function state(structures: Record<string, import("@buildshift/protocol").StructureState>): BuildingState {
  return { structures };
}

describe("computeStructureObstacles", () => {
  it("returns an empty array for an empty building state", () => {
    const result = computeStructureObstacles(state({}));
    expect(result).toHaveLength(0);
  });

  it("computes the correct AABB for a wall at grid (0,0,0), rotation 0", () => {
    const buildingState = state({
      "wall-1": {
        structureId: "wall-1",
        buildType: "wall",
        grid: { x: 0, y: 0, z: 0 },
        rotation: 0,
        ownerId: "player-1",
        createdSequence: 1,
      },
    });
    const result = computeStructureObstacles(buildingState);
    expect(result).toHaveLength(1);

    const aabb = result[0];
    // Wall footprint is [1,1,1], rotation 0 keeps X/Z.
    expect(aabb.min).toEqual([0, GROUND_Y, 0]);
    expect(aabb.max).toEqual([cellSize, GROUND_Y + layerHeight, cellSize]);
  });

  it("computes the correct AABB for a wall at grid (2,0,-1), rotation 0", () => {
    const buildingState = state({
      "wall-2": {
        structureId: "wall-2",
        buildType: "wall",
        grid: { x: 2, y: 0, z: -1 },
        rotation: 0,
        ownerId: "player-1",
        createdSequence: 2,
      },
    });
    const result = computeStructureObstacles(buildingState);
    expect(result).toHaveLength(1);

    const aabb = result[0];
    expect(aabb.min).toEqual([2 * cellSize, GROUND_Y, -cellSize]);
    expect(aabb.max).toEqual([3 * cellSize, GROUND_Y + layerHeight, 0]);
  });

  it("swaps X/Z extents for rotation 1", () => {
    // Ramp footprint is [2,1,1]. At rotation 1, X/Z swap: xs=1, zs=2.
    const buildingState = state({
      "ramp-1": {
        structureId: "ramp-1",
        buildType: "ramp",
        grid: { x: 0, y: 0, z: 0 },
        rotation: 1,
        ownerId: "player-1",
        createdSequence: 3,
      },
    });
    const result = computeStructureObstacles(buildingState);
    expect(result).toHaveLength(1);

    const aabb = result[0];
    // xs=1 (was depth), zs=2 (was width)
    expect(aabb.min).toEqual([0, GROUND_Y, 0]);
    expect(aabb.max).toEqual([cellSize, GROUND_Y + layerHeight, 2 * cellSize]);
  });

  it("keeps X/Z extents for rotation 2", () => {
    // Ramp footprint [2,1,1]. Rotation 2 keeps X/Z: xs=2, zs=1.
    const buildingState = state({
      "ramp-2": {
        structureId: "ramp-2",
        buildType: "ramp",
        grid: { x: 0, y: 0, z: 0 },
        rotation: 2,
        ownerId: "player-1",
        createdSequence: 4,
      },
    });
    const result = computeStructureObstacles(buildingState);
    expect(result).toHaveLength(1);

    const aabb = result[0];
    expect(aabb.min).toEqual([0, GROUND_Y, 0]);
    expect(aabb.max).toEqual([2 * cellSize, GROUND_Y + layerHeight, cellSize]);
  });

  it("computes the correct Y range for an elevated structure (layer 1)", () => {
    const buildingState = state({
      "floor-1": {
        structureId: "floor-1",
        buildType: "floor",
        grid: { x: 0, y: 1, z: 0 },
        rotation: 0,
        ownerId: "player-1",
        createdSequence: 5,
      },
    });
    const result = computeStructureObstacles(buildingState);
    expect(result).toHaveLength(1);

    const aabb = result[0];
    const yBase = GROUND_Y + (1 - groundLayer) * layerHeight;
    expect(aabb.min[1]).toBe(yBase);
    expect(aabb.max[1]).toBe(yBase + layerHeight);
  });

  it("computes multiple structures independently", () => {
    const buildingState = state({
      "wall-a": {
        structureId: "wall-a",
        buildType: "wall",
        grid: { x: 0, y: 0, z: 0 },
        rotation: 0,
        ownerId: "player-1",
        createdSequence: 1,
      },
      "wall-b": {
        structureId: "wall-b",
        buildType: "wall",
        grid: { x: 5, y: 0, z: 3 },
        rotation: 0,
        ownerId: "player-2",
        createdSequence: 2,
      },
    });
    const result = computeStructureObstacles(buildingState);
    expect(result).toHaveLength(2);
  });
});
