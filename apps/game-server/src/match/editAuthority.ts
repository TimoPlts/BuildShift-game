import {
  BUILD_GRID,
  BUILD_RANGE,
  CONE_PEAK_HEIGHT,
  placementIsVisible,
  structureCuboids,
  type GeometryEditState,
  type PlacementVisibilityVec,
  type StructureCuboid,
  type StructureGeometryInput,
} from "@buildshift/game-config";

/**
 * Server-authoritative EDIT-intent visibility (occlusion lane, authority
 * repair). A placement gate alone is not enough: a forged client could send
 * `EDIT_GRID_ACTION_INPUT` for a far-away structure or edit a face it can
 * geometrically not see — punching holes through solid panels "from behind".
 * The room's `hega` handler already enforces ownership and tile bounds; this
 * module adds the two missing authority dimensions, both measured ONLY from
 * server state:
 *
 *  • CANONICAL EDIT REACH — the shared {@link BUILD_RANGE}.maxPlacementDistance
 *    (10.24 m, the same edit range the client targeting lane documents),
 *    measured from the authoritative EYE to the nearest point of the edit
 *    TARGET region. The client measures camera-eye → hit surface along the
 *    ray; a straight-line eye → region minimum is never longer, so a tile
 *    the client could legitimately target can never be range-rejected here.
 *
 *  • EXACT GEOMETRY LINE OF SIGHT — the target region is the CANONICAL tile
 *    box of the addressed tile (wall 3×3 column/row split of the panel with
 *    the mirrored-column and top-row conventions of the client's
 *    `editDragSelection`; floor/cone 2×2 footprint quadrant over the solid's
 *    height; whole-piece actions and ramps address the canonical piece
 *    volume). The probe boxes float 0.10–0.26 m OUTSIDE that region's real
 *    faces — the actual target surfaces — and pass the SAME shared
 *    {@link placementIsVisible} policy as placement: canonical
 *    `structureCuboids` solids (real edited holes), shared eye constants,
 *    no client-provided eye or visibility claim, near-face margin intact.
 *    If every face of the tile is behind solid material from this player's
 *    eye, the edit is `occluded` and the mutation never happens.
 *
 * Legitimate edits survive by construction: a near-face edit probes its own
 * exposed face (visible), an edit through a real door/window/roof gap sees
 * the tile THROUGH the hole, and an under-cone / on-cone edit sees the cone
 * surfaces from below/above — all standard {@link placementIsVisible}
 * verdicts, identical math to the placement gate and the client ghost.
 */

/** Canonical tile-grid dimensions per tile-edited build type. */
function tileGrid(buildType: string): { cols: number; rows: number } | null {
  if (buildType === "wall") return { cols: 3, rows: 3 };
  if (buildType === "floor" || buildType === "cone") return { cols: 2, rows: 2 };
  return null;
}

interface AxisRange {
  /** axis key: 0=x, 1=y, 2=z */
  lo: number;
  hi: number;
}

function box(ax: AxisRange, ay: AxisRange, az: AxisRange): StructureCuboid {
  return {
    center: { x: (ax.lo + ax.hi) / 2, y: (ay.lo + ay.hi) / 2, z: (az.lo + az.hi) / 2 },
    halfExtents: { x: (ax.hi - ax.lo) / 2, y: (ay.hi - ay.lo) / 2, z: (az.hi - az.lo) / 2 },
  };
}

/**
 * The canonical region the addressed tile OCCUPIES (through the piece's
 * full thickness/height) — the same tile → world mapping as the client's
 * `editDragSelection` sampling (`tileIndex = row * cols + col`; wall columns
 * run along the edge mirrored for rotations 1/3, row 0 is the TOP row;
 * floor/cone column = world-X half, row = world-Z half). Whole-piece
 * actions (`tileIndex === null`) address the canonical unedited piece.
 */
export function editTargetRegion(target: StructureGeometryInput, tileIndex: number | null): StructureCuboid[] {
  const cs = BUILD_GRID.cellSize;
  const lh = BUILD_GRID.layerHeight;
  const ax = target.grid.x * cs;
  const ay = target.grid.y * lh;
  const az = target.grid.z * cs;
  const raw = structureCuboids({ ...target, editGrid: undefined });
  if (tileIndex === null || tileGrid(target.buildType) === null || target.buildType === "ramp") {
    return raw; // whole-piece / ramp: the canonical piece volume
  }
  const size = tileGrid(target.buildType)!;
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= size.cols * size.rows) return raw;
  const col = tileIndex % size.cols;
  const row = Math.floor(tileIndex / size.cols);
  if (target.buildType === "wall") {
    const panel = raw[0]!;
    const alongX = target.rotation === 0 || target.rotation === 2;
    const forward = target.rotation === 0 || target.rotation === 1;
    // Column segment along the edge (client: worldCol=(along+cs/2)/(cs/3),
    // u = forward ? worldCol : 3 - worldCol).
    const colEdge = (k: number) => (forward ? (k / 3 - 0.5) * cs : (3 - k / 3 - 0.5) * cs);
    const alongLoRaw = colEdge(col);
    const alongHiRaw = colEdge(col + 1);
    const along = alongX ? "x" : "z";
    const centre = along === "x" ? ax : az;
    const lo = Math.min(alongLoRaw, alongHiRaw) + centre;
    const hi = Math.max(alongLoRaw, alongHiRaw) + centre;
    // Row segment over the layer height (client: v = (lh - height)/(lh/3), row 0 top).
    const yR = { lo: ay + lh - (row + 1) * (lh / 3), hi: ay + lh - row * (lh / 3) };
    // Tile extent along the edge; the panel's own thickness across it.
    if (alongX) return [box({ lo, hi }, yR, { lo: panel.center.z - panel.halfExtents.z, hi: panel.center.z + panel.halfExtents.z })];
    return [box({ lo: panel.center.x - panel.halfExtents.x, hi: panel.center.x + panel.halfExtents.x }, yR, { lo, hi })];
  }
  // Floor / cone: footprint quadrant over the solid's full height.
  const yTop = target.buildType === "cone" ? ay + CONE_PEAK_HEIGHT : raw.reduce((m, c) => Math.max(m, c.center.y + c.halfExtents.y), ay);
  const yBottom = raw.reduce((m, c) => Math.min(m, c.center.y - c.halfExtents.y), ay + lh);
  return [box(
    { lo: ax - cs / 2 + col * (cs / 2), hi: ax - cs / 2 + (col + 1) * (cs / 2) },
    { lo: yBottom, hi: yTop },
    { lo: az - cs / 2 + row * (cs / 2), hi: az - cs / 2 + (row + 1) * (cs / 2) },
  )];
}

/** The probe boxes: one floated just outside each face of a region box. */
function faceProbes(region: StructureCuboid): StructureCuboid[] {
  const probes: StructureCuboid[] = [];
  const GAP = 0.10; // first metres off the face are air the probe floats in
  const THICK = 0.16; // survives the policy's blockerSkin on both sides
  const SHRINK = 0.10; // keep probes inside the face's own footprint
  const c = region.center;
  const h = region.halfExtents;
  const axes: ["x" | "y" | "z"][] = [["x"], ["y"], ["z"]];
  for (const [axis] of axes) {
    const hv = axis === "x" ? h.x : axis === "y" ? h.y : h.z;
    const cv = axis === "x" ? c.x : axis === "y" ? c.y : c.z;
    for (const sign of [-1, 1]) {
      const face = cv + sign * hv;
      const centre = face + sign * (GAP + THICK / 2);
      const mk = (lo: number, hi: number) => ({ lo, hi });
      const dims = {
        x: axis === "x" ? mk(centre - THICK / 2, centre + THICK / 2) : mk(c.x - Math.max(0, h.x - SHRINK), c.x + Math.max(0, h.x - SHRINK)),
        y: axis === "y" ? mk(centre - THICK / 2, centre + THICK / 2) : mk(c.y - Math.max(0, h.y - SHRINK), c.y + Math.max(0, h.y - SHRINK)),
        z: axis === "z" ? mk(centre - THICK / 2, centre + THICK / 2) : mk(c.z - Math.max(0, h.z - SHRINK), c.z + Math.max(0, h.z - SHRINK)),
      };
      probes.push(box(dims.x, dims.y, dims.z));
    }
  }
  return probes;
}

export interface EditAuthorityInput {
  /** Authoritative eye (from `placementEyePoint(feet…, crouch)`) — never a client value. */
  eye: PlacementVisibilityVec;
  /** The target structure's CURRENT canonical geometry (edited state included). */
  target: StructureGeometryInput;
  /** Addressed tile (`select`/`deselect`), or `null` for whole-piece actions. */
  tileIndex: number | null;
  /** ALL replicated structures (including the target) with real edit holes. */
  structures: readonly (StructureGeometryInput & { cuboids?: readonly StructureCuboid[] })[];
  /** Shared edit range override (tests); defaults to BUILD_RANGE.maxPlacementDistance. */
  maxDistance?: number;
}

export type EditAuthorityRejection = "out_of_range" | "occluded";

/**
 * `null` when the edit intent is authoritative-visible (in canonical edit
 * reach AND at least one real face of the addressed tile is visible from the
 * player's eye through actual edited geometry); otherwise the rejection
 * reason the room sends back. Performs no mutation, spends no Energy,
 * broadcasts nothing — the caller refuses BEFORE applying anything.
 */
export function editAuthorityVerdict(input: EditAuthorityInput): EditAuthorityRejection | null {
  const region = editTargetRegion(input.target, input.tileIndex);
  if (region.length === 0) return "occluded"; // a target with no solids cannot be faced
  const max = input.maxDistance ?? BUILD_RANGE.maxPlacementDistance;
  let inRange = false;
  for (const r of region) {
    const dx = Math.max(Math.abs(input.eye.x - r.center.x) - r.halfExtents.x, 0);
    const dy = Math.max(Math.abs(input.eye.y - r.center.y) - r.halfExtents.y, 0);
    const dz = Math.max(Math.abs(input.eye.z - r.center.z) - r.halfExtents.z, 0);
    if (Math.hypot(dx, dy, dz) <= max + 1e-9) { inRange = true; break; }
  }
  if (!inRange) return "out_of_range";
  const probes: StructureCuboid[] = [];
  for (const r of region) probes.push(...faceProbes(r));
  if (placementIsVisible({ eye: input.eye, candidate: { cuboids: probes }, structures: input.structures }).visible) return null;
  return "occluded";
}

/** Re-exported so the room maps schema structures the same way as placement. */
export type EditGeometrySource = { buildType: string; grid: { x: number; y: number; z: number }; rotation: number; editKind?: string; editTiles?: unknown; editRampVariant?: string };

export function editGeometryInput(s: EditGeometrySource, editGrid: GeometryEditState | undefined): StructureGeometryInput {
  return {
    buildType: s.buildType as StructureGeometryInput["buildType"],
    grid: { x: s.grid.x, y: s.grid.y, z: s.grid.z },
    rotation: s.rotation,
    editGrid,
  };
}
