/**
 * placementPreview — the client's non-authoritative placement-preview
 * calculation (docs/TECHNICAL_ARCHITECTURE.md §23).
 *
 * Given the camera aim ray, the local player position, the selected build
 * type / rotation, and the set of currently-occupied structures, this pure
 * function computes the grid-snapped candidate cell and decides — *locally,
 * as visual feedback only* — whether the placement looks valid:
 *
 *   Camera aim ray
 *      → intersect the ground build plane
 *      → the build plane of the player's layer → the tile containing the hit
 *      → normalize the selected rotation (walls: snap to the aimed edge)
 *      → validate rotation / build bounds / range / slot occupancy
 *
 * The server performs the final validation and is the only authority on
 * build existence. A "valid" preview here means "probably valid" (green
 * ghost); an "invalid" preview means "locally invalid" (red ghost). Both are
 * presentation state — nothing in this module is authoritative.
 */
import {
  BUILD_GRID,
  buildCellAt,
  structureSlots,
  wallEdgeRotation,
  isValidPlacementRotation,
  isWithinPlacementRange,
  isWithinBuildBounds,
  normalizePlacementRotation,
} from "@buildshift/game-config";
import type {
  BuildType,
  GridPosition,
  GridRotation,
} from "@buildshift/protocol";
import { gridToWorldAnchor } from "./gridSnap";

/**
 * The build layer a player standing at feet height `y` builds on: the layer
 * whose base is at or just below the feet (a small tolerance keeps a player
 * standing on a floor slab — 0.15 m above the layer base — on that layer).
 */
export function buildLayerAt(y: number): number {
  return Math.max(0, Math.floor((y + 0.25) / BUILD_GRID.layerHeight));
}

/**
 * Why a placement preview is (locally) invalid. `null` means the preview is
 * valid.
 */
export type PlacementInvalidReason =
  /** The aim ray does not intersect the ground build plane ahead of the camera (e.g. aiming up or along the horizon). */
  | "no_candidate"
  /** The snapped anchor is farther than `BUILD_RANGE.maxPlacementDistance` from the player. */
  | "out_of_range"
  /** The requested rotation is not meaningful for the selected build type. */
  | "invalid_rotation"
  /** Part of the footprint lies outside the shared `BUILD_BOUNDS` build volume. */
  | "out_of_bounds"
  /** The candidate footprint overlaps an existing (authoritative or pending) structure. */
  | "overlap";

/** A plain 3-vector (avoids a Babylon dependency in pure preview math). */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** A structure that occupies grid cells (authoritative or pending). */
export interface OccupiedStructure {
  buildType: BuildType;
  grid: GridPosition;
  /** Placement rotation (a rotated ramp occupies cells along Z); default 0. */
  rotation?: GridRotation;
}

/** Everything the preview calculation needs for one frame. */
export interface PlacementPreviewInput {
  /** World-space aim ray origin (the camera position). */
  aimOrigin: Vec3Like;
  /** Normalized world-space aim direction. */
  aimDirection: Vec3Like;
  /** The local player's world position (feet) for the range check. */
  playerPosition: Vec3Like;
  /** The selected build type. */
  buildType: BuildType;
  /**
   * The player's selected cardinal rotation (0–3). The preview normalizes it
   * for `buildType` with the shared `normalizePlacementRotation` rule, so a
   * rotation selected for a previous piece never invalidates this one.
   */
  rotation: GridRotation;
  /** All structures currently occupying grid cells (authoritative + pending). */
  occupied: readonly OccupiedStructure[];
}

/** The result of one frame's placement-preview calculation. */
export interface PlacementPreview {
  /**
   * Whether a preview is being presented at all. `false` when the player is
   * not in build mode (the runtime keeps the preview hidden); a preview in
   * that state carries no candidate data.
   */
  present: boolean;
  /** Whether the snapped candidate looks valid (visual feedback only). */
  valid: boolean;
  /** The reason the preview is invalid, or `null` when valid. */
  reason: PlacementInvalidReason | null;
  /** The grid cell the structure would anchor to, or `null` without a candidate. */
  grid: GridPosition | null;
  /** The canonical rotation the placement would be requested with. */
  rotation: GridRotation;
  /** The world-space base centre of the anchor cell (for rendering), or `null`. */
  anchorWorld: Vec3Like | null;
}

/**
 * The minimum downward slope of the aim ray (as a fraction of its length in
 * the -Y direction) required to produce a ground-plane candidate. A ray that
 * is horizontal or aimed upward can never intersect the ground build plane
 * in front of the camera.
 */
export const MIN_AIM_DOWNGRADE = 1e-4;

/**
 * The preview shown when the player is not in build mode: no candidate,
 * nothing to validate. Frozen because it is returned by reference.
 */
export const ABSENT_PREVIEW: Readonly<PlacementPreview> = Object.freeze({
  present: false,
  valid: false,
  reason: null,
  grid: null,
  rotation: 0,
  anchorWorld: null,
});

/**
 * Per-frame occupancy test: `true` when `candidate` needs a canonical build
 * slot (shared `structureSlots` rule) that an occupied structure already
 * holds. Different slots of one tile — a ramp, its four edge walls, a floor —
 * never conflict; only the same slot does.
 */
function candidateOverlapsOccupied(
  candidate: OccupiedStructure,
  occupied: readonly OccupiedStructure[],
): boolean {
  const candidateSlots = structureSlots(candidate.buildType, candidate.grid, candidate.rotation ?? 0);
  for (const other of occupied) {
    for (const slot of structureSlots(other.buildType, other.grid, other.rotation ?? 0)) {
      if (candidateSlots.includes(slot)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Computes the grid-snapped placement preview for one frame.
 *
 * Pure function: reads the shared `BUILD_GRID` / `BUILD_RANGE` values and the
 * structure footprints, never mutates its inputs, never touches the network.
 * The validation order is fixed (candidate → rotation → bounds → range →
 * occupancy)
 * so the same inputs always produce the same `reason`.
 */
export function computePlacementPreview(
  input: PlacementPreviewInput,
): PlacementPreview {
  const {
    aimOrigin,
    aimDirection,
    playerPosition,
    buildType,
    occupied,
  } = input;
  // Canonical rotation for this piece (shared with the server): rotatable
  // kinds keep the selected quarter turn, rotation-invariant kinds use 0.
  // (Walls instead snap to the aimed tile edge, below.)
  let rotation = normalizePlacementRotation(buildType, input.rotation) as GridRotation;

  // ── Candidate: intersect the aim ray with the build plane of the layer the
  //    player stands on (the base of that layer: ground, or the top of a
  //    ramp / the floor the player is on), so floors at the top of a ramp
  //    and floors in the air are targetable. The ray hits the plane at
  //    t = (planeY − origin.y) / dir.y, positive when it points down enough.
  const layer = buildLayerAt(playerPosition.y);
  const planeY = layer * BUILD_GRID.layerHeight;
  const dirY = aimDirection.y;
  if (!Number.isFinite(dirY) || dirY >= -MIN_AIM_DOWNGRADE) {
    return {
      present: true,
      valid: false,
      reason: "no_candidate",
      grid: null,
      rotation,
      anchorWorld: null,
    };
  }

  const t = (planeY - aimOrigin.y) / dirY;
  if (!Number.isFinite(t) || t < 0) {
    return {
      present: true,
      valid: false,
      reason: "no_candidate",
      grid: null,
      rotation,
      anchorWorld: null,
    };
  }

  const hitX = aimOrigin.x + aimDirection.x * t;
  const hitZ = aimOrigin.z + aimDirection.z * t;
  // The tile whose canonical geometry contains the hit point.
  const grid = buildCellAt(hitX, hitZ, layer) as GridPosition;
  if (buildType === "wall") {
    // Walls are edge pieces: snap to the aimed tile's nearest edge.
    rotation = wallEdgeRotation(grid, hitX, hitZ) as GridRotation;
  }
  const anchorWorld = gridToWorldAnchor(grid);

  // ── Rotation validity: the shared canonical rule the server enforces ──
  if (!isValidPlacementRotation(buildType, rotation)) {
    return {
      present: true,
      valid: false,
      reason: "invalid_rotation",
      grid,
      rotation,
      anchorWorld,
    };
  }

  // ── Build bounds: the shared build volume the server enforces ──
  if (!isWithinBuildBounds(buildType, grid, rotation)) {
    return {
      present: true,
      valid: false,
      reason: "out_of_bounds",
      grid,
      rotation,
      anchorWorld,
    };
  }

  // ── Range: the shared full-3D rule the server enforces ──
  if (!isWithinPlacementRange(playerPosition, grid)) {
    return {
      present: true,
      valid: false,
      reason: "out_of_range",
      grid,
      rotation,
      anchorWorld,
    };
  }

  // ── Occupancy: the candidate footprint must be free ──
  const candidate = { buildType, grid, rotation };
  if (candidateOverlapsOccupied(candidate, occupied)) {
    return {
        present: true,
      valid: false,
      reason: "overlap",
      grid,
      rotation,
      anchorWorld,
    };
  }

  return {
    present: true,
    valid: true,
    reason: null,
    grid,
    rotation,
    anchorWorld,
  };
}
