/**
 * gridSnap — the client's grid-snapping math for structure placement previews.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §21/§23, building is grid-based and the
 * client performs *non-authoritative preview logic*: a camera ray finds a
 * candidate surface, that point is snapped to the shared logical build grid,
 * and the result drives the (later) translucent placement preview. The server
 * remains the sole authority on whether a placement is valid.
 *
 * This module is pure math (no Babylon, no networking) so the exact snap
 * rules can be unit-tested in isolation and later mirrored by the
 * authoritative server validator. It reads the shared lattice from
 * `@buildshift/game-config` (`BUILD_GRID`) so client and server cannot
 * drift: both derive a cell's world-space position from the same cell
 * size / layer height.
 *
 * Grid conventions (the single source of truth for both client preview and
 * server validation):
 *
 *  - Cell `(gx, gz)` covers the world-space half-open square
 *    `x ∈ [gx*cellSize, (gx+1)*cellSize)` and
 *    `z ∈ [gz*cellSize, (gz+1)*cellSize)`.
 *  - Layer `gy` has its base at world
 *    `y = groundY + (gy - groundLayer) * layerHeight`.
 *  - A structure anchored at grid `G` with footprint `[w, h, d]` occupies the
 *    cells `(G.x + i, G.y + j, G.z + k)` for `i ∈ [0, w)`, `j ∈ [0, h)`,
 *    `k ∈ [0, d)` — the footprint extends from the anchor in the +X, +Y, +Z
 *    directions.
 */
import {
  BUILD_GRID,
  VERTICAL_MOVEMENT,
  getStructureConfig,
  type StructureConfig,
} from "@buildshift/game-config";
import type { BuildType, GridPosition } from "@buildshift/protocol";

/** The ground reference Y coordinate (metres) structures rest on. */
const GROUND_Y = VERTICAL_MOVEMENT.groundY;

/**
 * Snaps a world-space point to the nearest build-grid cell *below or at* the
 * point's X/Z, clamping the layer to the ground layer.
 *
 * The X/Z snap uses `floor`, matching the half-open cell convention above —
 * a point exactly on a cell boundary belongs to the cell in the + direction.
 * The layer is clamped to `groundLayer` so a hit below the ground (e.g. a
 * raycast that grazes the underside of the arena) can never produce a
 * sub-ground anchor.
 */
export function worldToGridPosition(
  x: number,
  y: number,
  z: number,
): GridPosition {
  const { cellSize, layerHeight, groundLayer } = BUILD_GRID;
  const gx = Math.floor(x / cellSize);
  const gz = Math.floor(z / cellSize);
  const rawLayer = Math.floor((y - GROUND_Y) / layerHeight) + groundLayer;
  const gy = Math.max(groundLayer, rawLayer);
  return { x: gx, y: gy, z: gz };
}

/**
 * Converts an anchor grid cell into the world-space position of that cell's
 * base centre (the point a rendering layer would use to position the
 * structure's anchor). The inverse of the X/Z portion of
 * {@link worldToGridPosition} for a point at the cell centre.
 */
export function gridToWorldAnchor(grid: GridPosition): {
  x: number;
  y: number;
  z: number;
} {
  const { cellSize, layerHeight, groundLayer } = BUILD_GRID;
  return {
    x: grid.x * cellSize,
    y: GROUND_Y + (grid.y - groundLayer) * layerHeight,
    z: grid.z * cellSize,
  };
}

/**
 * The structure-kind configuration for `buildType`, defaulting to a
 * single-cell `[1, 1, 1]` footprint when the id is unknown. The default
 * keeps the preview math total for arbitrary build types; validity of the
 * build type itself is checked elsewhere (protocol vocabulary).
 */
export function getFootprint(buildType: BuildType): StructureConfig["footprint"] {
  return getStructureConfig(buildType)?.footprint ?? [1, 1, 1];
}

/** Stable string key for a grid cell (e.g. `"1:0:-3"`). */
export function gridKey(grid: GridPosition): string {
  return `${grid.x}:${grid.y}:${grid.z}`;
}

/**
 * Enumerates every grid cell occupied by a structure of `buildType`
 * anchored at `grid`, per the footprint convention in the module header.
 */
export function footprintCells(
  buildType: BuildType,
  grid: GridPosition,
): GridPosition[] {
  const [w, h, d] = getFootprint(buildType);
  const cells: GridPosition[] = [];
  for (let i = 0; i < w; i += 1) {
    for (let j = 0; j < h; j += 1) {
      for (let k = 0; k < d; k += 1) {
        cells.push({ x: grid.x + i, y: grid.y + j, z: grid.z + k });
      }
    }
  }
  return cells;
}

/**
 * Returns true when the footprints of two structures (each described by a
 * build type + anchor grid cell) share at least one grid cell.
 */
export function footprintsOverlap(
  a: { buildType: BuildType; grid: GridPosition },
  b: { buildType: BuildType; grid: GridPosition },
): boolean {
  const occupied = new Set(
    footprintCells(b.buildType, b.grid).map(gridKey),
  );
  return footprintCells(a.buildType, a.grid).some((cell) =>
    occupied.has(gridKey(cell)),
  );
}
