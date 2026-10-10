/**
 * coneEdit — the presentation-only 2×2 cone edit system.
 *
 * This builds on the canonical edit-grid model (`@buildshift/protocol`
 * `editGrid`, established by Task 2): a placed cone's edit state is the
 * serializable {@link FloorConeEditState} — a 2×2 row-major grid of tile
 * solidities (4 tiles, `true` = solid / corner present, `false` = removed).
 * That state is **server-authoritative**; this module only *reads* it.
 *
 * Given that canonical state, this module:
 *  - classifies the 2×2 tile pattern into a canonical named **cone shape**
 *    (full cone, single-corner removed, half/directional, ramp-like
 *    diagonals — each with its opposite-direction variant, single-corner
 *    spikes, and the empty/none pattern),
 *  - generates the cone **geometry** from that state (the per-corner base
 *    height field + the four generated base-corner anchors, in canonical
 *    metres), and
 *  - validates a raw tile set / edit state and provides a **reset** to the
 *    unmodified full cone.
 *
 * The 2×2 classification is *total*: every one of the 16 possible 4-tile
 * boolean patterns maps to exactly one canonical shape, and
 * {@link coneTilesForShape} / {@link coneShapeForTiles} are exact inverses.
 *
 * Authority contract: this module is **pure presentation**. It never mutates
 * game state, never sends network messages, and never performs authority
 * checks. Collision and gameplay rules are owned by the authoritative server
 * and are *not* touched here — the generated geometry is a presentation
 * parameter for the renderer, not a collider. The full-footprint collider is
 * unchanged.
 */
import {
  FLOOR_CONE_EDIT_TILE_COUNT,
  type FloorConeEditState,
} from "@buildshift/protocol";
import { BUILD_GRID } from "@buildshift/game-config";

// ─── 2×2 corner convention ────────────────────────────────────────────────
//
// The cone edit grid is 2×2, row-major. Each of the four tiles corresponds to
// one corner of the cone's base footprint. The row/column naming follows the
// structure's facing:
//
//     ┌──────────┬──────────┐
//     │   NW     │   NE     │
//     │  tile 0  │  tile 1  │
//     ├──────────┼──────────┤
//     │   SW     │   SE     │
//     │  tile 2  │  tile 3  │
//     └──────────┴──────────┘
//
// The structure's grid anchor sits at the footprint's local origin (0, 0) in
// X/Z; the 1×1 cell spans local X in [0, cellSize] and local Z in [0, cellSize].

/** The canonical 2×2 corner count (== the floor/cone edit tile count, 4). */
export const CONE_CORNER_COUNT = FLOOR_CONE_EDIT_TILE_COUNT;

/** Human-readable corner names in row-major order (NW, NE, SW, SE). */
export const CONE_CORNER_NAMES = Object.freeze(["NW", "NE", "SW", "SE"] as const);

/** A single 2×2 tile pattern (exactly four boolean tiles, row-major). */
export type ConeTilePattern = readonly [boolean, boolean, boolean, boolean];

// ─── Canonical cone shapes ────────────────────────────────────────────────

/**
 * The canonical, serializable cone shape identifiers. Each names exactly one
 * 2×2 tile pattern (see {@link CONE_SHAPE_TILES}).
 *
 *  - `full`                        — the unmodified full cone (all four corners).
 *  - `corner_*_removed`            — single-corner removed style (3 corners present).
 *  - `half_north/south/west/east`  — half / directional shapes (two adjacent corners).
 *  - `ramp_diag_nw_se/ne_sw`       — ramp-like diagonals (the two opposite-direction variants).
 *  - `corner_*_only`               — single-corner spikes (one corner present).
 *  - `none`                        — no corners present (the cone is fully removed).
 */
export const CONE_SHAPE_IDS = Object.freeze([
  "full",
  "corner_nw_removed",
  "corner_ne_removed",
  "corner_sw_removed",
  "corner_se_removed",
  "half_north",
  "half_south",
  "half_west",
  "half_east",
  "ramp_diag_nw_se",
  "ramp_diag_ne_sw",
  "corner_nw_only",
  "corner_ne_only",
  "corner_sw_only",
  "corner_se_only",
  "none",
] as const);

/** A canonical cone shape identifier (one of {@link CONE_SHAPE_IDS}). */
export type ConeShapeId = (typeof CONE_SHAPE_IDS)[number];

/**
 * The canonical table mapping each cone shape to its 2×2 tile pattern
 * (row-major `[NW, NE, SW, SE]`, `true` = solid). This is the single source
 * of truth for the shape vocabulary.
 */
export const CONE_SHAPE_TILES: Readonly<Record<ConeShapeId, ConeTilePattern>> =
  Object.freeze({
    full: [true, true, true, true],

    // Single-corner removed (three corners present).
    corner_nw_removed: [false, true, true, true],
    corner_ne_removed: [true, false, true, true],
    corner_sw_removed: [true, true, false, true],
    corner_se_removed: [true, true, true, false],

    // Half / directional (two adjacent corners present). North/south are the
    // opposite-direction pair; west/east are the opposite-direction pair.
    half_north: [true, true, false, false],
    half_south: [false, false, true, true],
    half_west: [true, false, true, false],
    half_east: [false, true, false, true],

    // Ramp-like diagonals (two opposite corners present); the two ids are the
    // opposite-direction variants of each other.
    ramp_diag_nw_se: [true, false, false, true],
    ramp_diag_ne_sw: [false, true, true, false],

    // Single-corner spikes (one corner present).
    corner_nw_only: [true, false, false, false],
    corner_ne_only: [false, true, false, false],
    corner_sw_only: [false, false, true, false],
    corner_se_only: [false, false, false, true],

    // No corners present.
    none: [false, false, false, false],
  }) as Readonly<Record<ConeShapeId, ConeTilePattern>>;

/** Type guard: `value` is a valid {@link ConeShapeId}. */
export function isConeShapeId(value: unknown): value is ConeShapeId {
  return (
    typeof value === "string" &&
    (CONE_SHAPE_IDS as readonly string[]).includes(value)
  );
}

/**
 * Encodes a 2×2 tile pattern as a 4-bit integer signature (bit `i` = tile
 * `i`), used as the key for the total tile → shape lookup table.
 */
function tileSignature(tiles: readonly boolean[]): number {
  let bits = 0;
  for (let i = 0; i < 4; i++) {
    if (tiles[i]) bits |= 1 << i;
  }
  return bits;
}

/**
 * The total tile-signature → shape table. Built once from
 * {@link CONE_SHAPE_TILES}; covers all 16 possible patterns.
 */
const SHAPE_BY_SIGNATURE: ReadonlyMap<number, ConeShapeId> = (() => {
  const map = new Map<number, ConeShapeId>();
  for (const shape of CONE_SHAPE_IDS) {
    const tiles = CONE_SHAPE_TILES[shape];
    const sig = tileSignature(tiles);
    if (map.has(sig)) {
      // Two shapes claiming the same pattern would make classification
      // ambiguous — that is a vocabulary bug, fail loudly at module load.
      throw new Error(
        `coneEdit: duplicate tile signature ${sig} for shape "${shape}"`,
      );
    }
    map.set(sig, shape);
  }
  return map;
})();

// ─── Shape ↔ tiles (exact inverses) ───────────────────────────────────────

/**
 * Returns a fresh 2×2 tile array for a canonical cone shape.
 *
 * @throws {Error} if `shape` is not a valid {@link ConeShapeId}.
 */
export function coneTilesForShape(shape: ConeShapeId): boolean[] {
  if (!isConeShapeId(shape)) {
    throw new Error(`coneEdit: unknown cone shape "${String(shape)}"`);
  }
  return [...CONE_SHAPE_TILES[shape]];
}

/**
 * Classifies a 2×2 tile pattern into its canonical cone shape.
 *
 * The mapping is total over the 16 valid patterns; it only throws on a
 * malformed input (wrong length or non-boolean tile) — a programming error,
 * since callers hand it an already-validated edit state.
 *
 * @throws {Error} if `tiles` is not exactly four booleans.
 */
export function coneShapeForTiles(tiles: readonly boolean[]): ConeShapeId {
  const v = validateConeTiles(tiles);
  if (!v.ok) {
    throw new Error(`coneEdit: malformed cone tiles (${v.errors.join("; ")})`);
  }
  const shape = SHAPE_BY_SIGNATURE.get(tileSignature(v.tiles));
  // Total over 16 patterns: a validated 4-tile input always resolves.
  if (shape === undefined) {
    throw new Error("coneEdit: no cone shape for validated tile pattern");
  }
  return shape;
}

// ─── Validation ────────────────────────────────────────────────────────────

/** The result of {@link validateConeTiles}. */
export type ConeTilesValidation =
  | { ok: true; tiles: boolean[] }
  | { ok: false; errors: string[] };

/**
 * Validates that `tiles` is a well-formed 2×2 cone tile set: a plain array of
 * exactly four booleans. Returns the normalized (copied) tiles on success or
 * a list of descriptive errors on failure. Pure — never mutates the input.
 */
export function validateConeTiles(tiles: unknown): ConeTilesValidation {
  const errors: string[] = [];
  if (!Array.isArray(tiles)) {
    return { ok: false, errors: [`tiles: must be an array, got ${typeOf(tiles)}`] };
  }
  if (tiles.length !== CONE_CORNER_COUNT) {
    errors.push(
      `tiles: must have exactly ${CONE_CORNER_COUNT} elements, got ${tiles.length}`,
    );
  } else {
    for (let i = 0; i < CONE_CORNER_COUNT; i++) {
      if (typeof tiles[i] !== "boolean") {
        errors.push(`tiles[${i}]: must be a boolean, got ${typeOf(tiles[i])}`);
      }
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, tiles: [...(tiles as boolean[])] };
}

/**
 * Structural type guard: `state` is a well-formed canonical cone edit state
 * (`kind === "floor_cone"` with exactly four boolean tiles). This is the
 * cone-specific view of the protocol's {@link FloorConeEditState}.
 */
export function isConeEditState(state: unknown): state is FloorConeEditState {
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    return false;
  }
  const s = state as Record<string, unknown>;
  if (s.kind !== "floor_cone") {
    return false;
  }
  return validateConeTiles(s.tiles).ok;
}

/**
 * Classifies a canonical cone edit state into its cone shape.
 *
 * @throws {Error} if `state` is not a well-formed cone edit state
 * ({@link isConeEditState} returns `false`).
 */
export function classifyConeEditState(state: FloorConeEditState): ConeShapeId {
  if (!isConeEditState(state)) {
    throw new Error("coneEdit: not a valid cone edit state");
  }
  return coneShapeForTiles(state.tiles);
}

// ─── Reset ─────────────────────────────────────────────────────────────────

/**
 * Returns the reset (unmodified) cone edit state: the full cone, all four
 * corners solid. A fresh object/array is returned each call (never aliased),
 * so callers own the result and can mutate it freely.
 */
export function resetConeEditState(): FloorConeEditState {
  return { kind: "floor_cone", tiles: coneTilesForShape("full") };
}

// ─── Generated geometry ────────────────────────────────────────────────────

/**
 * A single generated base-corner anchor of the cone, in local metres relative
 * to the structure's grid anchor.
 */
export interface ConeCornerGeometry {
  /** Row-major corner index (0=NW, 1=NE, 2=SW, 3=SE). */
  index: number;
  /** Human-readable corner name (NW/NE/SW/SE). */
  name: (typeof CONE_CORNER_NAMES)[number];
  /** Local X offset from the grid anchor (metres). */
  x: number;
  /** Local Z offset from the grid anchor (metres). */
  z: number;
  /** Per-corner base height (metres); `0` when that corner tile is removed. */
  height: number;
}

/**
 * The generated cone geometry for a 2×2 cone edit state — a plain,
 * serializable, deterministic descriptor the presentation layer can use to
 * build the cone mesh. It carries no Babylon/Babylon-specific types and
 * round-trips through JSON.
 */
export interface ConeGeometry {
  /** The canonical shape id for this tile pattern. */
  shape: ConeShapeId;
  /** Per-corner base height factor (0 or 1), row-major (NW, NE, SW, SE). */
  cornerHeights: [number, number, number, number];
  /** Number of solid corners (0–4). */
  solidCount: number;
  /** True when all four corners are present (the unmodified full cone). */
  isFull: boolean;
  /** True when no corner is present (nothing to render). */
  isEmpty: boolean;
  /** The four generated base-corner anchors (local metres). */
  baseCorners: ConeCornerGeometry[];
}

/** Local X/Z offsets (metres) of the four base corners from the grid anchor. */
function coneCornerOffsets(): ReadonlyArray<{ x: number; z: number }> {
  const c = BUILD_GRID.cellSize;
  return [
    { x: 0, z: 0 }, // NW
    { x: c, z: 0 }, // NE
    { x: 0, z: c }, // SW
    { x: c, z: c }, // SE
  ];
}

/**
 * Generates the cone geometry for a 2×2 cone edit state.
 *
 * Each solid corner contributes its full base height (`BUILD_GRID.layerHeight`);
 * a removed corner collapses to height `0`. The result is deterministic and
 * serializable.
 *
 * @throws {Error} if `tiles` is not a well-formed 2×2 tile set.
 */
export function coneGeometryFromTiles(tiles: readonly boolean[]): ConeGeometry {
  const v = validateConeTiles(tiles);
  if (!v.ok) {
    throw new Error(`coneEdit: malformed cone tiles (${v.errors.join("; ")})`);
  }
  const layerHeight = BUILD_GRID.layerHeight;
  const offsets = coneCornerOffsets();

  const cornerHeights: [number, number, number, number] = [
    v.tiles[0] ? 1 : 0,
    v.tiles[1] ? 1 : 0,
    v.tiles[2] ? 1 : 0,
    v.tiles[3] ? 1 : 0,
  ];
  const solidCount = cornerHeights.reduce((sum, h) => sum + h, 0);

  const baseCorners: ConeCornerGeometry[] = offsets.map((off, i) => ({
    index: i,
    name: CONE_CORNER_NAMES[i],
    x: off.x,
    z: off.z,
    height: cornerHeights[i] * layerHeight,
  }));

  return {
    shape: coneShapeForTiles(v.tiles),
    cornerHeights,
    solidCount,
    isFull: solidCount === CONE_CORNER_COUNT,
    isEmpty: solidCount === 0,
    baseCorners,
  };
}

/**
 * Generates the cone geometry directly from a canonical cone edit state.
 *
 * @throws {Error} if `state` is not a well-formed cone edit state.
 */
export function coneGeometryFromState(state: FloorConeEditState): ConeGeometry {
  return coneGeometryFromTiles(state.tiles);
}

// ─── small helpers ─────────────────────────────────────────────────────────

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
