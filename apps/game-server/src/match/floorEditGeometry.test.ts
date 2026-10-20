/**
 * Task 4 — floor edit system: canonical 2×2 tile form classification and
 * generated collision geometry.
 *
 * Covers every one of the 16 possible 2×2 tile subsets: the five canonical
 * floor forms (full / three_quarter / half / diagonal / quadrant) and the
 * single invalid form (the empty floor), plus the geometry the server
 * generates from the canonical edit state.
 */
import { describe, expect, it } from "vitest";
import { BUILD_GRID } from "@buildshift/game-config";
import {
  FLOOR_FORMS,
  classifyFloorForm,
  generateFloorEditGeometry,
  isValidFloorForm,
} from "./floorEditGeometry.js";

const T = true;
const F = false;

describe("classifyFloorForm (canonical 2×2 floor forms)", () => {
  it("classifies the full floor (4/4 solid) as 'full'", () => {
    expect(classifyFloorForm([T, T, T, T])).toBe("full");
  });

  it("classifies any single opened quadrant as 'three_quarter'", () => {
    expect(classifyFloorForm([F, T, T, T])).toBe("three_quarter");
    expect(classifyFloorForm([T, F, T, T])).toBe("three_quarter");
    expect(classifyFloorForm([T, T, F, T])).toBe("three_quarter");
    expect(classifyFloorForm([T, T, T, F])).toBe("three_quarter");
  });

  it("classifies adjacent-pair openings as 'half' (half floor)", () => {
    expect(classifyFloorForm([F, F, T, T])).toBe("half"); // top row opened
    expect(classifyFloorForm([T, T, F, F])).toBe("half"); // bottom row opened
    expect(classifyFloorForm([F, T, F, T])).toBe("half"); // left column opened
    expect(classifyFloorForm([T, F, T, F])).toBe("half"); // right column opened
  });

  it("classifies diagonal-pair openings as 'diagonal' (corner opening)", () => {
    expect(classifyFloorForm([F, T, T, F])).toBe("diagonal");
    expect(classifyFloorForm([T, F, F, T])).toBe("diagonal");
  });

  it("classifies a single remaining tile as 'quadrant' (one-quadrant floor)", () => {
    expect(classifyFloorForm([T, F, F, F])).toBe("quadrant");
    expect(classifyFloorForm([F, T, F, F])).toBe("quadrant");
    expect(classifyFloorForm([F, F, T, F])).toBe("quadrant");
    expect(classifyFloorForm([F, F, F, T])).toBe("quadrant");
  });

  it("rejects the empty floor as an invalid form", () => {
    expect(classifyFloorForm([F, F, F, F])).toBeNull();
    expect(isValidFloorForm([F, F, F, F])).toBe(false);
    expect(isValidFloorForm([T, F, F, F])).toBe(true);
    expect(isValidFloorForm([T, T, T, T])).toBe(true);
  });

  it("rejects malformed tile arrays", () => {
    expect(classifyFloorForm([T, T, T])).toBeNull();
    expect(classifyFloorForm([T, T, T, T, T])).toBeNull();
    expect(classifyFloorForm([])).toBeNull();
    expect(classifyFloorForm(null)).toBeNull();
    expect(classifyFloorForm(undefined)).toBeNull();
  });

  it("exposes the canonical floor-form vocabulary", () => {
    expect([...FLOOR_FORMS]).toEqual(["full", "three_quarter", "half", "diagonal", "quadrant"]);
  });
});

describe("generateFloorEditGeometry (canonical edit state → geometry)", () => {
  const grid = { x: 1, y: 0, z: -1 };
  const cs = BUILD_GRID.cellSize;
  const lh = BUILD_GRID.layerHeight;

  it("generates one quarter-cell cuboid per remaining tile for a full floor", () => {
    const geo = generateFloorEditGeometry(grid, [T, T, T, T]);
    expect(geo).toHaveLength(4);
    for (const c of geo) {
      expect(c.halfExtents.x).toBeCloseTo(cs / 4);
      expect(c.halfExtents.y).toBeCloseTo(lh / 2);
      expect(c.halfExtents.z).toBeCloseTo(cs / 4);
      expect(c.center.y).toBeCloseTo(grid.y * lh + lh / 2);
    }
    // The four quarter tiles span exactly the anchored build cell.
    const xs = geo.map((c) => c.center.x);
    const zs = geo.map((c) => c.center.z);
    expect(Math.min(...xs) - cs / 4).toBeCloseTo(grid.x * cs - cs / 2);
    expect(Math.max(...xs) + cs / 4).toBeCloseTo(grid.x * cs + cs / 2);
    expect(Math.min(...zs) - cs / 4).toBeCloseTo(grid.z * cs - cs / 2);
    expect(Math.max(...zs) + cs / 4).toBeCloseTo(grid.z * cs + cs / 2);
  });

  it("omits removed tiles (three-quarter floor keeps three cuboids)", () => {
    const geo = generateFloorEditGeometry(grid, [F, T, T, T]);
    expect(geo).toHaveLength(3);
    // The opened tile (col 0, row 0) must not be present.
    const removedX = grid.x * cs - cs / 4;
    const removedZ = grid.z * cs - cs / 4;
    expect(geo.some((c) => c.center.x === removedX && c.center.z === removedZ)).toBe(false);
  });

  it("positions quarter tiles by row (Z) and column (X) half indices", () => {
    const geo = generateFloorEditGeometry(grid, [T, F, F, F]);
    expect(geo).toHaveLength(1);
    expect(geo[0].center.x).toBeCloseTo(grid.x * cs - cs / 4);
    expect(geo[0].center.z).toBeCloseTo(grid.z * cs - cs / 4);
    const geo2 = generateFloorEditGeometry(grid, [F, F, F, T]);
    expect(geo2).toHaveLength(1);
    expect(geo2[0].center.x).toBeCloseTo(grid.x * cs + cs / 4);
    expect(geo2[0].center.z).toBeCloseTo(grid.z * cs + cs / 4);
  });

  it("generates no geometry for the invalid (empty) floor form", () => {
    expect(generateFloorEditGeometry(grid, [F, F, F, F])).toEqual([]);
  });

  it("generates no geometry for malformed tile arrays", () => {
    expect(generateFloorEditGeometry(grid, [T, T, T])).toEqual([]);
    expect(generateFloorEditGeometry(grid, [])).toEqual([]);
  });
});
