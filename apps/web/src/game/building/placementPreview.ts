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
 *      → snap to the logical build grid
 *      → normalize the selected rotation for the build type
 *      → validate rotation / build bounds / range / occupancy
 *
 * The server performs the final validation and is the only authority on
 * build existence. A "valid" preview here means "probably valid" (green
 * ghost); an "invalid" preview means "locally invalid" (red ghost). Both are
 * presentation state — nothing in this module is authoritative.
 */
import {
  BUILD_RANGE,
  isValidPlacementRotation,
  isWithinBuildBounds,
  normalizePlacementRotation,
  structureFootprintCells,
} from "@buildshift/game-config";
import type {
  BuildType,
  GridPosition,
  GridRotation,
} from "@buildshift/protocol";
import { worldToGridPosition, gridToWorldAnchor } from "./gridSnap";

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
 * Per-frame occupancy test: `true` when `candidate`'s footprint shares at
 * least one grid cell with any occupied structure.
 *
 * Semantically identical to
 * `occupied.some((other) => footprintsOverlap(candidate, other))` — cells
 * are compared by exact (x, y, z) equality, which `gridKey` encodes
 * injectively — but without the per-structure `Set` / key-string churn:
 * the candidate's cells are enumerated once, then every occupied
 * structure's cells are compared numerically.
 */
function candidateOverlapsOccupied(
  candidate: OccupiedStructure,
  occupied: readonly OccupiedStructure[],
): boolean {
  const candidateCells = structureFootprintCells(candidate.buildType, candidate.grid, candidate.rotation ?? 0);
  for (const other of occupied) {
    const otherCells = structureFootprintCells(other.buildType, other.grid, other.rotation ?? 0);
    for (const cell of otherCells) {
      for (const candidateCell of candidateCells) {
        if (
          candidateCell.x === cell.x &&
          candidateCell.y === cell.y &&
          candidateCell.z === cell.z
        ) {
          return true;
        }
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
  const rotation = normalizePlacementRotation(buildType, input.rotation) as GridRotation;

  // ── Candidate: intersect the aim ray with the ground build plane ──
  // The ground build plane is the X/Z plane at y = groundY (the base of the
  // ground layer). A ray hits it at t = (groundY - origin.y) / dir.y, which
  // is positive exactly when the ray points downward enough.
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

  const t = (-aimOrigin.y) / dirY; // groundY is 0 by the shared config
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
  const grid = worldToGridPosition(hitX, 0, hitZ);
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

  // ── Range: horizontal distance from the player to the anchor cell ──
  const dx = anchorWorld.x - playerPosition.x;
  const dz = anchorWorld.z - playerPosition.z;
  if (
    Math.hypot(dx, dz) > BUILD_RANGE.maxPlacementDistance
  ) {
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
