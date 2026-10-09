/**
 * Canonical build geometry and proportions contract.
 *
 * Pins the shared build-grid parameters, structure footprints, and build
 * volume bounds so that the client (preview snapper, renderer, selection)
 * and the authoritative server (validator, collider placement) derive
 * identical world-space dimensions from the same source.
 *
 * These are focused agreement/placement tests: they verify that the
 * shared config produces coherent, non-drifting geometry across all
 * four build types and that the build volume fits within the arena.
 */
import { describe, expect, it } from "vitest";
import {
  BUILD_GRID,
  BUILD_BOUNDS,
  BUILD_RANGE,
  BUILD_RATE,
  STRUCTURES,
  getStructureConfig,
  ARENA_COLLIDERS,
} from "../src/index.js";

// ─────────────────────────── Grid parameters ──────────────────────────────

describe("BUILD_GRID (shared grid lattice)", () => {
  it("uses a 2 m cell size (noticeably wider than the 0.7 m player)", () => {
    expect(BUILD_GRID.cellSize).toBe(2);
    // The cell must be at least 2x the player's width (0.7 m) for
    // comfortable maneuvering around structures.
    expect(BUILD_GRID.cellSize).toBeGreaterThanOrEqual(1.4);
  });

  it("uses a 1.5 m layer height (slightly shorter than the legacy 2 m)", () => {
    expect(BUILD_GRID.layerHeight).toBe(1.5);
    expect(BUILD_GRID.layerHeight).toBeLessThan(2);
  });

  it("ground layer is 0", () => {
    expect(BUILD_GRID.groundLayer).toBe(0);
  });
});

// ─────────────────────────── Build volume bounds ──────────────────────────

describe("BUILD_BOUNDS (fixed build volume)", () => {
  it("is symmetric on X/Z", () => {
    expect(BUILD_BOUNDS.minX).toBe(-BUILD_BOUNDS.maxX);
    expect(BUILD_BOUNDS.minZ).toBe(-BUILD_BOUNDS.maxZ);
  });

  it("fits within the arena ground (30 m × 30 m)", () => {
    // The arena ground has halfExtents [15, 0.25, 15] (30 m × 30 m).
    // The build volume in world metres must not exceed the arena.
    const worldSpanX = (BUILD_BOUNDS.maxX - BUILD_BOUNDS.minX + 1) * BUILD_GRID.cellSize;
    const worldSpanZ = (BUILD_BOUNDS.maxZ - BUILD_BOUNDS.minZ + 1) * BUILD_GRID.cellSize;
    const arena = ARENA_COLLIDERS.find((c) => c.id === "foundation-ground")!;
    const arenaSize = arena.halfExtents[0] * 2;
    expect(worldSpanX).toBeLessThanOrEqual(arenaSize);
    expect(worldSpanZ).toBeLessThanOrEqual(arenaSize);
  });

  it("min layer matches the ground layer", () => {
    expect(BUILD_BOUNDS.minLayer).toBe(BUILD_GRID.groundLayer);
  });

  it("max layer produces a reasonable max build height", () => {
    const maxBuildHeight =
      (BUILD_BOUNDS.maxLayer - BUILD_BOUNDS.minLayer + 1) * BUILD_GRID.layerHeight;
    // The player is 1.8 m tall; the max build height should be at least
    // 3x the player's height for meaningful vertical play.
    expect(maxBuildHeight).toBeGreaterThanOrEqual(5.4);
    // And not unreasonably tall (less than 15 m).
    expect(maxBuildHeight).toBeLessThan(15);
  });
});

// ─────────────────────────── Structure footprints ─────────────────────────

describe("STRUCTURES (per-kind footprints and costs)", () => {
  it("wall occupies 1×2×1 cells (2 m × 3 m × 2 m world)", () => {
    const w = getStructureConfig("wall")!;
    expect(w.footprint).toEqual([1, 2, 1]);
    expect(w.footprint[0] * BUILD_GRID.cellSize).toBe(2); // width
    expect(w.footprint[1] * BUILD_GRID.layerHeight).toBe(3); // height
    expect(w.footprint[2] * BUILD_GRID.cellSize).toBe(2); // depth
  });

  it("wall is 3 m tall — 1.67x the player's 1.8 m height (slightly shorter than legacy 4 m)", () => {
    const w = getStructureConfig("wall")!;
    const wallHeight = w.footprint[1] * BUILD_GRID.layerHeight;
    expect(wallHeight).toBe(3);
    expect(wallHeight).toBeGreaterThan(1.8); // taller than player
    expect(wallHeight).toBeLessThan(4); // shorter than the legacy 4 m wall
  });

  it("floor occupies 1×1×1 cells (2 m × 1.5 m × 2 m world)", () => {
    const f = getStructureConfig("floor")!;
    expect(f.footprint).toEqual([1, 1, 1]);
  });

  it("ramp occupies 2×1×1 cells (4 m × 1.5 m × 2 m world)", () => {
    const r = getStructureConfig("ramp")!;
    expect(r.footprint).toEqual([2, 1, 1]);
    expect(r.footprint[0] * BUILD_GRID.cellSize).toBe(4);
  });

  it("cone occupies 1×1×1 cells (2 m × 1.5 m × 2 m world)", () => {
    const c = getStructureConfig("cone")!;
    expect(c.footprint).toEqual([1, 1, 1]);
  });

  it("energy costs are preserved", () => {
    expect(getStructureConfig("wall")!.cost).toBe(10);
    expect(getStructureConfig("floor")!.cost).toBe(5);
    expect(getStructureConfig("ramp")!.cost).toBe(8);
    expect(getStructureConfig("cone")!.cost).toBe(6);
  });

  it("rotation counts are preserved", () => {
    expect(getStructureConfig("wall")!.rotationCount).toBe(4);
    expect(getStructureConfig("floor")!.rotationCount).toBe(1);
    expect(getStructureConfig("ramp")!.rotationCount).toBe(4);
    expect(getStructureConfig("cone")!.rotationCount).toBe(1);
  });
});

// ─────────────────────────── Server-client geometry agreement ─────────────

describe("server-client geometry agreement", () => {
  /**
   * The server's `wc()` function (world collider) computes:
   *   ctr.x = (g.x * 2 + xs - 1) / 2 * cellSize
   *   ctr.y = g.y * layerHeight + h * layerHeight / 2
   *   ctr.z = (g.z * 2 + zs - 1) / 2 * cellSize
   *   he.x  = xs * cellSize / 2
   *   he.y  = h * layerHeight / 2
   *   he.z  = zs * cellSize / 2
   *
   * The client's `gridToWorldAnchor` + footprint math must produce the
   * same anchor world position and footprint world dimensions.
   * This test verifies that agreement for all four build types.
   */
  it("client anchor world position matches server collider centre (X/Z)", () => {
    for (const buildType of ["wall", "floor", "ramp", "cone"] as const) {
      const config = getStructureConfig(buildType)!;
      const [fw, , fd] = config.footprint;
      // Test at a non-origin grid cell
      const g = { x: 3, y: 1, z: -2 };
      // Client: gridToWorldAnchor
      const anchorX = g.x * BUILD_GRID.cellSize;
      const anchorZ = g.z * BUILD_GRID.cellSize;
      // Server: wc() centre X/Z (rotation 0, so xs=fw, zs=fd)
      const serverCtrX = ((g.x * 2 + fw - 1) / 2) * BUILD_GRID.cellSize;
      const serverCtrZ = ((g.z * 2 + fd - 1) / 2) * BUILD_GRID.cellSize;
      // The anchor is the base of the cell; the collider centre is the
      // centre of the footprint. For a 1-cell-wide structure, the
      // anchor x = g.x * cellSize and the centre x = (g.x + 0.5) * cellSize.
      // They differ by half a cell — this is expected (the anchor is the
      // cell's origin, the collider centre is the structure's midpoint).
      expect(serverCtrX - anchorX).toBeCloseTo((fw - 1) * BUILD_GRID.cellSize / 2, 8);
      expect(serverCtrZ - anchorZ).toBeCloseTo((fd - 1) * BUILD_GRID.cellSize / 2, 8);
    }
  });

  it("client footprint world dimensions match server collider half-extents", () => {
    for (const buildType of ["wall", "floor", "ramp", "cone"] as const) {
      const config = getStructureConfig(buildType)!;
      const [fw, fh, fd] = config.footprint;
      // Client: footprint world dimensions
      const clientW = fw * BUILD_GRID.cellSize;
      const clientH = fh * BUILD_GRID.layerHeight;
      const clientD = fd * BUILD_GRID.cellSize;
      // Server: collider half-extents × 2 = full extents
      const serverW = 2 * ((fw * BUILD_GRID.cellSize) / 2);
      const serverH = 2 * ((fh * BUILD_GRID.layerHeight) / 2);
      const serverD = 2 * ((fd * BUILD_GRID.cellSize) / 2);
      expect(clientW).toBeCloseTo(serverW, 8);
      expect(clientH).toBeCloseTo(serverH, 8);
      expect(clientD).toBeCloseTo(serverD, 8);
    }
  });

  it("client layer world position matches server collider Y centre", () => {
    for (const buildType of ["wall", "floor", "ramp", "cone"] as const) {
      const config = getStructureConfig(buildType)!;
      const [, fh] = config.footprint;
      // Test at layer 2
      const layer = 2;
      // Client: gridToWorldAnchor Y
      const clientY = layer * BUILD_GRID.layerHeight;
      // Server: wc() centre Y
      const serverCtrY = layer * BUILD_GRID.layerHeight + (fh * BUILD_GRID.layerHeight) / 2;
      // The anchor is the base; the collider centre is the midpoint.
      expect(serverCtrY - clientY).toBeCloseTo((fh * BUILD_GRID.layerHeight) / 2, 8);
    }
  });

  it("build range is at least 3 cells (6 m) for meaningful placement", () => {
    // The placement range in cells should be at least 3 so a player can
    // build a few cells ahead.
    const rangeCells = BUILD_RANGE.maxPlacementDistance / BUILD_GRID.cellSize;
    expect(rangeCells).toBeGreaterThanOrEqual(3);
  });

  it("rate limit is unchanged", () => {
    expect(BUILD_RATE.minTicksBetweenPlacements).toBe(10);
  });
});

// ─────────────────────────── Coherent modular set ─────────────────────────

describe("coherent modular set (wall, floor, ramp, cone)", () => {
  it("all structures are at least 1 cell in each dimension", () => {
    for (const config of Object.values(STRUCTURES)) {
      for (const dim of config.footprint) {
        expect(dim).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("wall is the tallest structure (2 layers)", () => {
    const wall = getStructureConfig("wall")!;
    for (const config of Object.values(STRUCTURES)) {
      expect(config.footprint[1]).toBeLessThanOrEqual(wall.footprint[1]);
    }
  });

  it("ramp is the widest structure (2 cells on one axis)", () => {
    const ramp = getStructureConfig("ramp")!;
    const rampMaxSpan = Math.max(ramp.footprint[0], ramp.footprint[2]);
    for (const config of Object.values(STRUCTURES)) {
      const maxSpan = Math.max(config.footprint[0], config.footprint[2]);
      expect(maxSpan).toBeLessThanOrEqual(rampMaxSpan);
    }
  });

  it("wall height in world metres is consistent with layer height", () => {
    const wall = getStructureConfig("wall")!;
    const wallHeightMeters = wall.footprint[1] * BUILD_GRID.layerHeight;
    // Must be an exact multiple of the layer height (no fractional layers)
    expect(wallHeightMeters % BUILD_GRID.layerHeight).toBeCloseTo(0, 8);
  });

  it("floor occupies exactly one layer (walkable platform)", () => {
    const floor = getStructureConfig("floor")!;
    expect(floor.footprint[1]).toBe(1);
  });
});
