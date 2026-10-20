import { describe, expect, it } from "vitest";
import { BUILD_GRID } from "@buildshift/game-config";
import {
  WALL_EDIT_PATTERN_IDS,
  WALL_EDIT_PATTERNS,
  WALL_EDIT_PATTERN_TILE_COUNT,
  WALL_PANEL_THICKNESS,
  applyWallEditPattern,
  isWallEditPattern,
  wallPatternGeometry,
} from "./wallEditPatterns.js";

const ALL_SOLID = new Array<boolean>(9).fill(true);

describe("wall edit pattern registry", () => {
  it("exposes exactly the agreed pattern set", () => {
    expect([...WALL_EDIT_PATTERN_IDS]).toEqual([
      "window",
      "door",
      "half_top",
      "half_left",
      "half_right",
      "corner_top",
      "wide_opening",
      "practical_arch",
      "reset",
    ]);
  });

  it("defines a canonical 9-tile layout consistent with removedTiles for every pattern", () => {
    for (const id of WALL_EDIT_PATTERN_IDS) {
      const def = WALL_EDIT_PATTERNS[id];
      expect(def.tiles).toHaveLength(WALL_EDIT_PATTERN_TILE_COUNT);
      for (let i = 0; i < WALL_EDIT_PATTERN_TILE_COUNT; i++) {
        expect(def.tiles[i]).toBe(!def.removedTiles.includes(i));
      }
      // No duplicate or out-of-range removed tile.
      const seen = new Set(def.removedTiles);
      expect(seen.size).toBe(def.removedTiles.length);
      for (const i of def.removedTiles) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(WALL_EDIT_PATTERN_TILE_COUNT);
      }
    }
  });

  it("isWallEditPattern accepts known ids and rejects unknown values", () => {
    for (const id of WALL_EDIT_PATTERN_IDS) expect(isWallEditPattern(id)).toBe(true);
    expect(isWallEditPattern("arch")).toBe(false);
    expect(isWallEditPattern("")).toBe(false);
    expect(isWallEditPattern("DOOR")).toBe(false);
    expect(isWallEditPattern(4)).toBe(false);
    expect(isWallEditPattern(null)).toBe(false);
  });
});

describe("applyWallEditPattern (server-side validation)", () => {
  it.each([
    ["window", [4]],
    ["door", [4, 7]],
    ["half_top", [0, 1, 2]],
    ["half_left", [0, 3, 6]],
    ["half_right", [2, 5, 8]],
    ["corner_top", [0, 1, 3]],
    ["wide_opening", [6, 7, 8]],
    ["practical_arch", [3, 5, 6, 7, 8]],
    ["reset", []],
  ])("applies %s with the canonical tile layout", (pattern, removed) => {
    const r = applyWallEditPattern("wall", pattern);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pattern).toBe(pattern);
    expect(r.removedTiles).toEqual(removed);
    const expected = [...ALL_SOLID];
    for (const i of removed) expected[i] = false;
    expect(r.tiles).toEqual(expected);
  });

  it("maps reset to an all-solid layout with an empty editType", () => {
    const r = applyWallEditPattern("wall", "reset");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tiles).toEqual(ALL_SOLID);
    expect(r.removedTiles).toEqual([]);
    expect(r.editType).toBe("");
  });

  it("uses the pattern id as editType for non-reset patterns", () => {
    const r = applyWallEditPattern("wall", "door");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.editType).toBe("door");
  });

  it.each(["floor", "cone", "ramp", "roof", ""])("rejects %s structures with not_wall", (buildType) => {
    const r = applyWallEditPattern(buildType, "door");
    expect(r).toEqual({ ok: false, reason: "not_wall" });
  });

  it.each(["arch", "DOOR", "half", "top_corner", "", null, 4, ["window"]])(
    "rejects unknown pattern %j with unknown_pattern",
    (pattern) => {
      expect(applyWallEditPattern("wall", pattern)).toEqual({ ok: false, reason: "unknown_pattern" });
    },
  );

  it("does not mutate the canonical registry between applications", () => {
    const first = applyWallEditPattern("wall", "window");
    if (first.ok) first.tiles[4] = true;
    const second = applyWallEditPattern("wall", "window");
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.tiles[4]).toBe(false);
    expect(WALL_EDIT_PATTERNS.window.tiles[4]).toBe(false);
  });
});

describe("wallPatternGeometry (canonical geometry)", () => {
  const cs = BUILD_GRID.cellSize;
  const lh = BUILD_GRID.layerHeight;
  const anchor = { x: 0, y: 0, z: 0 };

  it("produces per-tile geometry for all 9 tiles matching the pattern layout", () => {
    const g = wallPatternGeometry("practical_arch", anchor, 0);
    expect(g.pattern).toBe("practical_arch");
    expect(g.tileGeometry).toHaveLength(9);
    expect(g.tileGeometry.map((t) => t.tileIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(g.tileGeometry.every((t) => t.solid === g.tiles[t.tileIndex])).toBe(true);
    expect(g.solidTiles.map((t) => t.tileIndex)).toEqual([0, 1, 2, 4]);
    expect(g.removedTiles).toEqual([3, 5, 6, 7, 8]);
  });

  it("tiles span thirds of the cell: cellSize/3 wide and layerHeight/3 tall", () => {
    const g = wallPatternGeometry("reset", anchor, 0);
    for (const t of g.tileGeometry) {
      expect(t.aabb.max.x - t.aabb.min.x).toBeCloseTo(cs / 3);
      expect(t.aabb.max.y - t.aabb.min.y).toBeCloseTo(lh / 3);
    }
    // Row 0 (top) occupies the top third of the layer; row 2 the bottom third.
    const top = g.tileGeometry[0].aabb;
    expect(top.max.y).toBeCloseTo(lh);
    expect(g.tileGeometry[8].aabb.min.y).toBeCloseTo(0);
    // Column 0 (left) starts at the cell's min-X end.
    expect(g.tileGeometry[0].aabb.min.x).toBeCloseTo(0);
    expect(g.tileGeometry[2].aabb.max.x).toBeCloseTo(cs);
  });

  it("centres the thin panel on the cell along the normal axis", () => {
    const g = wallPatternGeometry("reset", anchor, 0);
    for (const t of g.tileGeometry) {
      expect(t.aabb.min.z).toBeCloseTo(cs / 2 - WALL_PANEL_THICKNESS / 2);
      expect(t.aabb.max.z).toBeCloseTo(cs / 2 + WALL_PANEL_THICKNESS / 2);
    }
  });

  it("swaps the width axis to Z and the normal axis to X for rotation 1", () => {
    const g = wallPatternGeometry("reset", anchor, 1);
    for (const t of g.tileGeometry) {
      expect(t.aabb.max.z - t.aabb.min.z).toBeCloseTo(cs / 3);
      expect(t.aabb.max.x - t.aabb.min.x).toBeCloseTo(WALL_PANEL_THICKNESS);
    }
    // Column 0 sits on the min-Z end for rotation 1.
    expect(g.tileGeometry[0].aabb.min.z).toBeCloseTo(0);
    expect(g.tileGeometry[2].aabb.max.z).toBeCloseTo(cs);
  });

  it("flips the local-left column to the far world end under the 180° rotations", () => {
    // Rotation 2: local-left (col 0) starts at the max-X end of the cell.
    const r2 = wallPatternGeometry("half_left", { x: 1, y: 0, z: 0 }, 2);
    const removed = r2.tileGeometry.filter((t) => !t.solid);
    expect(removed.map((t) => t.tileIndex)).toEqual([0, 3, 6]);
    for (const t of removed) {
      expect(t.aabb.min.x).toBeCloseTo(2 * cs - cs / 3);
      expect(t.aabb.max.x).toBeCloseTo(2 * cs);
    }
    // Rotation 3: local-left column sits on the max-Z end.
    const r3 = wallPatternGeometry("half_left", { x: 0, y: 0, z: 1 }, 3);
    const removed3 = r3.tileGeometry.filter((t) => !t.solid);
    for (const t of removed3) {
      expect(t.aabb.min.z).toBeCloseTo(2 * cs - cs / 3);
      expect(t.aabb.max.z).toBeCloseTo(2 * cs);
    }
  });

  it("offsets tile geometry by the anchor grid cell", () => {
    const g = wallPatternGeometry("window", { x: 1, y: 2, z: -1 }, 0);
    const win = g.tileGeometry[4].aabb;
    expect(win.min.y).toBeCloseTo(2 * lh + (lh / 3) * 1); // middle row of layer 2
    expect(win.max.y).toBeCloseTo(2 * lh + (lh / 3) * 2);
    expect(win.min.x).toBeCloseTo(cs + cs / 3);
    expect(win.min.z).toBeCloseTo(-cs + cs / 2 - WALL_PANEL_THICKNESS / 2);
  });

  it("reset geometry is fully solid (9 solid tiles, none removed)", () => {
    const g = wallPatternGeometry("reset", anchor, 0);
    expect(g.solidTiles).toHaveLength(9);
    expect(g.removedTiles).toEqual([]);
    expect(g.tiles.every((t) => t)).toBe(true);
  });
});
