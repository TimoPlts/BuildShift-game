/**
 * editDragSelection — crosshair sampling of a piece's canonical edit surface
 * and drag selection across its canonical edit tiles (presentation/input
 * only; nothing here is authoritative or networked).
 *
 * Surface sampling: the aim ray is intersected with the piece's canonical
 * edit surface and expressed in continuous **grid coordinates** `(u, v)`
 * where `floor(u)` is the tile column and `floor(v)` the tile row of the
 * canonical edit model (`structureCuboids` in `@buildshift/game-config`):
 *
 *  - wall 3×3 — the panel's mid-plane on its tile edge; columns run along
 *    the wall's axis in the canonical order (mirrored for rotations 2/3),
 *    row 0 is the top row;
 *  - floor 2×2 — the slab's mid-plane; column = world X half, row = world Z
 *    half (floors are rotation-invariant);
 *  - cone 2×2 — the horizontal plane at half the pyramid's height, same
 *    column/row convention as floors;
 *  - fallback (all tile pieces) — when the crosshair is on the piece's
 *    selection volume but the plane point lies off the grid (a cone seen
 *    from the side, a wall aimed at from above), the point where the ray
 *    enters the volume is used, so every aim that selects a piece hits a
 *    tile;
 *  - ramp — which canonical width half (`half_left` / `half_right`) the aim
 *    is over (ramps edit by variant, not by tile drag).
 *
 * Samples are produced even when the crosshair is outside the tile grid
 * (`inside: false`), so a drag can be traced continuously across the edge.
 *
 * Drag selection: {@link TileDragSelection} turns a press + per-frame
 * samples into tile changes. Between two samples it walks every grid cell the
 * straight crosshair path crosses ({@link cellsAlongSegment}), so a fast drag
 * — or a slow frame rate — never skips an intermediate tile. The first tile
 * pressed decides the drag's meaning for the whole drag (select = mark for
 * removal, or deselect = restore), so revisiting a tile never toggles it back.
 */
import { BUILD_GRID, structureCuboids, wallEdgeCenter } from "@buildshift/game-config";
import type { BuildType, GridPosition, GridRotation } from "@buildshift/protocol";
import { rayAabbDistance, structureAabb, type Vec3Like } from "./structureSelection";

/** A tile grid's dimensions (wall 3×3, floor/cone 2×2). */
export interface EditGridSize {
  cols: number;
  rows: number;
}

/** The tile grid of a tile-edited build type, or `null` (ramp / unknown). */
export function editGridSize(buildType: BuildType): EditGridSize | null {
  if (buildType === "wall") return { cols: 3, rows: 3 };
  if (buildType === "floor" || buildType === "cone") return { cols: 2, rows: 2 };
  return null;
}

/** One crosshair sample on a tile-edited piece's canonical surface. */
export interface EditSurfaceSample {
  kind: "tiles";
  /** Continuous column coordinate (`floor(u)` = tile column). */
  u: number;
  /** Continuous row coordinate (`floor(v)` = tile row). */
  v: number;
  /** Whether `(u, v)` lies on the tile grid. */
  inside: boolean;
  /** Distance along the aim ray to the surface (metres). */
  distance: number;
}

/** The ramp width half under the crosshair. */
export interface EditRampSample {
  kind: "ramp";
  side: "left" | "right";
  distance: number;
}

/** The piece pose the sampler reads. */
export interface EditSurfacePiece {
  buildType: BuildType;
  grid: GridPosition;
  rotation: GridRotation;
}

/**
 * Samples the aim ray on the piece's canonical edit surface. Returns `null`
 * when the ray cannot reach the surface within `maxRange` (parallel to it,
 * pointing away, or too far) — for ramps, when it misses the piece.
 */
export function sampleEditSurface(
  piece: EditSurfacePiece,
  origin: Vec3Like,
  dir: Vec3Like,
  maxRange: number,
): EditSurfaceSample | EditRampSample | null {
  const cs = BUILD_GRID.cellSize;
  const lh = BUILD_GRID.layerHeight;
  const ax = piece.grid.x * cs;
  const ay = piece.grid.y * lh;
  const az = piece.grid.z * cs;

  if (piece.buildType === "ramp") {
    const { ctr, he } = structureAabb("ramp", piece.grid, piece.rotation);
    const t = rayAabbDistance(origin, dir, ctr, he, maxRange);
    if (t === null) return null;
    const alongX = piece.rotation === 0 || piece.rotation === 2;
    const lateral = alongX ? origin.z + dir.z * t : origin.x + dir.x * t;
    const centre = (variant: "half_left" | "half_right") => {
      const c = structureCuboids({ buildType: "ramp", grid: piece.grid, rotation: piece.rotation, editGrid: { kind: "ramp", variant } })[0]!;
      return alongX ? c.center.z : c.center.x;
    };
    const side = Math.abs(lateral - centre("half_left")) <= Math.abs(lateral - centre("half_right")) ? "left" : "right";
    return { kind: "ramp", side, distance: t };
  }

  const size = editGridSize(piece.buildType);
  if (size === null) return null;

  /** Ray parameter where the ray meets `coord(t) = value`, within range. */
  const planeT = (o: number, d: number, value: number): number | null => {
    if (Math.abs(d) < 1e-9) return null;
    const t = (value - o) / d;
    return t > 0 && t <= maxRange ? t : null;
  };

  let u: number;
  let v: number;
  let t: number | null;
  if (piece.buildType === "wall") {
    const alongX = piece.rotation === 0 || piece.rotation === 2;
    const forward = piece.rotation === 0 || piece.rotation === 1;
    // The panel's mid-plane: walls are edge pieces, so the plane is the
    // tile edge the wall stands on (its columns still run along that edge
    // from the tile's centre line).
    const edge = wallEdgeCenter(piece.grid, piece.rotation);
    t = alongX ? planeT(origin.z, dir.z, edge.z) : planeT(origin.x, dir.x, edge.x);
    const toUv = (tt: number) => {
      const along = alongX ? origin.x + dir.x * tt - ax : origin.z + dir.z * tt - az;
      const height = origin.y + dir.y * tt - ay;
      const worldCol = (along + cs / 2) / (cs / 3);
      return [forward ? worldCol : 3 - worldCol, (lh - height) / (lh / 3)] as const;
    };
    [u, v] = t === null ? [NaN, NaN] : toUv(t);
    if (!(u >= 0 && u < size.cols && v >= 0 && v < size.rows)) {
      // The crosshair is on the wall's (whole-cell) selection volume but the
      // panel-plane point is off the panel (e.g. aiming down onto the cell
      // from above): use where the ray enters the volume.
      const { ctr, he } = structureAabb(piece.buildType, piece.grid, piece.rotation);
      const entry = rayAabbDistance(origin, dir, ctr, he, maxRange);
      if (entry !== null) {
        const edge = 1 - 1e-9;
        const [eu, ev] = toUv(entry);
        u = Math.min(size.cols * edge, Math.max(0, eu));
        v = Math.min(size.rows * edge, Math.max(0, ev));
        t = entry;
      } else if (t === null) {
        return null;
      }
    }
  } else {
    // Floor: the slab's mid-plane. Cone: half the pyramid's height.
    const planeY = ay + (piece.buildType === "floor" ? 0.075 : lh / 2);
    t = planeT(origin.y, dir.y, planeY);
    const toUv = (tt: number) => [
      (origin.x + dir.x * tt - ax + cs / 2) / (cs / 2),
      (origin.z + dir.z * tt - az + cs / 2) / (cs / 2),
    ] as const;
    [u, v] = t === null ? [NaN, NaN] : toUv(t);
    if (!(u >= 0 && u < size.cols && v >= 0 && v < size.rows)) {
      // The crosshair is on the piece but its plane point falls outside the
      // footprint, or the ray is level (e.g. a cone seen from the side): use
      // where the ray enters the piece's volume, so every aim that selects
      // the piece hits a tile.
      const { ctr, he } = structureAabb(piece.buildType, piece.grid, piece.rotation);
      const entry = rayAabbDistance(origin, dir, ctr, he, maxRange);
      if (entry !== null) {
        const edge = 1 - 1e-9;
        const [eu, ev] = toUv(entry);
        u = Math.min(size.cols * edge, Math.max(0, eu));
        v = Math.min(size.rows * edge, Math.max(0, ev));
        t = entry;
      } else if (t === null) {
        return null;
      }
    }
  }
  if (t === null) return null;
  const inside = u >= 0 && u < size.cols && v >= 0 && v < size.rows;
  return { kind: "tiles", u, v, inside, distance: t };
}

/** The tile index under an inside sample (`row * cols + col`), else `null`. */
export function sampleTile(sample: EditSurfaceSample, size: EditGridSize): number | null {
  if (!sample.inside) return null;
  const col = Math.min(size.cols - 1, Math.floor(sample.u));
  const row = Math.min(size.rows - 1, Math.floor(sample.v));
  return row * size.cols + col;
}

/**
 * Every tile the straight segment `a → b` (grid coordinates) crosses, in
 * traversal order, clipped to the grid. A supercover walk: when the segment
 * passes exactly through a tile corner, both side-neighbours are included, so
 * no tile the path touches is skipped. Pure; at most `cols + rows + 1` cells.
 */
export function cellsAlongSegment(
  a: { u: number; v: number },
  b: { u: number; v: number },
  size: EditGridSize,
): number[] {
  const { cols, rows } = size;
  // Liang–Barsky clip of the segment to [0, cols] × [0, rows].
  let t0 = 0;
  let t1 = 1;
  const du = b.u - a.u;
  const dv = b.v - a.v;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-du, a.u) || !clip(du, cols - a.u) || !clip(-dv, a.v) || !clip(dv, rows - a.v)) return [];
  const x0 = a.u + du * t0;
  const y0 = a.v + dv * t0;
  const x1 = a.u + du * t1;
  const y1 = a.v + dv * t1;

  const cellOf = (x: number, max: number) => Math.min(max - 1, Math.max(0, Math.floor(x)));
  let cx = cellOf(x0, cols);
  let cy = cellOf(y0, rows);
  const ex = cellOf(x1, cols);
  const ey = cellOf(y1, rows);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? 1 / Math.abs(dx) : Infinity;
  const tDeltaY = stepY !== 0 ? 1 / Math.abs(dy) : Infinity;
  let tMaxX = stepX > 0 ? (cx + 1 - x0) / dx : stepX < 0 ? (x0 - cx) / -dx : Infinity;
  let tMaxY = stepY > 0 ? (cy + 1 - y0) / dy : stepY < 0 ? (y0 - cy) / -dy : Infinity;

  const out: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;
    const index = y * cols + x;
    if (!out.includes(index)) out.push(index);
  };
  push(cx, cy);
  for (let guard = 0; guard < cols + rows + 2 && (cx !== ex || cy !== ey); guard++) {
    const eps = 1e-9;
    if (Math.abs(tMaxX - tMaxY) < eps) {
      // Exactly through a corner: include both side-neighbours (supercover).
      push(cx + stepX, cy);
      push(cx, cy + stepY);
      cx += stepX;
      cy += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    } else if (tMaxX < tMaxY) {
      if (tMaxX > 1 + eps) break;
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      if (tMaxY > 1 + eps) break;
      cy += stepY;
      tMaxY += tDeltaY;
    }
    push(cx, cy);
  }
  return out;
}

/** What a drag does to every tile it crosses. */
export type TileDragMode = "select" | "deselect";

/**
 * The local drag-selection state for one held press on a tile grid.
 *
 * `select` marks a solid tile for removal, `deselect` restores it (the
 * canonical edit tile semantics). The mode is fixed by the first tile the drag
 * reaches: pressing on a solid tile selects, pressing on a removed tile
 * restores — for the whole drag. Tiles are reported once per change; the
 * caller applies them to its local draft mask.
 */
export class TileDragSelection {
  private mode: TileDragMode | null = null;
  private armed = false;
  private last: { u: number; v: number } | null = null;

  /** Whether a press is being held (a drag is in progress). */
  public isDragging(): boolean {
    return this.armed;
  }

  /** The drag's mode once its first tile was reached, else `null`. */
  public getMode(): TileDragMode | null {
    return this.mode;
  }

  /**
   * Starts a drag at `sample` (may be `null` / outside the grid: the drag
   * then begins at the first tile it reaches). Returns the changed tiles.
   */
  public press(sample: EditSurfaceSample | null, size: EditGridSize, tiles: boolean[]): number[] {
    this.armed = true;
    this.mode = null;
    this.last = null;
    return this.move(sample, size, tiles);
  }

  /**
   * Continues the drag to `sample`, applying the drag mode to every tile on
   * the path since the previous sample. `null` samples (ray off the surface)
   * are skipped without breaking the path. Mutates `tiles`; returns the tiles
   * it changed.
   */
  public move(sample: EditSurfaceSample | null, size: EditGridSize, tiles: boolean[]): number[] {
    if (!this.armed || sample === null) return [];
    const from = this.last ?? sample;
    this.last = { u: sample.u, v: sample.v };
    const path = cellsAlongSegment(from, sample, size);
    const changed: number[] = [];
    for (const tile of path) {
      if (this.mode === null) this.mode = tiles[tile] ? "select" : "deselect";
      const solid = this.mode === "deselect";
      if (tiles[tile] !== solid) {
        tiles[tile] = solid;
        changed.push(tile);
      }
    }
    return changed;
  }

  /** Ends the drag (the selection is kept by the caller). */
  public release(): void {
    this.armed = false;
    this.mode = null;
    this.last = null;
  }
}
