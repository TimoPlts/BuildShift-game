/**
 * Unit tests for `computeStructureObstacles` — the camera obstruction boxes
 * are the CANONICAL SOLID CUBOIDS of each structure's current (possibly
 * edited) geometry (shared `structureCuboids`), so the camera is blocked
 * exactly where solids stand and nowhere else.
 *
 * Contracts pinned here (build-feel-20261123):
 *  - every box equals a canonical cuboid of its structure (same volumes the
 *    player collides with, the shot ray intersects and the renderer draws);
 *  - a wall's box is a thin panel on its tile edge (walls are edge pieces);
 *  - a ramp is its 16 thin step slabs — NOT a full one-tile column (the old
 *    bounding-box behaviour made walkable support a phantom solid volume and
 *    produced the reported sudden camera zoom);
 *  - a cone is its thin stepped roof-shell bands, not a solid box and not a
 *    filled pyramid — the hollow interior obstructs nothing;
 *  - edited builds obstruct by their RETAINED solids (an opened tile is an
 *    actual opening for the camera too);
 *  - elevated structures have the correct Y range;
 *  - an empty building state produces an empty array.
 */
import { describe, expect, it } from "vitest";
import { BUILD_GRID, RAMP_STEPS, CONE_PEAK_HEIGHT, structureCuboids } from "@buildshift/game-config";
import { computeStructureObstacles } from "./structureObstacles";
import type { BuildingState, StructureState } from "@buildshift/protocol";

const { cellSize: cs, layerHeight: lh } = BUILD_GRID;

function piece(
  id: string,
  buildType: StructureState["buildType"],
  grid: StructureState["grid"],
  rotation: StructureState["rotation"] = 0,
  editGrid?: StructureState["editGrid"],
): StructureState {
  return { structureId: id, buildType, grid, rotation, ownerId: "p1", createdSequence: 1, ...(editGrid ? { editGrid } : {}) };
}
function state(...pieces: StructureState[]): BuildingState {
  return { structures: Object.fromEntries(pieces.map((p) => [p.structureId, p])) };
}

/** The canonical cuboids of a piece as AABB corner pairs, in order. */
function canonicalBoxes(p: StructureState) {
  return structureCuboids({
    buildType: p.buildType,
    grid: p.grid,
    rotation: p.rotation,
    editGrid: p.editGrid,
  }).map(({ center, halfExtents }) => ({
    min: [center.x - halfExtents.x, center.y - halfExtents.y, center.z - halfExtents.z],
    max: [center.x + halfExtents.x, center.y + halfExtents.y, center.z + halfExtents.z],
  }));
}

const contains = (b: { min: readonly number[]; max: readonly number[] }, p: [number, number, number]) =>
  p.every((v, i) => v > b.min[i]! && v < b.max[i]!);

describe("computeStructureObstacles", () => {
  it("returns an empty array for an empty building state", () => {
    expect(computeStructureObstacles(state())).toHaveLength(0);
  });

  it("emits exactly the canonical solid cuboids of every structure", () => {
    const pieces = [
      piece("w0", "wall", { x: 0, y: 0, z: 0 }, 0),
      piece("w1", "wall", { x: 2, y: 0, z: -1 }, 1),
      piece("r", "ramp", { x: -1, y: 0, z: 1 }, 3),
      piece("f", "floor", { x: 1, y: 1, z: 1 }),
      piece("c", "cone", { x: -2, y: 0, z: -2 }),
    ];
    const expected = pieces.flatMap(canonicalBoxes);
    expect(computeStructureObstacles(state(...pieces))).toEqual(expected);
  });

  it("a wall's box is a thin panel standing on its tile edge", () => {
    const boxes = computeStructureObstacles(state(piece("w", "wall", { x: 0, y: 0, z: 0 }, 0)));
    expect(boxes).toHaveLength(1);
    const [box] = boxes;
    expect(box!.min[2]).toBeCloseTo(-cs / 2 - 0.384, 6);
    expect(box!.max[2]).toBeCloseTo(-cs / 2 + 0.384, 6);
    expect([box!.min[0], box!.max[0]]).toEqual([-cs / 2, cs / 2]);
    const side = computeStructureObstacles(state(piece("w", "wall", { x: 0, y: 0, z: 0 }, 1)));
    expect(side[0]!.min[0]).toBeCloseTo(cs / 2 - 0.384, 6); // +X edge
  });

  it("a ramp is thin step slabs, not a one-tile solid column", () => {
    const boxes = computeStructureObstacles(state(piece("r", "ramp", { x: 1, y: 0, z: 0 }, 1)));
    expect(boxes).toHaveLength(RAMP_STEPS);
    // Each slab is thin in Y (a walking surface), and the ramp is OPEN
    // underneath: a point high above the lowest step inside the old
    // bounding box stands in actual air and matches no obstruction box.
    expect(boxes.every((b) => b.max[1] - b.min[1] <= 0.31)).toBe(true);
    const airPoint: [number, number, number] = [cs / 2 + 0.1, lh * 0.75, 0];
    expect(boxes.some((b) => contains(b, airPoint))).toBe(false);
    // ...while the top step's surface region is still obstructing (rot 1:
    // the ramp runs along +Z, so the top step sits at the +Z tile edge).
    const topStep: [number, number, number] = [1.5 * cs - 0.1, lh - 0.1, cs / 2 - 0.05];
    expect(boxes.some((b) => contains(b, topStep))).toBe(true);
  });

  it("a cone is a thin stepped roof shell, not a solid box or filled pyramid", () => {
    const boxes = computeStructureObstacles(state(piece("c", "cone", { x: 0, y: 0, z: 0 }, 0)));
    // Exact parity with the canonical solids the renderer draws and shots hit.
    expect(boxes).toHaveLength(structureCuboids({ buildType: "cone", grid: { x: 0, y: 0, z: 0 }, rotation: 0 }).length);
    // Cone height is DERIVED, not assumed: the canonical peak is
    // CONE_PEAK_HEIGHT (= lh/2, half a wall). Obstruction must follow that
    // canonical solid, never a full-layer column.
    expect(CONE_PEAK_HEIGHT).toBeLessThan(lh);
    // Just inside a bounding-box corner at mid layer height is actual air
    // (and above the canonical peak, too).
    const airPoint: [number, number, number] = [cs / 2 - 0.01, lh * 0.6, cs / 2 - 0.01];
    expect(boxes.some((b) => contains(b, airPoint))).toBe(false);
    // Free air directly ABOVE the canonical peak obstructs nothing...
    const abovePeak: [number, number, number] = [0, CONE_PEAK_HEIGHT + 0.1, 0];
    expect(boxes.some((b) => contains(b, abovePeak))).toBe(false);
    // ...the HOLLOW interior under the peak is real air (standing room
    // under an elevated cone, crouch space under a ground cone) — no
    // phantom fill obstructs the camera inside the roof.
    const attic: [number, number, number] = [0, CONE_PEAK_HEIGHT * 0.55, 0];
    expect(boxes.some((b) => contains(b, attic))).toBe(false);
    // The shell material itself obstructs: the apex cap and the base skirt.
    const capBand: [number, number, number] = [0, CONE_PEAK_HEIGHT - 0.05, 0];
    expect(boxes.some((b) => contains(b, capBand))).toBe(true);
    const skirt: [number, number, number] = [cs / 2 - 0.05, 0.05, 0];
    expect(boxes.some((b) => contains(b, skirt))).toBe(true);
  });

  it("an elevated floor is a slab at its layer base", () => {
    const boxes = computeStructureObstacles(state(piece("f", "floor", { x: 0, y: 1, z: 0 })));
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.min[1]).toBeCloseTo(lh, 9);
    expect(boxes[0]!.max[1]).toBeCloseTo(lh + 0.15, 9);
  });

  it("uses the ACTUAL canonical geometry of edited builds (openings obstruct nothing)", () => {
    // A wall with the two side columns opened (the middle column retained):
    // the 3 retained tiles obstruct, the opened columns are actual openings.
    const door = piece("w", "wall", { x: 0, y: 0, z: 0 }, 0, {
      kind: "wall",
      tiles: [false, true, false, false, true, false, false, true, false],
    });
    const boxes = computeStructureObstacles(state(door));
    expect(boxes).toHaveLength(3);
    expect(boxes).toEqual(canonicalBoxes(door));
    // An opened side column admits the camera ray (air at the panel plane).
    const opening: [number, number, number] = [-cs / 3, lh / 2, -cs / 2];
    expect(boxes.some((b) => contains(b, opening))).toBe(false);

    // A floor with two quadrants removed: only the retained quadrants.
    const holed = piece("f", "floor", { x: 0, y: 1, z: 0 }, 0, {
      kind: "floor_cone",
      tiles: [true, false, false, false],
    });
    const floorBoxes = computeStructureObstacles(state(holed));
    expect(floorBoxes).toHaveLength(1);
    expect(floorBoxes).toEqual(canonicalBoxes(holed));

    // The removed floor quadrant is air for the camera too.
    const removedQuadrant: [number, number, number] = [cs / 4, lh + 0.075, cs / 4];
    expect(floorBoxes.some((b) => contains(b, removedQuadrant))).toBe(false);
    // The retained quadrant still obstructs.
    expect(floorBoxes.some((b) => contains(b, [-cs / 4, lh + 0.075, -cs / 4]))).toBe(true);
  });
});
