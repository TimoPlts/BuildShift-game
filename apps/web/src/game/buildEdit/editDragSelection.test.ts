/**
 * Pure tests for the canonical edit-surface sampler and the drag traversal.
 *
 * The sampler must agree with the canonical edit geometry
 * (`structureCuboids`): aiming at the centre of the cuboid a tile produces
 * selects exactly that tile, for every wall rotation and for floors / cones.
 * The traversal must visit every tile a straight crosshair path crosses,
 * clipped to the grid.
 */
import { describe, expect, it } from "vitest";
import { structureCuboids } from "@buildshift/game-config";
import type { GridRotation } from "@buildshift/protocol";
import {
  TileDragSelection,
  cellsAlongSegment,
  editGridSize,
  sampleEditSurface,
  sampleTile,
  type EditSurfaceSample,
} from "./editDragSelection";

const RANGE = 40;

/** The world centre of the cuboid tile `i` contributes (only tile `i` solid). */
function tileCentre(buildType: "wall" | "floor" | "cone", rotation: GridRotation, i: number) {
  const count = buildType === "wall" ? 9 : 4;
  const tiles = Array.from({ length: count }, (_, k) => k === i);
  const grid = { x: 1, y: 1, z: -1 };
  const cuboids = structureCuboids({ buildType, grid, rotation, editGrid: { kind: buildType === "wall" ? "wall" : "floor_cone", tiles } });
  // Walls/floors: one cuboid per tile. Cones: the tile's column of levels —
  // average their centres (all share the quadrant's x/z centre).
  const n = cuboids.length;
  return {
    grid,
    x: cuboids.reduce((s, c) => s + c.center.x, 0) / n,
    y: cuboids.reduce((s, c) => s + c.center.y, 0) / n,
    z: cuboids.reduce((s, c) => s + c.center.z, 0) / n,
  };
}

describe("sampleEditSurface agrees with the canonical edit geometry", () => {
  it("wall: the tile under the crosshair is the tile the canonical geometry places there (all rotations, both sides)", () => {
    for (const rotation of [0, 1, 2, 3] as const) {
      const alongX = rotation === 0 || rotation === 2;
      for (let i = 0; i < 9; i++) {
        const c = tileCentre("wall", rotation, i);
        for (const side of [-1, 1]) {
          // Look at the tile centre straight through the panel's thin axis.
          const origin = alongX ? { x: c.x, y: c.y, z: c.z + side * 6 } : { x: c.x + side * 6, y: c.y, z: c.z };
          const dir = alongX ? { x: 0, y: 0, z: -side } : { x: -side, y: 0, z: 0 };
          const sample = sampleEditSurface({ buildType: "wall", grid: c.grid, rotation }, origin, dir, RANGE);
          expect(sample?.kind).toBe("tiles");
          expect(sampleTile(sample as EditSurfaceSample, { cols: 3, rows: 3 }), `rotation ${rotation} tile ${i} side ${side}`).toBe(i);
        }
      }
    }
  });

  it("floor and cone: the quadrant under the crosshair matches the canonical geometry", () => {
    for (const buildType of ["floor", "cone"] as const) {
      for (let i = 0; i < 4; i++) {
        const c = tileCentre(buildType, 0, i);
        // Oblique look from above toward the tile's centre column.
        const origin = { x: c.x + 2, y: c.grid.y * 3.84 + 9, z: c.z + 3 };
        const planeY = c.grid.y * 3.84 + (buildType === "floor" ? 0.075 : 1.92);
        const dir = { x: c.x - origin.x, y: planeY - origin.y, z: c.z - origin.z };
        const len = Math.hypot(dir.x, dir.y, dir.z);
        const sample = sampleEditSurface({ buildType, grid: c.grid, rotation: 0 }, origin, { x: dir.x / len, y: dir.y / len, z: dir.z / len }, RANGE);
        expect(sampleTile(sample as EditSurfaceSample, { cols: 2, rows: 2 }), `${buildType} tile ${i}`).toBe(i);
      }
    }
  });

  it("cone seen from the side: the aim on the pyramid always lands on a tile (near quadrants)", () => {
    const piece = { buildType: "cone" as const, grid: { x: 0, y: 0, z: 0 }, rotation: 0 as const };
    // Level camera 8 m in front (+Z) aiming at the lower left/right of the near face.
    for (const [x, tile] of [[-1.2, 2], [1.2, 3]] as const) {
      const sample = sampleEditSurface(piece, { x, y: 0.8, z: 8 }, { x: 0, y: 0, z: -1 }, RANGE) as EditSurfaceSample;
      expect(sample.inside).toBe(true);
      expect(sampleTile(sample, { cols: 2, rows: 2 })).toBe(tile); // row 1 = +Z (near) half
    }
  });

  it("wall aimed from above (entering its cell volume, not the panel): the aim still lands on a tile", () => {
    const piece = { buildType: "wall" as const, grid: { x: 0, y: 0, z: 0 }, rotation: 0 as const };
    // Steeply down onto the wall cell's top, 1.5 m in front of the panel: the
    // panel plane is only reached below ground.
    const dir = { x: 0, y: -0.94, z: -0.34 };
    const n = Math.hypot(dir.x, dir.y, dir.z);
    const sample = sampleEditSurface(piece, { x: 1.2, y: 8, z: 3.9 }, { x: dir.x / n, y: dir.y / n, z: dir.z / n }, RANGE) as EditSurfaceSample;
    expect(sample).not.toBeNull();
    expect(sample.inside).toBe(true);
    expect(sampleTile(sample, { cols: 3, rows: 3 })).toBe(2); // top row, +X column
  });

  it("reports samples off the grid (for continuous drags) and null when the plane is unreachable", () => {
    const piece = { buildType: "wall" as const, grid: { x: 0, y: 0, z: 0 }, rotation: 0 as const };
    const off = sampleEditSurface(piece, { x: 9, y: 1, z: 5 }, { x: 0, y: 0, z: -1 }, RANGE) as EditSurfaceSample;
    expect(off.inside).toBe(false);
    expect(sampleTile(off, { cols: 3, rows: 3 })).toBeNull();
    expect(sampleEditSurface(piece, { x: 0, y: 1, z: 5 }, { x: 1, y: 0, z: 0 }, RANGE)).toBeNull(); // parallel
    expect(sampleEditSurface(piece, { x: 0, y: 1, z: 5 }, { x: 0, y: 0, z: 1 }, RANGE)).toBeNull(); // pointing away
    expect(sampleEditSurface(piece, { x: 0, y: 1, z: 50 }, { x: 0, y: 0, z: -1 }, 12)).toBeNull(); // out of range
  });
});

describe("cellsAlongSegment", () => {
  const wall = editGridSize("wall")!;
  it("walks every crossed tile in order, one per tile", () => {
    expect(cellsAlongSegment({ u: 0.5, v: 1.5 }, { u: 2.5, v: 1.5 }, wall)).toEqual([3, 4, 5]);
    expect(cellsAlongSegment({ u: 0.5, v: 0.5 }, { u: 0.5, v: 2.5 }, wall)).toEqual([0, 3, 6]);
    expect(cellsAlongSegment({ u: 1.2, v: 1.2 }, { u: 1.8, v: 1.7 }, wall)).toEqual([4]);
  });
  it("includes both side neighbours when the path passes exactly through a tile corner", () => {
    expect(cellsAlongSegment({ u: 0.5, v: 0.5 }, { u: 2.5, v: 2.5 }, wall)).toEqual([0, 1, 3, 4, 5, 7, 8]);
  });
  it("clips to the grid: outside portions select nothing", () => {
    expect(cellsAlongSegment({ u: -3, v: 1.5 }, { u: -1, v: 1.5 }, wall)).toEqual([]);
    expect(cellsAlongSegment({ u: -3, v: 1.5 }, { u: 1.5, v: 1.5 }, wall)).toEqual([3, 4]);
    expect(cellsAlongSegment({ u: 1.5, v: -2 }, { u: 1.5, v: 5 }, wall)).toEqual([1, 4, 7]);
    expect(cellsAlongSegment({ u: 3, v: 3 }, { u: 3, v: 3 }, wall)).toEqual([8]); // exact max corner clamps in
  });
});

describe("TileDragSelection", () => {
  const size = { cols: 3, rows: 3 };
  const at = (u: number, v: number): EditSurfaceSample => ({ kind: "tiles", u, v, inside: u >= 0 && u < 3 && v >= 0 && v < 3, distance: 1 });
  it("fixes the mode from the first tile and never toggles a revisited tile", () => {
    const tiles = Array(9).fill(true);
    const drag = new TileDragSelection();
    expect(drag.press(at(0.5, 0.5), size, tiles)).toEqual([0]);
    expect(drag.getMode()).toBe("select");
    drag.move(at(1.5, 0.5), size, tiles);
    drag.move(at(0.5, 0.5), size, tiles);
    expect(tiles.flatMap((t, i) => (t ? [] : [i]))).toEqual([0, 1]);
    drag.release();
    expect(drag.isDragging()).toBe(false);
    expect(drag.move(at(2.5, 0.5), size, tiles)).toEqual([]); // released: no effect
  });
  it("a press on a removed tile restores along the drag", () => {
    const tiles = [false, false, true, true, true, true, true, true, true];
    const drag = new TileDragSelection();
    drag.press(at(0.5, 0.5), size, tiles);
    drag.move(at(1.5, 0.5), size, tiles);
    expect(drag.getMode()).toBe("deselect");
    expect(tiles.every(Boolean)).toBe(true);
  });
  it("skips null samples without breaking the path", () => {
    const tiles = Array(9).fill(true);
    const drag = new TileDragSelection();
    drag.press(at(0.5, 2.5), size, tiles);
    drag.move(null, size, tiles);
    drag.move(at(2.5, 2.5), size, tiles);
    expect(tiles.flatMap((t, i) => (t ? [] : [i]))).toEqual([6, 7, 8]);
  });
});
