/**
 * Task 14 — collision from canonical edit state.
 *
 * Verifies that collision geometry is derived from exactly the same canonical
 * edit geometry as rendering:
 *  - Walls: per-tile thin-panel cuboids from the 9-tile edit state
 *  - Floors: quarter-cell cuboids from the 2×2 tile state
 *  - Cones: quarter-cell cuboids from the 2×2 tile state (same as floors)
 *  - Ramps: single cuboid from the directional variant
 *  - Reset: restores the full solid collider (no openings)
 *
 * Unedited structures keep their original `wc` collider — these tests only
 * cover the edited-state collision.
 */
import { describe, expect, it } from "vitest";
import { BUILD_GRID } from "@buildshift/game-config";
import { wallCollisionCuboids, WALL_EDIT_PATTERNS, WALL_PANEL_THICKNESS } from "../state/wallEditPatterns.js";
import { generateFloorEditGeometry } from "./floorEditGeometry.js";
import { rampCollisionCuboids } from "./rampCollisionGeometry.js";

const cs = BUILD_GRID.cellSize;
const lh = BUILD_GRID.layerHeight;

// ─── Wall collision ────────────────────────────────────────────────────────

describe("wallCollisionCuboids (collision from canonical wall edit state)", () => {
  const anchor = { x: 0, y: 0, z: 0 };

  it("generates one cuboid per solid tile for the reset pattern (all 9 solid)", () => {
    const tiles = WALL_EDIT_PATTERNS.reset.tiles;
    const cuboids = wallCollisionCuboids(anchor, 0, tiles);
    expect(cuboids).toHaveLength(9);
  });

  it("generates fewer cuboids for patterns with openings", () => {
    // Window removes tile 4 → 8 solid tiles.
    const windowCuboids = wallCollisionCuboids(anchor, 0, WALL_EDIT_PATTERNS.window.tiles);
    expect(windowCuboids).toHaveLength(8);

    // Door removes tiles 4 and 7 → 7 solid tiles.
    const doorCuboids = wallCollisionCuboids(anchor, 0, WALL_EDIT_PATTERNS.door.tiles);
    expect(doorCuboids).toHaveLength(7);

    // half_top removes the top row (3 tiles) → 6 solid tiles.
    const halfTopCuboids = wallCollisionCuboids(anchor, 0, WALL_EDIT_PATTERNS.half_top.tiles);
    expect(halfTopCuboids).toHaveLength(6);
  });

  it("cuboids span the full cell in the width and height axes (center-convention)", () => {
    const cuboids = wallCollisionCuboids(anchor, 0, WALL_EDIT_PATTERNS.reset.tiles);
    // The 9 tiles together should span [-cs/2, cs/2] in X and [0, lh] in Y.
    const minX = Math.min(...cuboids.map((c) => c.center.x - c.halfExtents.x));
    const maxX = Math.max(...cuboids.map((c) => c.center.x + c.halfExtents.x));
    const minY = Math.min(...cuboids.map((c) => c.center.y - c.halfExtents.y));
    const maxY = Math.max(...cuboids.map((c) => c.center.y + c.halfExtents.y));
    expect(minX).toBeCloseTo(-cs / 2);
    expect(maxX).toBeCloseTo(cs / 2);
    expect(minY).toBeCloseTo(0);
    expect(maxY).toBeCloseTo(lh);
  });

  it("cuboid thickness along the normal axis matches WALL_PANEL_THICKNESS", () => {
    const cuboids = wallCollisionCuboids(anchor, 0, WALL_EDIT_PATTERNS.reset.tiles);
    for (const c of cuboids) {
      expect(c.halfExtents.z).toBeCloseTo(WALL_PANEL_THICKNESS / 2);
    }
  });

  it("swaps the thickness axis for rotation 1 (normal along X)", () => {
    const cuboids = wallCollisionCuboids(anchor, 1, WALL_EDIT_PATTERNS.reset.tiles);
    for (const c of cuboids) {
      expect(c.halfExtents.x).toBeCloseTo(WALL_PANEL_THICKNESS / 2);
      expect(c.halfExtents.z).toBeCloseTo(cs / 6); // tileW / 2
    }
  });

  it("cuboid dimensions are one-third of the cell in width and height", () => {
    const cuboids = wallCollisionCuboids(anchor, 0, WALL_EDIT_PATTERNS.reset.tiles);
    for (const c of cuboids) {
      expect(c.halfExtents.x).toBeCloseTo(cs / 6); // (cs/3) / 2
      expect(c.halfExtents.y).toBeCloseTo(lh / 6); // (lh/3) / 2
    }
  });

  it("returns an empty array for malformed tile inputs", () => {
    expect(wallCollisionCuboids(anchor, 0, [true, true])).toEqual([]);
    expect(wallCollisionCuboids(anchor, 0, [])).toEqual([]);
  });

  it("returns an empty array when no tile is solid", () => {
    const allEmpty = new Array(9).fill(false);
    expect(wallCollisionCuboids(anchor, 0, allEmpty)).toEqual([]);
  });
});

// ─── Floor collision ───────────────────────────────────────────────────────

describe("generateFloorEditGeometry (collision from canonical floor edit state)", () => {
  const grid = { x: 0, y: 0, z: 0 };

  it("generates 4 quarter-cell cuboids for a full floor (reset state)", () => {
    const geo = generateFloorEditGeometry(grid, [true, true, true, true]);
    expect(geo).toHaveLength(4);
    for (const c of geo) {
      expect(c.halfExtents.x).toBeCloseTo(cs / 4);
      expect(c.halfExtents.y).toBeCloseTo(lh / 2);
      expect(c.halfExtents.z).toBeCloseTo(cs / 4);
    }
  });

  it("generates fewer cuboids when tiles are opened (floor holes drop)", () => {
    // Open the top-left tile → 3 cuboids.
    const geo = generateFloorEditGeometry(grid, [false, true, true, true]);
    expect(geo).toHaveLength(3);
  });

  it("cuboids span the full cell (center-convention)", () => {
    const geo = generateFloorEditGeometry(grid, [true, true, true, true]);
    const minX = Math.min(...geo.map((c) => c.center.x - c.halfExtents.x));
    const maxX = Math.max(...geo.map((c) => c.center.x + c.halfExtents.x));
    expect(minX).toBeCloseTo(-cs / 2);
    expect(maxX).toBeCloseTo(cs / 2);
  });
});

// ─── Cone collision ────────────────────────────────────────────────────────

describe("cone collision (reuses floor edit geometry)", () => {
  const grid = { x: 0, y: 0, z: 0 };

  it("generates quarter-cell cuboids from the 2×2 tile state", () => {
    const geo = generateFloorEditGeometry(grid, [true, true, true, false]);
    expect(geo).toHaveLength(3);
    for (const c of geo) {
      expect(c.halfExtents.x).toBeCloseTo(cs / 4);
      expect(c.halfExtents.y).toBeCloseTo(lh / 2);
      expect(c.halfExtents.z).toBeCloseTo(cs / 4);
    }
  });

  it("reset (all 4 tiles solid) generates 4 cuboids covering the full cell", () => {
    const geo = generateFloorEditGeometry(grid, [true, true, true, true]);
    expect(geo).toHaveLength(4);
    const minX = Math.min(...geo.map((c) => c.center.x - c.halfExtents.x));
    const maxX = Math.max(...geo.map((c) => c.center.x + c.halfExtents.x));
    const minZ = Math.min(...geo.map((c) => c.center.z - c.halfExtents.z));
    const maxZ = Math.max(...geo.map((c) => c.center.z + c.halfExtents.z));
    expect(minX).toBeCloseTo(-cs / 2);
    expect(maxX).toBeCloseTo(cs / 2);
    expect(minZ).toBeCloseTo(-cs / 2);
    expect(maxZ).toBeCloseTo(cs / 2);
  });
});

// ─── Ramp collision ────────────────────────────────────────────────────────

describe("rampCollisionCuboids (collision from canonical ramp edit state)", () => {
  const grid = { x: 0, y: 0, z: 0 };

  it("generates a single cuboid for the full variant (span = 2 cells)", () => {
    const cuboids = rampCollisionCuboids(grid, 0, "full");
    expect(cuboids).toHaveLength(1);
    const c = cuboids[0];
    // Full ramp spans 2 cells in X (rotation 0).
    expect(c.halfExtents.x).toBeCloseTo(cs);
    expect(c.center.x).toBeCloseTo(cs / 2); // midpoint of cells 0 and 1
    // Height matches the renderer's reduced-height box.
    expect(c.halfExtents.y).toBeCloseTo(lh * 0.3);
    expect(c.center.y).toBeCloseTo(lh * 0.3);
    // Depth is one cell.
    expect(c.halfExtents.z).toBeCloseTo(cs / 2);
    expect(c.center.z).toBeCloseTo(0);
  });

  it("generates a half-cell cuboid for half_left (span = 1 cell)", () => {
    const cuboids = rampCollisionCuboids(grid, 0, "half_left");
    expect(cuboids).toHaveLength(1);
    const c = cuboids[0];
    expect(c.halfExtents.x).toBeCloseTo(cs / 2);
    // "left" for rotation 0 is the min-X cell (cell 0).
    expect(c.center.x).toBeCloseTo(0);
  });

  it("generates a half-cell cuboid for half_right (span = 1 cell, offset)", () => {
    const cuboids = rampCollisionCuboids(grid, 0, "half_right");
    expect(cuboids).toHaveLength(1);
    const c = cuboids[0];
    expect(c.halfExtents.x).toBeCloseTo(cs / 2);
    // "right" for rotation 0 is the max-X cell (cell 1).
    expect(c.center.x).toBeCloseTo(cs);
  });

  it("swaps the span axis to Z for rotation 1", () => {
    const cuboids = rampCollisionCuboids(grid, 1, "full");
    expect(cuboids).toHaveLength(1);
    const c = cuboids[0];
    expect(c.halfExtents.z).toBeCloseTo(cs);
    expect(c.center.z).toBeCloseTo(cs / 2);
    expect(c.halfExtents.x).toBeCloseTo(cs / 2);
    expect(c.center.x).toBeCloseTo(0);
  });

  it("inverts the half offset under 180° rotation (rotation 2)", () => {
    // "half_left" for rotation 2 is the max-X cell (cell 1), because the
    // local frame is flipped.
    const left = rampCollisionCuboids(grid, 2, "half_left");
    expect(left[0].center.x).toBeCloseTo(cs);

    // "half_right" for rotation 2 is the min-X cell (cell 0).
    const right = rampCollisionCuboids(grid, 2, "half_right");
    expect(right[0].center.x).toBeCloseTo(0);
  });

  it("flipped and turn variants produce the full-span cuboid", () => {
    for (const variant of ["flipped", "turn_left", "turn_right"] as const) {
      const cuboids = rampCollisionCuboids(grid, 0, variant);
      expect(cuboids).toHaveLength(1);
      expect(cuboids[0].halfExtents.x).toBeCloseTo(cs);
    }
  });

  it("cuboid height is layerHeight * 0.6 (walkable ramp)", () => {
    for (const variant of ["full", "half_left", "half_right", "flipped"] as const) {
      const cuboids = rampCollisionCuboids(grid, 0, variant);
      expect(cuboids[0].halfExtents.y).toBeCloseTo(lh * 0.3);
    }
  });
});

// ─── Reset restores full collider ──────────────────────────────────────────

describe("reset restores full collider (no openings)", () => {
  it("wall reset generates 9 solid-tile cuboids spanning the full cell", () => {
    const tiles = WALL_EDIT_PATTERNS.reset.tiles;
    expect(tiles.every((t) => t)).toBe(true);
    const cuboids = wallCollisionCuboids({ x: 0, y: 0, z: 0 }, 0, tiles);
    expect(cuboids).toHaveLength(9);
    const minX = Math.min(...cuboids.map((c) => c.center.x - c.halfExtents.x));
    const maxX = Math.max(...cuboids.map((c) => c.center.x + c.halfExtents.x));
    const minY = Math.min(...cuboids.map((c) => c.center.y - c.halfExtents.y));
    const maxY = Math.max(...cuboids.map((c) => c.center.y + c.halfExtents.y));
    expect(minX).toBeCloseTo(-cs / 2);
    expect(maxX).toBeCloseTo(cs / 2);
    expect(minY).toBeCloseTo(0);
    expect(maxY).toBeCloseTo(lh);
  });

  it("floor reset (all 4 tiles solid) generates 4 cuboids covering the full cell", () => {
    const geo = generateFloorEditGeometry({ x: 0, y: 0, z: 0 }, [true, true, true, true]);
    expect(geo).toHaveLength(4);
  });

  it("ramp reset (full variant) generates the full-span cuboid", () => {
    const cuboids = rampCollisionCuboids({ x: 0, y: 0, z: 0 }, 0, "full");
    expect(cuboids).toHaveLength(1);
    expect(cuboids[0].halfExtents.x).toBeCloseTo(cs);
  });
});
