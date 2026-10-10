/**
 * Focused tests for the 2×2 cone edit system (Task 5).
 *
 * Covers:
 *  - the canonical cone shape vocabulary and its 2×2 tile patterns,
 *  - total classification: every one of the 16 possible tile patterns maps to
 *    exactly one shape, and shape → tiles → shape round-trips,
 *  - validation: malformed tile sets / edit states are rejected with errors,
 *  - reset: `resetConeEditState()` yields the unmodified full cone and is
 *    idempotent + fresh (no aliasing),
 *  - generated geometry: per-corner heights, solid count, full/empty flags,
 *    base-corner anchors in canonical metres, JSON serializability, and the
 *    canonical `BUILD_GRID` agreement,
 *  - purity: inputs are never mutated.
 */
import { describe, expect, it } from "vitest";
import {
  BUILD_GRID,
} from "@buildshift/game-config";
import { FLOOR_CONE_EDIT_TILE_COUNT } from "@buildshift/protocol";

import {
  CONE_CORNER_COUNT,
  CONE_CORNER_NAMES,
  CONE_SHAPE_IDS,
  CONE_SHAPE_TILES,
  isConeShapeId,
  coneTilesForShape,
  coneShapeForTiles,
  validateConeTiles,
  isConeEditState,
  classifyConeEditState,
  resetConeEditState,
  coneGeometryFromTiles,
  coneGeometryFromState,
  type ConeShapeId,
} from "./coneEdit";

// ─── Vocabulary ────────────────────────────────────────────────────────────

describe("cone shape vocabulary", () => {
  it("declares exactly 16 canonical shapes (total over the 2×2 grid)", () => {
    expect(CONE_SHAPE_IDS).toHaveLength(16);
  });

  it("exposes the four 2×2 corner names (NW, NE, SW, SE)", () => {
    expect(CONE_CORNER_NAMES).toEqual(["NW", "NE", "SW", "SE"]);
  });

  it("the corner count equals the protocol floor/cone tile count (4)", () => {
    expect(CONE_CORNER_COUNT).toBe(FLOOR_CONE_EDIT_TILE_COUNT);
    expect(CONE_CORNER_COUNT).toBe(4);
  });

  it("every shape maps to exactly four boolean tiles", () => {
    for (const shape of CONE_SHAPE_IDS) {
      const tiles = CONE_SHAPE_TILES[shape];
      expect(Array.from(tiles).every((t) => typeof t === "boolean")).toBe(true);
      expect(tiles).toHaveLength(4);
    }
  });

  it("all 16 tile patterns are distinct (no two shapes share a pattern)", () => {
    const seen = new Set<string>();
    for (const shape of CONE_SHAPE_IDS) {
      const key = CONE_SHAPE_TILES[shape].join(",");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("the full cone is all-solid and none is all-removed", () => {
    expect(CONE_SHAPE_TILES.full).toEqual([true, true, true, true]);
    expect(CONE_SHAPE_TILES.none).toEqual([false, false, false, false]);
  });

  it("isConeShapeId accepts valid ids and rejects others", () => {
    for (const s of CONE_SHAPE_IDS) {
      expect(isConeShapeId(s)).toBe(true);
    }
    expect(isConeShapeId("bogus")).toBe(false);
    expect(isConeShapeId(42)).toBe(false);
    expect(isConeShapeId(null)).toBe(false);
    expect(isConeShapeId("")).toBe(false);
  });
});

// ─── Total classification + round-trip ─────────────────────────────────────

/** Enumerate all 16 possible 2×2 boolean patterns. */
function allPatterns(): boolean[][] {
  const out: boolean[][] = [];
  for (let bits = 0; bits < 16; bits++) {
    out.push([
      Boolean(bits & 1),
      Boolean(bits & 2),
      Boolean(bits & 4),
      Boolean(bits & 8),
    ]);
  }
  return out;
}

describe("total classification", () => {
  it("classifies all 16 patterns into exactly one canonical shape", () => {
    const classified = new Set<ConeShapeId>();
    for (const tiles of allPatterns()) {
      const shape = coneShapeForTiles(tiles);
      expect(isConeShapeId(shape)).toBe(true);
      classified.add(shape);
    }
    // Every pattern resolves, and every shape is reachable.
    expect(classified).toHaveLength(16);
    for (const s of CONE_SHAPE_IDS) {
      expect(classified.has(s)).toBe(true);
    }
  });

  it("tiles → shape → tiles round-trips for every shape", () => {
    for (const shape of CONE_SHAPE_IDS) {
      const tiles = coneTilesForShape(shape);
      const shape2 = coneShapeForTiles(tiles);
      expect(shape2).toBe(shape);
      expect(coneTilesForShape(shape2)).toEqual(tiles);
    }
  });

  it("the known named shapes map to their documented tile patterns", () => {
    // Single-corner removed.
    expect(coneShapeForTiles([false, true, true, true])).toBe("corner_nw_removed");
    expect(coneShapeForTiles([true, true, true, false])).toBe("corner_se_removed");
    // Half / directional.
    expect(coneShapeForTiles([true, true, false, false])).toBe("half_north");
    expect(coneShapeForTiles([false, false, true, true])).toBe("half_south");
    expect(coneShapeForTiles([true, false, true, false])).toBe("half_west");
    expect(coneShapeForTiles([false, true, false, true])).toBe("half_east");
    // Ramp-like diagonals (opposite-direction variants).
    expect(coneShapeForTiles([true, false, false, true])).toBe("ramp_diag_nw_se");
    expect(coneShapeForTiles([false, true, true, false])).toBe("ramp_diag_ne_sw");
    // Full / none.
    expect(coneShapeForTiles([true, true, true, true])).toBe("full");
    expect(coneShapeForTiles([false, false, false, false])).toBe("none");
  });
});

// ─── Validation ────────────────────────────────────────────────────────────

describe("validateConeTiles", () => {
  it("accepts a well-formed 4-tile set and returns a fresh copy", () => {
    const input = [true, false, true, true];
    const result = validateConeTiles(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tiles).toEqual([true, false, true, true]);
      // Fresh copy, not aliased to the input.
      expect(result.tiles).not.toBe(input);
    }
  });

  it("rejects a non-array", () => {
    for (const bad of [null, undefined, 42, "yes", {}]) {
      const result = validateConeTiles(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    }
  });

  it("rejects the wrong tile count", () => {
    expect(validateConeTiles([true, true, true]).ok).toBe(false);
    expect(validateConeTiles([true, true, true, true, true]).ok).toBe(false);
    expect(validateConeTiles([]).ok).toBe(false);
  });

  it("rejects non-boolean tiles", () => {
    expect(validateConeTiles([true, "yes", true, true]).ok).toBe(false);
    expect(validateConeTiles([true, 1, true, true]).ok).toBe(false);
    expect(validateConeTiles([true, null, true, true]).ok).toBe(false);
  });
});

describe("isConeEditState / classifyConeEditState", () => {
  it("accepts a canonical cone edit state", () => {
    expect(isConeEditState({ kind: "floor_cone", tiles: [true, true, false, true] })).toBe(true);
  });

  it("rejects the wrong kind", () => {
    expect(isConeEditState({ kind: "wall", tiles: [true, true, false, true] })).toBe(false);
    expect(isConeEditState({ kind: "ramp", variant: "full" })).toBe(false);
  });

  it("rejects malformed tiles on a cone edit state", () => {
    expect(isConeEditState({ kind: "floor_cone", tiles: [true, false] })).toBe(false);
    expect(isConeEditState({ kind: "floor_cone", tiles: [true, "x", true, true] })).toBe(false);
    expect(isConeEditState(null)).toBe(false);
    expect(isConeEditState("floor_cone")).toBe(false);
  });

  it("classifies a canonical cone edit state", () => {
    expect(classifyConeEditState({ kind: "floor_cone", tiles: [true, true, true, true] })).toBe("full");
    expect(classifyConeEditState({ kind: "floor_cone", tiles: [true, false, false, true] })).toBe("ramp_diag_nw_se");
  });

  it("classifyConeEditState throws on an invalid state", () => {
    expect(() => classifyConeEditState({ kind: "wall", tiles: [true, true] } as never)).toThrow();
    expect(() => classifyConeEditState({ kind: "floor_cone", tiles: [true] } as never)).toThrow();
  });
});

// ─── Reset ─────────────────────────────────────────────────────────────────

describe("resetConeEditState", () => {
  it("returns the unmodified full cone (all four corners solid)", () => {
    const reset = resetConeEditState();
    expect(reset.kind).toBe("floor_cone");
    expect(reset.tiles).toEqual([true, true, true, true]);
  });

  it("matches the full shape's tile pattern", () => {
    expect(resetConeEditState().tiles).toEqual(coneTilesForShape("full"));
  });

  it("classifies as 'full' and is a valid cone edit state", () => {
    const reset = resetConeEditState();
    expect(classifyConeEditState(reset)).toBe("full");
    expect(isConeEditState(reset)).toBe(true);
  });

  it("is idempotent", () => {
    expect(resetConeEditState()).toEqual(resetConeEditState());
  });

  it("returns a fresh, non-aliased object and array each call", () => {
    const a = resetConeEditState();
    const b = resetConeEditState();
    expect(a).not.toBe(b);
    expect(a.tiles).not.toBe(b.tiles);
    // Mutating one does not affect the other.
    a.tiles[0] = false;
    expect(b.tiles[0]).toBe(true);
  });
});

// ─── Generated geometry ────────────────────────────────────────────────────

describe("coneGeometryFromTiles", () => {
  it("full cone: four solid corners, full height, isFull true", () => {
    const g = coneGeometryFromTiles([true, true, true, true]);
    expect(g.shape).toBe("full");
    expect(g.cornerHeights).toEqual([1, 1, 1, 1]);
    expect(g.solidCount).toBe(4);
    expect(g.isFull).toBe(true);
    expect(g.isEmpty).toBe(false);
    for (const corner of g.baseCorners) {
      expect(corner.height).toBeCloseTo(BUILD_GRID.layerHeight, 8);
    }
  });

  it("single corner removed: three solid corners, the removed one at height 0", () => {
    // Remove NW (tile 0).
    const g = coneGeometryFromTiles([false, true, true, true]);
    expect(g.shape).toBe("corner_nw_removed");
    expect(g.solidCount).toBe(3);
    expect(g.isFull).toBe(false);
    expect(g.isEmpty).toBe(false);
    expect(g.baseCorners[0].height).toBe(0);
    expect(g.baseCorners[1].height).toBeCloseTo(BUILD_GRID.layerHeight, 8);
    expect(g.baseCorners[2].height).toBeCloseTo(BUILD_GRID.layerHeight, 8);
    expect(g.baseCorners[3].height).toBeCloseTo(BUILD_GRID.layerHeight, 8);
  });

  it("half/directional: two adjacent corners present", () => {
    const g = coneGeometryFromTiles([true, true, false, false]);
    expect(g.shape).toBe("half_north");
    expect(g.solidCount).toBe(2);
    expect(g.cornerHeights).toEqual([1, 1, 0, 0]);
    expect(g.baseCorners[0].height).toBeCloseTo(BUILD_GRID.layerHeight, 8);
    expect(g.baseCorners[3].height).toBe(0);
  });

  it("ramp-like diagonal: two opposite corners present", () => {
    const g = coneGeometryFromTiles([true, false, false, true]);
    expect(g.shape).toBe("ramp_diag_nw_se");
    expect(g.solidCount).toBe(2);
    expect(g.cornerHeights).toEqual([1, 0, 0, 1]);
  });

  it("none: empty geometry, no solid corners", () => {
    const g = coneGeometryFromTiles([false, false, false, false]);
    expect(g.shape).toBe("none");
    expect(g.solidCount).toBe(0);
    expect(g.isFull).toBe(false);
    expect(g.isEmpty).toBe(true);
    for (const corner of g.baseCorners) {
      expect(corner.height).toBe(0);
    }
  });

  it("emits four base-corner anchors at the canonical cell corners", () => {
    const c = BUILD_GRID.cellSize;
    const g = coneGeometryFromTiles([true, true, true, true]);
    expect(g.baseCorners).toHaveLength(4);
    // NW, NE, SW, SE local X/Z offsets.
    expect(g.baseCorners[0]).toMatchObject({ index: 0, name: "NW", x: 0, z: 0 });
    expect(g.baseCorners[1]).toMatchObject({ index: 1, name: "NE", x: c, z: 0 });
    expect(g.baseCorners[2]).toMatchObject({ index: 2, name: "SW", x: 0, z: c });
    expect(g.baseCorners[3]).toMatchObject({ index: 3, name: "SE", x: c, z: c });
  });

  it("is serializable (JSON round-trip preserves the descriptor)", () => {
    const g = coneGeometryFromTiles([true, false, true, false]);
    const round = JSON.parse(JSON.stringify(g)) as typeof g;
    expect(round.shape).toBe(g.shape);
    expect(round.cornerHeights).toEqual(g.cornerHeights);
    expect(round.solidCount).toBe(g.solidCount);
    expect(round.isFull).toBe(g.isFull);
    expect(round.isEmpty).toBe(g.isEmpty);
    expect(round.baseCorners).toEqual(g.baseCorners);
  });

  it("agrees with the canonical grid (height = layerHeight, offsets = cellSize)", () => {
    const g = coneGeometryFromTiles([true, true, false, false]);
    expect(g.baseCorners[0].height).toBeCloseTo(BUILD_GRID.layerHeight, 8);
    expect(g.baseCorners[1].x).toBeCloseTo(BUILD_GRID.cellSize, 8);
  });

  it("coneGeometryFromState matches coneGeometryFromTiles for the same tiles", () => {
    const state = { kind: "floor_cone" as const, tiles: [true, false, false, true] };
    expect(coneGeometryFromState(state)).toEqual(coneGeometryFromTiles(state.tiles));
  });

  it("throws on malformed tiles", () => {
    expect(() => coneGeometryFromTiles([true, false, true] as unknown as boolean[])).toThrow();
    expect(() => coneGeometryFromTiles([true, "x" as unknown as boolean, true, true])).toThrow();
  });
});

// ─── Purity ────────────────────────────────────────────────────────────────

describe("purity (inputs are never mutated)", () => {
  it("classify/shape/geometry do not mutate the input tile array", () => {
    const tiles = [true, false, true, false];
    const snapshot = [...tiles];
    coneShapeForTiles(tiles);
    coneGeometryFromTiles(tiles);
    expect(tiles).toEqual(snapshot);
  });

  it("coneTilesForShape returns a fresh array each call", () => {
    const a = coneTilesForShape("half_north");
    const b = coneTilesForShape("half_north");
    expect(a).not.toBe(b);
    a[0] = false;
    expect(b[0]).toBe(true);
  });
});
