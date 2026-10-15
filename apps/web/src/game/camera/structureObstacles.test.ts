/**
 * Unit tests for `computeStructureObstacles` — the camera obstruction boxes
 * are the bounds of each structure's canonical geometry (shared
 * `structureBounds`), so the camera is blocked exactly where pieces stand.
 *
 * Contracts pinned here:
 *  - every box equals the canonical bounds of its structure;
 *  - a wall's box is a thin panel on its tile edge (walls are edge pieces);
 *  - a ramp's box is its one tile, rising one layer;
 *  - elevated structures have the correct Y range;
 *  - an empty building state produces an empty array.
 */
import { describe, expect, it } from "vitest";
import { BUILD_GRID, structureBounds } from "@buildshift/game-config";
import { computeStructureObstacles } from "./structureObstacles";
import type { BuildingState, StructureState } from "@buildshift/protocol";

const { cellSize: cs, layerHeight: lh } = BUILD_GRID;

function piece(id: string, buildType: StructureState["buildType"], grid: StructureState["grid"], rotation: StructureState["rotation"] = 0): StructureState {
  return { structureId: id, buildType, grid, rotation, ownerId: "p1", createdSequence: 1 };
}
function state(...pieces: StructureState[]): BuildingState {
  return { structures: Object.fromEntries(pieces.map((p) => [p.structureId, p])) };
}

describe("computeStructureObstacles", () => {
  it("returns an empty array for an empty building state", () => {
    expect(computeStructureObstacles(state())).toHaveLength(0);
  });

  it("uses the canonical bounds of every structure", () => {
    const pieces = [
      piece("w0", "wall", { x: 0, y: 0, z: 0 }, 0),
      piece("w1", "wall", { x: 2, y: 0, z: -1 }, 1),
      piece("r", "ramp", { x: -1, y: 0, z: 1 }, 3),
      piece("f", "floor", { x: 1, y: 1, z: 1 }),
      piece("c", "cone", { x: -2, y: 0, z: -2 }),
    ];
    const boxes = computeStructureObstacles(state(...pieces));
    expect(boxes).toEqual(pieces.map((p) => structureBounds(p)));
  });

  it("a wall's box is a thin panel standing on its tile edge", () => {
    const [box] = computeStructureObstacles(state(piece("w", "wall", { x: 0, y: 0, z: 0 }, 0)));
    expect(box!.min[2]).toBeCloseTo(-cs / 2 - 0.384, 6);
    expect(box!.max[2]).toBeCloseTo(-cs / 2 + 0.384, 6);
    expect([box!.min[0], box!.max[0]]).toEqual([-cs / 2, cs / 2]);
    const [side] = computeStructureObstacles(state(piece("w", "wall", { x: 0, y: 0, z: 0 }, 1)));
    expect(side!.min[0]).toBeCloseTo(cs / 2 - 0.384, 6); // +X edge
  });

  it("a ramp's box is its one tile, rising exactly one layer", () => {
    const [box] = computeStructureObstacles(state(piece("r", "ramp", { x: 1, y: 0, z: 0 }, 1)));
    expect(box!.min.map((v) => +v.toFixed(6))).toEqual([cs / 2, 0, -cs / 2]);
    expect(box!.max.map((v) => +v.toFixed(6))).toEqual([1.5 * cs, lh, cs / 2]);
  });

  it("an elevated floor is a slab at its layer base", () => {
    const [box] = computeStructureObstacles(state(piece("f", "floor", { x: 0, y: 1, z: 0 })));
    expect(box!.min[1]).toBeCloseTo(lh, 9);
    expect(box!.max[1]).toBeCloseTo(lh + 0.15, 9);
  });
});
