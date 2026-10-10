/**
 * Unit tests for {@link aimEditTile} — the pure crosshair → canonical tile
 * (wall 3×3, floor/cone 2×2) / ramp half-cell mapping.
 *
 * Geometry conventions (shared with {@link structureAabb} /
 * {@link editTileLayout}):
 *
 *  - a piece at grid `(0,0,-1)` anchors at world `(0, 0, -5.12)` (cell size
 *    5.12, layer height 3.84); a wall's selectable box is
 *    `x ∈ [-2.56, 2.56]`, `y ∈ [0, 3.84]`, `z ∈ [-7.68, -2.56]`;
 *  - the wall's 3×3 grid projects onto the panel face in the piece's
 *    unrotated frame: col 0 = −X edge, row 0 = top;
 *  - the floor / cone 2×2 grid projects onto the base: col 0 = −X half,
 *    row 0 = −Z half;
 *  - the ramp splits into two half-cells at the anchor's X
 *    (default ramp rises from the −X end, so "left" = −X half).
 */
import { describe, expect, it } from "vitest";
import type { StructureState } from "@buildshift/protocol";
import { aimEditTile } from "./editTileSelection";

const RANGE = 12;

function wall(
  overrides: Partial<StructureState> = {},
): Pick<StructureState, "buildType" | "grid" | "rotation"> {
  return {
    structureId: "w1",
    buildType: "wall",
    grid: { x: 0, y: 0, z: -1 },
    rotation: 0,
    ownerId: "me",
    createdSequence: 0,
    ...overrides,
  };
}
function floor(
  overrides: Partial<StructureState> = {},
): Pick<StructureState, "buildType" | "grid" | "rotation"> {
  return {
    structureId: "f1",
    buildType: "floor",
    grid: { x: 0, y: 0, z: -1 },
    rotation: 0,
    ownerId: "me",
    createdSequence: 0,
    ...overrides,
  };
}
function cone(
  overrides: Partial<StructureState> = {},
): Pick<StructureState, "buildType" | "grid" | "rotation"> {
  return {
    structureId: "c1",
    buildType: "cone",
    grid: { x: 0, y: 0, z: -1 },
    rotation: 0,
    ownerId: "me",
    createdSequence: 0,
    ...overrides,
  };
}
function ramp(
  overrides: Partial<StructureState> = {},
): Pick<StructureState, "buildType" | "grid" | "rotation"> {
  return {
    structureId: "r1",
    buildType: "ramp",
    grid: { x: 0, y: 0, z: -1 },
    rotation: 0,
    ownerId: "me",
    createdSequence: 0,
    ...overrides,
  };
}

describe("aimEditTile — wall 3×3 mapping", () => {
  it("maps the crosshair to the centre tile on a straight-on aim", () => {
    // Aim from (0,2,0) straight down -Z: hits the near face centre.
    const aim = aimEditTile({
      structure: wall(),
      aimOrigin: { x: 0, y: 2, z: 0 },
      aimDirection: { x: 0, y: 0, z: -1 },
      maxRange: RANGE,
    });
    expect(aim).toEqual({ kind: "tile", tileIndex: 4 });
  });

  it("maps the nine wall tiles across the panel face", () => {
    // col = (lx + 2.56) / 1.7067, row = (3.84 - ry) / 1.28, tile = row*3+col.
    // Sweep a 3×3 set of aim points across the face.
    const aimXs = [-1.7, 0, 1.7];
    const aimYs = [3.3, 1.9, 0.4];
    let expected = 0;
    for (const y of aimYs) {
      for (const x of aimXs) {
        const aim = aimEditTile({
          structure: wall(),
          aimOrigin: { x, y, z: 0 },
          aimDirection: { x: 0, y: 0, z: -1 },
          maxRange: RANGE,
        });
        expect(aim).toEqual({ kind: "tile", tileIndex: expected });
        expected += 1;
      }
    }
  });

  it("unrotates the hit into the piece frame for a rotated wall", () => {
    // Rotation 1 turns the wall's face toward world −X. A ray from the west
    // hits the face centre → still the centre tile.
    const aim = aimEditTile({
      structure: wall({ rotation: 1 }),
      aimOrigin: { x: -10, y: 2, z: -5.12 },
      aimDirection: { x: 1, y: 0, z: 0 },
      maxRange: RANGE,
    });
    expect(aim).toEqual({ kind: "tile", tileIndex: 4 });

    // Top-left of the rotated face (world −Z edge, high) → tile 0.
    const topLeft = aimEditTile({
      structure: wall({ rotation: 1 }),
      aimOrigin: { x: -10, y: 3.5, z: -7 },
      aimDirection: { x: 1, y: 0, z: 0 },
      maxRange: RANGE,
    });
    expect(topLeft).toEqual({ kind: "tile", tileIndex: 0 });
  });

  it("returns null when the ray misses the piece", () => {
    const aim = aimEditTile({
      structure: wall(),
      aimOrigin: { x: 0, y: 10, z: 0 },
      aimDirection: { x: 0, y: 0, z: -1 },
      maxRange: RANGE,
    });
    expect(aim).toBeNull();
  });

  it("returns null when the hit is beyond the selection range", () => {
    // A wall 30 cells away: the near face is ~150 m out (> 12 m range).
    const aim = aimEditTile({
      structure: wall({ grid: { x: 0, y: 0, z: -30 } }),
      aimOrigin: { x: 0, y: 2, z: 0 },
      aimDirection: { x: 0, y: 0, z: -1 },
      maxRange: RANGE,
    });
    expect(aim).toBeNull();
  });
});

describe("aimEditTile — floor / cone 2×2 mapping", () => {
  it("maps the four floor quarters from a top-down aim", () => {
    // Top-down aim: hit (x, 3.84, z); col = x<0?0:1, row = z_local<0?0:1.
    // Local z = world z + 5.12, so world z ∈ [-7.68, -5.12) → row 0.
    const cases: Array<{ x: number; z: number; tile: number }> = [
      { x: -1, z: -6.4, tile: 0 }, // −X / −Z quarter
      { x: 1, z: -6.4, tile: 1 }, // +X / −Z quarter
      { x: -1, z: -3.8, tile: 2 }, // −X / +Z quarter
      { x: 1, z: -3.8, tile: 3 }, // +X / +Z quarter
    ];
    for (const c of cases) {
      const aim = aimEditTile({
        structure: floor(),
        aimOrigin: { x: c.x, y: 10, z: c.z },
        aimDirection: { x: 0, y: -1, z: 0 },
        maxRange: RANGE,
      });
      expect(aim).toEqual({ kind: "tile", tileIndex: c.tile });
    }
  });

  it("maps cone quarters with the same 2×2 convention", () => {
    const aim = aimEditTile({
      structure: cone(),
      aimOrigin: { x: -1, y: 10, z: -6.4 },
      aimDirection: { x: 0, y: -1, z: 0 },
      maxRange: RANGE,
    });
    expect(aim).toEqual({ kind: "tile", tileIndex: 0 });
  });
});

describe("aimEditTile — ramp half-cells", () => {
  it("splits the ramp at the anchor's X (left = −X half)", () => {
    // Ramp at grid (0,0,-1) spans world x ∈ [-2.56, 7.68]; anchor x = 0.
    const left = aimEditTile({
      structure: ramp(),
      aimOrigin: { x: -1, y: 2, z: 0 },
      aimDirection: { x: 0, y: 0, z: -1 },
      maxRange: RANGE,
    });
    expect(left).toEqual({ kind: "ramp_half", side: "left" });

    const right = aimEditTile({
      structure: ramp(),
      aimOrigin: { x: 1, y: 2, z: 0 },
      aimDirection: { x: 0, y: 0, z: -1 },
      maxRange: RANGE,
    });
    expect(right).toEqual({ kind: "ramp_half", side: "right" });
  });
});
