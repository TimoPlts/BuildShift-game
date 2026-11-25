/**
 * Task 14 — collision from canonical edit state.
 *
 * Verifies that collision geometry is derived from exactly the same canonical
 * edit geometry as rendering:
 *  - Walls: per-tile thin-panel cuboids from the 9-tile edit state
 *  - Floors: thin quarter-cell slabs from the 2×2 tile state (delegating to
 *    the shared canonical `structureCuboids`)
 *  - Cones: the thin stepped ROOF SHELL from `structureCuboids` — thin skirt
 *    bands around a hollow interior; removed quadrants are true openings
 *  - Ramps: single cuboid from the directional variant
 *  - Reset: restores the full solid collider (no openings)
 *
 * Unedited structures keep their original `wc` collider — these tests only
 * cover the edited-state collision.
 */
import { describe, expect, it } from "vitest";
import { BUILD_GRID, CONE_PEAK_HEIGHT, CONE_SHELL_THICKNESS, RAMP_STEPS, rayStructureIntersection, structureCuboids } from "@buildshift/game-config";
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

  it("generates the canonical thin full-cell slab for a full floor (reset state)", () => {
    const geo = generateFloorEditGeometry(grid, [true, true, true, true]);
    // Delegates to `structureCuboids`: ONE thin slab, not four full-height
    // columns — server colliders match what the client renders and shoots.
    expect(geo).toHaveLength(1);
    expect(geo[0]!.halfExtents.x).toBeCloseTo(cs / 2);
    expect(geo[0]!.halfExtents.y).toBeCloseTo(0.15 / 2);
    expect(geo[0]!.halfExtents.z).toBeCloseTo(cs / 2);
  });

  it("generates thin quarter slabs when tiles are opened (floor holes drop)", () => {
    // Open the top-left tile → 3 quarter slabs, each 0.15 m thick.
    const geo = generateFloorEditGeometry(grid, [false, true, true, true]);
    expect(geo).toHaveLength(3);
    for (const c of geo) expect(c.halfExtents.y).toBeCloseTo(0.15 / 2);
  });

  it("cuboids span the full cell (center-convention) and stay a thin slab", () => {
    const geo = generateFloorEditGeometry(grid, [true, true, true, true]);
    const minX = Math.min(...geo.map((c) => c.center.x - c.halfExtents.x));
    const maxX = Math.max(...geo.map((c) => c.center.x + c.halfExtents.x));
    const maxY = Math.max(...geo.map((c) => c.center.y + c.halfExtents.y));
    expect(minX).toBeCloseTo(-cs / 2);
    expect(maxX).toBeCloseTo(cs / 2);
    expect(maxY).toBeCloseTo(0.15);
  });

  it("the invalid empty form generates no geometry at all", () => {
    expect(generateFloorEditGeometry(grid, [false, false, false, false])).toEqual([]);
  });
});

// ─── Cone collision ────────────────────────────────────────────────────────

describe("cone collision (thin roof shell from the canonical 2×2 tile state)", () => {
  const grid = { x: 0, y: 0, z: 0 };

  it("full cone is a thin stepped shell within the documented bounds", () => {
    const geo = structureCuboids({ buildType: "cone", grid, rotation: 0 });
    expect(geo.length).toBeGreaterThan(0);
    const minX = Math.min(...geo.map((c) => c.center.x - c.halfExtents.x));
    const maxX = Math.max(...geo.map((c) => c.center.x + c.halfExtents.x));
    const minZ = Math.min(...geo.map((c) => c.center.z - c.halfExtents.z));
    const maxZ = Math.max(...geo.map((c) => c.center.z + c.halfExtents.z));
    const minY = Math.min(...geo.map((c) => c.center.y - c.halfExtents.y));
    const maxY = Math.max(...geo.map((c) => c.center.y + c.halfExtents.y));
    expect(minX).toBeCloseTo(-cs / 2);
    expect(maxX).toBeCloseTo(cs / 2);
    expect(minZ).toBeCloseTo(-cs / 2);
    expect(maxZ).toBeCloseTo(cs / 2);
    expect(minY).toBeCloseTo(0);
    expect(maxY).toBeCloseTo(CONE_PEAK_HEIGHT);
    for (const c of geo) expect(c.halfExtents.y * 2).toBeLessThanOrEqual(CONE_SHELL_THICKNESS + 1e-9);
  });

  it("a removed quadrant is a true full-height opening; retained quadrants still block", () => {
    const geo = structureCuboids({ buildType: "cone", grid, rotation: 0, editGrid: { kind: "floor_cone", tiles: [true, true, true, false] } });
    // Tile 3 (SE: +x, +z) removed → a vertical ray through that quadrant hits nothing.
    expect(rayStructureIntersection({ x: cs / 4, y: 6, z: cs / 4 }, { x: 0, y: -1, z: 0 }, 10, geo)).toBeNull();
    expect(rayStructureIntersection({ x: -cs / 4, y: 6, z: cs / 4 }, { x: 0, y: -1, z: 0 }, 10, geo)).not.toBeNull();
  });

  it("reset (all 4 tiles solid) restores the exact default shell", () => {
    const reset = structureCuboids({ buildType: "cone", grid, rotation: 0, editGrid: { kind: "floor_cone", tiles: [true, true, true, true] } });
    expect(reset).toEqual(structureCuboids({ buildType: "cone", grid, rotation: 0 }));
  });
});

// ─── Ramp collision ────────────────────────────────────────────────────────

describe("rampCollisionCuboids (collision from canonical ramp edit state)", () => {
  const grid = { x: 0, y: 0, z: 0 };
  const top = (cuboids: { center: { y: number }; halfExtents: { y: number } }[]) =>
    Math.max(...cuboids.map((c) => c.center.y + c.halfExtents.y));

  it("is exactly the shared canonical geometry for every variant and rotation", () => {
    for (const rotation of [0, 1, 2, 3]) {
      for (const variant of ["full", "flipped", "half_left", "half_right", "turn_left", "turn_right"] as const) {
        expect(rampCollisionCuboids(grid, rotation, variant)).toEqual(
          structureCuboids({ buildType: "ramp", grid, rotation, editGrid: { kind: "ramp", variant } }),
        );
      }
    }
  });

  it("the full ramp spans exactly one tile and rises one full layer", () => {
    const cuboids = rampCollisionCuboids(grid, 0, "full");
    expect(cuboids).toHaveLength(RAMP_STEPS);
    expect(Math.min(...cuboids.map((c) => c.center.x - c.halfExtents.x))).toBeCloseTo(-cs / 2);
    expect(Math.max(...cuboids.map((c) => c.center.x + c.halfExtents.x))).toBeCloseTo(cs / 2);
    expect(top(cuboids)).toBeCloseTo(lh);
  });

  it("half variants keep the full length and rise but only half the width", () => {
    for (const variant of ["half_left", "half_right"] as const) {
      const cuboids = rampCollisionCuboids(grid, 0, variant);
      expect(cuboids).toHaveLength(RAMP_STEPS);
      expect(top(cuboids)).toBeCloseTo(lh);
      for (const c of cuboids) expect(c.halfExtents.z).toBeCloseTo(cs / 4);
    }
    // Rotation 0 climbs +X, so the climber's left is +Z.
    expect(rampCollisionCuboids(grid, 0, "half_left")[0]!.center.z).toBeCloseTo(cs / 4);
    expect(rampCollisionCuboids(grid, 0, "half_right")[0]!.center.z).toBeCloseTo(-cs / 4);
  });

  it("ramp reset (full variant) generates the full-width, full-height ramp", () => {
    const cuboids = rampCollisionCuboids(grid, 0, "full");
    for (const c of cuboids) expect(c.halfExtents.z).toBeCloseTo(cs / 2);
    expect(top(cuboids)).toBeCloseTo(lh);
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

  it("floor reset (all 4 tiles solid) generates the full-cell thin slab", () => {
    const geo = generateFloorEditGeometry({ x: 0, y: 0, z: 0 }, [true, true, true, true]);
    expect(geo).toHaveLength(1);
    expect(geo[0]!.halfExtents.x).toBeCloseTo(cs / 2);
    expect(geo[0]!.halfExtents.z).toBeCloseTo(cs / 2);
    expect(geo[0]!.halfExtents.y).toBeCloseTo(0.15 / 2);
  });
});
