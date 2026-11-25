/**
 * Task 4 — floor edit system: canonical 2×2 tile floor forms and the
 * collision geometry generated from the canonical floor edit state.
 *
 * A floor's authoritative edit state is the shared canonical `floor_cone`
 * 2×2 tile grid (`@buildshift/protocol` `editGrid`), row-major with index
 * `row * 2 + col` where `row` advances along world +Z and `col` along
 * world +X. The server restricts floor edits to a small set of canonical
 * *forms* — every non-empty subset of the four tiles maps to exactly one:
 *
 *  - `full`          — 4/4 tiles solid (the default / reset form),
 *  - `three_quarter` — 3/4 solid (one quadrant opened),
 *  - `half`          — 2 adjacent tiles solid (a half floor),
 *  - `diagonal`      — 2 diagonal tiles solid (a diagonal/corner opening),
 *  - `quadrant`      — 1 tile solid (a one-quadrant floor).
 *
 * The one form that is *invalid* is the empty grid (0 solid tiles): a floor
 * cannot be edited to nothing, so the authoritative server rejects the edit
 * that would remove the last remaining tile instead of applying it.
 *
 * `generateFloorEditGeometry` derives the structure's collision cuboids by
 * delegating to the shared canonical `structureCuboids` (thin 0.15 m slabs:
 * one full-cell slab unedited, one quarter-cell slab per solid tile when
 * edited), so the physics world always matches the authoritative edit state
 * AND what the client renders, picks and shoots.
 * Floors are rotation-invariant (`rotationCount === 1`, enforced at
 * placement), so no rotation parameter is needed.
 */

import { structureCuboids } from "@buildshift/game-config";
import { FLOOR_CONE_EDIT_COLS, FLOOR_CONE_EDIT_TILE_COUNT } from "@buildshift/protocol";

/** The canonical named forms a 2×2 floor edit may produce. */
export type FloorForm = "full" | "three_quarter" | "half" | "diagonal" | "quadrant";

/** All valid floor forms as a frozen tuple. */
export const FLOOR_FORMS = Object.freeze([
  "full",
  "three_quarter",
  "half",
  "diagonal",
  "quadrant",
] as const);

/** The grid anchor cell of a placed floor (integer cell indices). */
export interface FloorGridCell {
  /** Column index along world X. */
  x: number;
  /** Layer index along world Y (`0` = ground layer). */
  y: number;
  /** Column index along world Z. */
  z: number;
}

/** A single world-space collision cuboid generated from a floor tile. */
export interface FloorEditCuboid {
  /** World-space centre of the cuboid (metres, Y-up). */
  center: { x: number; y: number; z: number };
  /** World-space half-extents of the cuboid (metres). */
  halfExtents: { x: number; y: number; z: number };
}

/**
 * Whether two 2×2 tile indices share an edge (are adjacent).
 * Row-major indexing: `row = floor(i / 2)` (Z), `col = i % 2` (X).
 */
function areAdjacentTiles(a: number, b: number): boolean {
  const rowA = Math.floor(a / FLOOR_CONE_EDIT_COLS);
  const colA = a % FLOOR_CONE_EDIT_COLS;
  const rowB = Math.floor(b / FLOOR_CONE_EDIT_COLS);
  const colB = b % FLOOR_CONE_EDIT_COLS;
  return (rowA === rowB && Math.abs(colA - colB) === 1) || (colA === colB && Math.abs(rowA - rowB) === 1);
}

/**
 * Classifies a canonical 2×2 floor tile state into its named form.
 *
 * Returns `null` for the invalid empty form (no solid tiles) and for
 * malformed tile arrays (wrong length / missing), so callers can reject
 * anything that is not a valid floor form with a single check.
 */
export function classifyFloorForm(tiles: readonly boolean[] | null | undefined): FloorForm | null {
  if (!tiles || tiles.length !== FLOOR_CONE_EDIT_TILE_COUNT) {
    return null;
  }
  const solid: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i]) solid.push(i);
  }
  switch (solid.length) {
    case FLOOR_CONE_EDIT_TILE_COUNT:
      return "full";
    case 3:
      return "three_quarter";
    case 2:
      return areAdjacentTiles(solid[0], solid[1]) ? "half" : "diagonal";
    case 1:
      return "quadrant";
    default:
      return null;
  }
}

/**
 * Whether a canonical 2×2 floor tile state is a valid floor form (any
 * non-empty subset of the four tiles).
 */
export function isValidFloorForm(tiles: readonly boolean[] | null | undefined): boolean {
  return classifyFloorForm(tiles) !== null;
}

/**
 * Generates the floor's collision geometry from the canonical 2×2 edit
 * state by DELEGATING to the single source of truth, `structureCuboids`
 * (thin 0.15 m slab: one quarter-cell slab per solid tile, one full-cell
 * slab when unedited) — the SAME solids the client renders, picks and
 * shoots. The floor is rotation-invariant (`rotationCount === 1`, enforced
 * at placement), so no rotation parameter is needed. Returns an empty list
 * for the invalid empty form (the server rejects that state before any
 * geometry is generated).
 */
export function generateFloorEditGeometry(grid: FloorGridCell, tiles: readonly boolean[]): FloorEditCuboid[] {
  if (tiles.length !== FLOOR_CONE_EDIT_TILE_COUNT || !tiles.some(Boolean)) {
    return [];
  }
  return structureCuboids({
    buildType: "floor",
    grid: { x: grid.x, y: grid.y, z: grid.z },
    rotation: 0,
    editGrid: { kind: "floor_cone", tiles: [...tiles] },
  }).map((c) => ({
    center: { x: c.center.x, y: c.center.y, z: c.center.z },
    halfExtents: { x: c.halfExtents.x, y: c.halfExtents.y, z: c.halfExtents.z },
  }));
}
