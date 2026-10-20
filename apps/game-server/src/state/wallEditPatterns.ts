import { BUILD_GRID } from "@buildshift/game-config";

/**
 * Server-authoritative 3×3 wall edit pattern system.
 *
 * Follows the tile-driven edit-grid foundation: a wall structure carries a
 * canonical 3×3 tile grid (9 tiles, row-major) in its `editKind` /
 * `editTiles` state. This module defines the *named patterns* a player can
 * request in one action — window, door/doorway, half/top-half, left/right
 * half, corner/top-corner diagonal peek, wide opening, practical arch, and
 * reset — and generates the canonical geometry for later visual/collision
 * consumers.
 *
 * Authority rules (mirroring the existing build-edit handlers):
 *  - Only the authoritative server validates and applies a pattern; a client
 *    only ever sends a pattern *request* (structure id + pattern id).
 *  - Patterns apply to `wall` structures only; any other build type is
 *    rejected (`not_wall`).
 *  - An unknown pattern id is rejected (`unknown_pattern`).
 *  - Applying a pattern never changes placement cost, energy, or structure
 *    durability (HP); the room handler enforces that the structure is at
 *    full durability before an edit is accepted, exactly like the existing
 *    build-edit routes. The structure's authoritative full-cell collider is
 *    untouched — per-tile geometry here is *derived* data for consumers.
 *
 * Canonical tile layout (row-major, 9 tiles; `true` = solid, `false` =
 * removed/open). Row 0 is the *top* of the wall; column 0 is the *left* edge
 * when facing the wall from its default (rotation 0) facing direction:
 *
 *   0 1 2
 *   3 4 5
 *   6 7 8
 */

// ─── Pattern vocabulary ─────────────────────────────────────────────────────

/** All valid wall edit pattern ids, as a frozen tuple. */
export const WALL_EDIT_PATTERN_IDS = Object.freeze([
  "window",
  "door",
  "half_top",
  "half_left",
  "half_right",
  "corner_top",
  "wide_opening",
  "practical_arch",
  "reset",
] as const);

/** A valid wall edit pattern id. */
export type WallEditPattern = (typeof WALL_EDIT_PATTERN_IDS)[number];

/** Type guard: `value` is a valid {@link WallEditPattern}. */
export function isWallEditPattern(value: unknown): value is WallEditPattern {
  return (
    typeof value === "string" &&
    (WALL_EDIT_PATTERN_IDS as readonly string[]).includes(value)
  );
}

/** Total tile count of the canonical 3×3 wall edit grid. */
export const WALL_EDIT_PATTERN_TILE_COUNT = 9;

// ─── Canonical pattern definitions ──────────────────────────────────────────

/**
 * A named wall edit pattern: its canonical removed-tile set and the derived
 * 9-tile layout.
 */
export interface WallEditPatternDef {
  /** The pattern id. */
  id: WallEditPattern;
  /** Human-readable description of the opening. */
  label: string;
  /** Canonical tile indices (0–8) this pattern removes (opens). */
  removedTiles: readonly number[];
  /** Canonical 9-tile layout (row-major); `true` = solid, `false` = removed. */
  tiles: readonly boolean[];
}

function tilesFor(removed: readonly number[]): boolean[] {
  const tiles = new Array<boolean>(WALL_EDIT_PATTERN_TILE_COUNT).fill(true);
  for (const i of removed) tiles[i] = false;
  return tiles;
}

/**
 * The authoritative wall pattern registry.
 *
 * - `window`         — a single centre-tile opening: {4}
 * - `door`           — a walkable doorway in the centre column, lower two
 *                      tiles: {4, 7}
 * - `half_top`       — a half/top-half opening across the top row: {0, 1, 2}
 * - `half_left`      — a half opening across the left column: {0, 3, 6}
 * - `half_right`     — a half opening across the right column: {2, 5, 8}
 * - `corner_top`     — a top-corner diagonal peek, stepping down from the
 *                      top-left corner: {0, 1, 3}
 * - `wide_opening`   — a full-width opening across the bottom row:
 *                      {6, 7, 8}
 * - `practical_arch` — an arch: the bottom row plus the middle-row flanks,
 *                      leaving the top row and centre tile:
 *                      {3, 5, 6, 7, 8}
 * - `reset`          — no opening; restores the full solid wall: {}
 */
export const WALL_EDIT_PATTERNS: Record<WallEditPattern, WallEditPatternDef> = {
  window: {
    id: "window",
    label: "Window (centre tile)",
    removedTiles: [4],
    tiles: tilesFor([4]),
  },
  door: {
    id: "door",
    label: "Door / doorway (centre column, lower two tiles)",
    removedTiles: [4, 7],
    tiles: tilesFor([4, 7]),
  },
  half_top: {
    id: "half_top",
    label: "Half / top-half (top row)",
    removedTiles: [0, 1, 2],
    tiles: tilesFor([0, 1, 2]),
  },
  half_left: {
    id: "half_left",
    label: "Left half (left column)",
    removedTiles: [0, 3, 6],
    tiles: tilesFor([0, 3, 6]),
  },
  half_right: {
    id: "half_right",
    label: "Right half (right column)",
    removedTiles: [2, 5, 8],
    tiles: tilesFor([2, 5, 8]),
  },
  corner_top: {
    id: "corner_top",
    label: "Corner / top-corner diagonal peek (top-left corner step)",
    removedTiles: [0, 1, 3],
    tiles: tilesFor([0, 1, 3]),
  },
  wide_opening: {
    id: "wide_opening",
    label: "Wide opening (full-width bottom row)",
    removedTiles: [6, 7, 8],
    tiles: tilesFor([6, 7, 8]),
  },
  practical_arch: {
    id: "practical_arch",
    label: "Practical arch (bottom row + middle-row flanks)",
    removedTiles: [3, 5, 6, 7, 8],
    tiles: tilesFor([3, 5, 6, 7, 8]),
  },
  reset: {
    id: "reset",
    label: "Reset (full solid wall)",
    removedTiles: [],
    tiles: tilesFor([]),
  },
};

// ─── Server-side validation / application ───────────────────────────────────

/** Why the authoritative server rejected a wall edit pattern request. */
export type WallPatternRejectionReason = "unknown_pattern" | "not_wall";

/**
 * The result of validating + canonically applying a wall edit pattern.
 */
export type WallPatternApplyResult =
  | {
      ok: true;
      /** The validated pattern id. */
      pattern: WallEditPattern;
      /** Canonical 9-tile layout to write to the structure's `editTiles`. */
      tiles: boolean[];
      /** Canonical removed-tile indices for this pattern. */
      removedTiles: number[];
      /**
       * The `editType` string to store on the structure: the pattern id, or
       * `""` for `reset` (matching the existing "no edit" convention).
       */
      editType: string;
    }
  | { ok: false; reason: WallPatternRejectionReason };

/**
 * Server-side validation of a wall edit pattern request.
 *
 * Pure function: checks the pattern id against the registry and that the
 * structure is a `wall`. Does not touch ownership, durability, match phase,
 * cost, or energy — those authority checks stay in the room handler, which
 * is the same split the existing build-edit routes use.
 */
export function applyWallEditPattern(
  buildType: string,
  pattern: unknown,
): WallPatternApplyResult {
  if (!isWallEditPattern(pattern)) {
    return { ok: false, reason: "unknown_pattern" };
  }
  if (buildType !== "wall") {
    return { ok: false, reason: "not_wall" };
  }
  const def = WALL_EDIT_PATTERNS[pattern];
  return {
    ok: true,
    pattern,
    tiles: [...def.tiles],
    removedTiles: [...def.removedTiles],
    editType: pattern === "reset" ? "" : pattern,
  };
}

// ─── Canonical geometry (for later visual/collision consumers) ──────────────

/** A 3-component vector (metres, world space). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** An axis-aligned bounding box in world space. */
export interface WorldAabb {
  min: Vec3;
  max: Vec3;
}

/**
 * World-space geometry of one wall tile.
 */
export interface WallTileGeometry {
  /** Canonical tile index (0–8, row-major). */
  tileIndex: number;
  /** Whether the tile is solid under the pattern. */
  solid: boolean;
  /** World-space AABB of the tile (valid for both solid and removed tiles). */
  aabb: WorldAabb;
}

/**
 * The full canonical geometry of a pattern applied to a placed wall.
 *
 * Generated server-side so later visual/collision consumers (client
 * renderer, per-tile collision) can derive identical geometry from the
 * authoritative placement without re-implementing the mapping.
 */
export interface WallPatternGeometry {
  /** The applied pattern id. */
  pattern: WallEditPattern;
  /** The wall's anchor grid cell. */
  anchor: { x: number; y: number; z: number };
  /** The wall's cardinal rotation (0–3). */
  rotation: number;
  /** Canonical 9-tile layout (`true` = solid). */
  tiles: boolean[];
  /** Canonical removed-tile indices. */
  removedTiles: number[];
  /** Per-tile world-space geometry, in canonical tile-index order (0–8). */
  tileGeometry: WallTileGeometry[];
  /** Solid tiles only, in canonical tile-index order. */
  solidTiles: WallTileGeometry[];
}

/**
 * Nominal thickness of the wall's thin panel along its normal axis (metres).
 * Matches the client renderer's thin-wall convention (15% of a build cell),
 * so visual and derived-collision consumers agree. This is *derived*
 * geometry only: the authoritative structure collider remains the full cell.
 */
export const WALL_PANEL_THICKNESS = BUILD_GRID.cellSize * 0.15;

/**
 * Generates the canonical world-space geometry of a wall edit pattern for a
 * wall anchored at grid cell `anchor` with cardinal `rotation`.
 *
 * Tile → world mapping (see module docs for the canonical tile layout):
 *  - Columns (0–2) run along the wall's width axis: X for rotations 0/2,
 *    Z for rotations 1/3. Column 0 is on the wall's "left" in its local
 *    facing frame (for rotation 0, facing +X; rotation 1, facing +Z), and
 *    flips to the opposite world end under the 180° rotations.
 *  - Rows (0–2) run along world Y; row 0 (top) occupies the upper third of
 *    the layer.
 *  - The panel thickness axis is the wall's normal (Z for rotations 0/2,
 *    X for rotations 1/3), centred on the anchor cell.
 */
export function wallPatternGeometry(
  pattern: WallEditPattern,
  anchor: { x: number; y: number; z: number },
  rotation: number,
): WallPatternGeometry {
  const def = WALL_EDIT_PATTERNS[pattern];
  const cs = BUILD_GRID.cellSize;
  const lh = BUILD_GRID.layerHeight;
  const tileW = cs / 3;
  const tileH = lh / 3;

  const x0 = anchor.x * cs;
  const z0 = anchor.z * cs;
  const yBase = anchor.y * lh;
  const cx = x0 + cs / 2;
  const cz = z0 + cs / 2;

  // Width axis and "left" direction per rotation.
  const widthAxisX = rotation === 0 || rotation === 2;
  // For rotation 0 the local-left column starts at the cell's min-X end;
  // for rotation 2 (180°) it starts at the max-X end (and likewise for
  // 1 → min-Z, 3 → max-Z).
  const leftStartsAtMin = rotation === 0 || rotation === 1;

  const tileGeometry: WallTileGeometry[] = [];
  for (let i = 0; i < WALL_EDIT_PATTERN_TILE_COUNT; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const span = leftStartsAtMin ? col : 2 - col;

    let min: Vec3;
    let max: Vec3;
    if (widthAxisX) {
      min = { x: x0 + span * tileW, y: yBase + (2 - row) * tileH, z: cz - WALL_PANEL_THICKNESS / 2 };
      max = { x: min.x + tileW, y: min.y + tileH, z: cz + WALL_PANEL_THICKNESS / 2 };
    } else {
      min = { x: cx - WALL_PANEL_THICKNESS / 2, y: yBase + (2 - row) * tileH, z: z0 + span * tileW };
      max = { x: cx + WALL_PANEL_THICKNESS / 2, y: min.y + tileH, z: min.z + tileW };
    }

    tileGeometry.push({
      tileIndex: i,
      solid: def.tiles[i],
      aabb: { min, max },
    });
  }

  return {
    pattern,
    anchor: { x: anchor.x, y: anchor.y, z: anchor.z },
    rotation,
    tiles: [...def.tiles],
    removedTiles: [...def.removedTiles],
    tileGeometry,
    solidTiles: tileGeometry.filter((t) => t.solid),
  };
}

// ─── Collision geometry (center-convention, matching `wc`) ─────────────────

/** A world-space collision cuboid (centre + half-extents, metres). */
export interface WallCollisionCuboid {
  center: { x: number; y: number; z: number };
  halfExtents: { x: number; y: number; z: number };
}

/**
 * Generates the wall's collision cuboids from the canonical 9-tile edit state.
 *
 * Uses the same tile→world mapping as {@link wallPatternGeometry} but in the
 * center-convention coordinate system (the grid anchor is the centre of the
 * cell, matching the `wc` collider and the rendered mesh). Each solid tile
 * produces one thin-panel cuboid (WALL_PANEL_THICKNESS along the normal axis).
 * Removed tiles produce no cuboid — bullets and players pass through openings.
 *
 * Returns an empty array for malformed tile inputs or when no tile is solid.
 */
export function wallCollisionCuboids(
  anchor: { x: number; y: number; z: number },
  rotation: number,
  tiles: readonly boolean[],
): WallCollisionCuboid[] {
  if (tiles.length !== WALL_EDIT_PATTERN_TILE_COUNT) return [];

  const cs = BUILD_GRID.cellSize;
  const lh = BUILD_GRID.layerHeight;
  const tileW = cs / 3;
  const tileH = lh / 3;
  const wpt = WALL_PANEL_THICKNESS;

  // Center-convention: the grid anchor is the centre of the cell.
  const cx = anchor.x * cs;
  const cz = anchor.z * cs;
  const yBase = anchor.y * lh;

  const widthAxisX = rotation === 0 || rotation === 2;
  const leftStartsAtMin = rotation === 0 || rotation === 1;

  const out: WallCollisionCuboid[] = [];
  for (let i = 0; i < WALL_EDIT_PATTERN_TILE_COUNT; i++) {
    if (!tiles[i]) continue;
    const col = i % 3;
    const row = Math.floor(i / 3);
    const span = leftStartsAtMin ? col : 2 - col;

    if (widthAxisX) {
      out.push({
        center: {
          x: cx - cs / 2 + (span + 0.5) * tileW,
          y: yBase + (2 - row + 0.5) * tileH,
          z: cz,
        },
        halfExtents: { x: tileW / 2, y: tileH / 2, z: wpt / 2 },
      });
    } else {
      out.push({
        center: {
          x: cx,
          y: yBase + (2 - row + 0.5) * tileH,
          z: cz - cs / 2 + (span + 0.5) * tileW,
        },
        halfExtents: { x: wpt / 2, y: tileH / 2, z: tileW / 2 },
      });
    }
  }
  return out;
}
