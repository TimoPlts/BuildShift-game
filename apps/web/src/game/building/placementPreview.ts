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
 *      → the nearest existing structure face on the ray (edit-aware canonical
 *        geometry), if it is nearer than the player's layer plane:
 *        hit point + face normal → the adjacent slot to build FROM that
 *        surface (shared `resolveSurfacePlacement`: wall above a wall, air
 *        floor beside a floor, floor/ramp past a ramp's high end, …)
 *      → otherwise the build plane of the player's layer (aiming down) or
 *        of the layer above it (aiming up: the "ceiling") → the tile
 *        containing the hit (walls: the aimed tile's edge nearest the aim —
 *        walls follow the crosshair)
 *      → normalize the selected rotation
 *      → validate rotation / build bounds / range / slot occupancy
 *
 * The server performs the final validation and is the only authority on
 * build existence. A "valid" preview here means "probably valid" (green
 * ghost); an "invalid" preview means "locally invalid" (red ghost). Both are
 * presentation state — nothing in this module is authoritative.
 */
import {
  BUILD_GRID,
  BUILD_RANGE,
  buildCellAt,
  raycastStructureSurface,
  resolveSurfacePlacement,
  structureCuboids,
  structureSlots,
  wallEdgeRotation,
  isValidPlacementRotation,
  isWithinPlacementRange,
  isWithinBuildBounds,
  normalizePlacementRotation,
  placementEyePoint,
  placementIsVisible,
  placementIsSupported,
  placementActorsBlockCandidate,
} from "@buildshift/game-config";
import type { PlacementActorPose, StructureCuboid } from "@buildshift/game-config";
import type {
  BuildType,
  GridPosition,
  GridRotation,
  StructureEditState,
} from "@buildshift/protocol";
import { gridToWorldAnchor } from "./gridSnap";
import { isGridAllowedDuringPreparation, type PreparationSide } from "../preparation/preparationContract";

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
  /** The aim ray hits neither an existing structure nor the player's layer build plane ahead of the camera (e.g. aiming up at open sky). */
  | "no_candidate"
  /** The snapped anchor is farther than `BUILD_RANGE.maxPlacementDistance` from the player. */
  | "out_of_range"
  /** The requested rotation is not meaningful for the selected build type. */
  | "invalid_rotation"
  /** Part of the footprint lies outside the shared `BUILD_BOUNDS` build volume. */
  | "out_of_bounds"
  /** The candidate footprint overlaps an existing (authoritative or pending) structure. */
  | "overlap"
  /**
   * The candidate's canonical solids intrude on a player capsule — the local
   * player's own body or the opponent's (shared
   * `placementActorsBlockCandidate`). The server applies the SAME rule with
   * the same `"actor_overlap"` reason, so a piece is never created inside a
   * body and the capsule never has to be shoved out of it.
   */
  | "actor_overlap"
  /**
   * The candidate has no structural load path to the arena build foundation
   * (shared `placementIsSupported`): it touches no grounded piece's real
   * geometry, so it would hang in the air. The server answers with the same
   * `"unsupported"` reason.
   */
  | "unsupported"
  /**
   * Preparation is active and the candidate's anchor grid X is not the
   * local player's assigned prep row (shared `isGridAllowedDuringPreparation`
   * rule — the same check the authoritative server applies with the NEW
   * `preparation_zone` rejection reason, CONTRACT.md §6).
   */
  | "outside_preparation"
  /**
   * The candidate is not visible from the authoritative-equivalent eye
   * (shared `placementIsVisible` segment policy against the canonical
   * edited solids): it sits behind a closed wall/solid. The server applies
   * the SAME shared rule with the same `"occluded"` reason, so the ghost
   * and the authoritative answer agree (occlusion mission edit-system-20261124).
   */
  | "occluded";

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
  /** The authoritative edit state (edited pieces are targeted by their remaining geometry). */
  editGrid?: StructureEditState;
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
  /**
   * The local player's assigned preparation row while the authoritative
   * preparation is active (`""` / `null` / `undefined` = no preparation
   * restriction). Mirrors the server's `preparationSide`-gated placement
   * validation so the ghost previews the rejection the server would give.
   */
  preparationSide?: PreparationSide | "" | null;
  /**
   * Local player crouch state (shared eye constants: standing 1.2 / crouch
   * 0.9 above the feet). The authoritative server always uses its own
   * replicated crouch flag; the preview matches when the caller supplies it.
   * Default `false` (standing eye).
   */
  crouched?: boolean;
  /**
   * Every actor that must stay out of the candidate's volume: the local
   * player AND the known opponents, each at its current feet pose and stance
   * (shared `PlacementActorPose`). The authoritative server independently
   * recomputes this from replicated poses — a preview may only ever be more
   * conservative than the server here, never less.
   */
  actors?: readonly PlacementActorPose[];
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
 * How far along the aim ray (from the camera) existing structure faces are
 * considered as build surfaces. Generous: the shared range rule still
 * decides validity from the player's position.
 */
export const SURFACE_TARGET_DISTANCE = 40;

/** Canonical collision geometry per occupied snapshot (the store caches the array until it mutates). */
const surfaceGeometryCache = new WeakMap<readonly OccupiedStructure[], { buildType: BuildType; grid: GridPosition; rotation: number; cuboids: StructureCuboid[] }[]>();
function surfaceGeometry(occupied: readonly OccupiedStructure[]) {
  let geometry = surfaceGeometryCache.get(occupied);
  if (!geometry) {
    geometry = occupied.map((o) => {
      const input = { buildType: o.buildType, grid: o.grid, rotation: o.rotation ?? 0, editGrid: o.editGrid };
      return { ...input, cuboids: structureCuboids(input) };
    });
    surfaceGeometryCache.set(occupied, geometry);
  }
  return geometry;
}

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
 * slot occupancy → actor occupancy → structural support → line-of-sight) so
 * the same inputs always produce the same `reason`, and it is the exact order
 * the authoritative server applies.
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
    preparationSide = null,
    crouched = false,
    actors,
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
  //    An existing structure face nearer than that plane takes precedence:
  //    the player builds FROM that surface.
  //    Aiming UP (no structure in the way) targets the next layer's base
  //    plane instead — the "ceiling" above the player's layer — so pieces go
  //    on top of / above the current level without aiming at a surface.
  const playerLayer = buildLayerAt(playerPosition.y);
  const dirY = aimDirection.y;
  const up = Number.isFinite(dirY) && dirY > MIN_AIM_DOWNGRADE;
  const layer = up ? playerLayer + 1 : playerLayer;
  const planeY = layer * BUILD_GRID.layerHeight;
  const planeT = Number.isFinite(dirY) && (up || dirY < -MIN_AIM_DOWNGRADE) ? (planeY - aimOrigin.y) / dirY : NaN;
  const planeHit = Number.isFinite(planeT) && planeT >= 0;
  // Down: the layer plane is a real floor, so only structures in front of it
  // count. Up: the ceiling is only open air — any structure the ray meets
  // within building reach of the player is the surface to build from.
  const hit = occupied.length
    ? raycastStructureSurface(aimOrigin, aimDirection, planeHit && !up ? Math.min(planeT, SURFACE_TARGET_DISTANCE) : SURFACE_TARGET_DISTANCE, surfaceGeometry(occupied))
    : null;
  // ── The shared authoritative eye gates what counts as "aimed at" ──
  // The runtime ray origin is the THIRD-PERSON CAMERA, which sits on the
  // shot line a fixed distance BEHIND the eye (`placementEyePoint` — the
  // same point the server's visibility check uses). Camera ray and eye ray
  // are one LINE, but a candidate resolved from a ray parameter measured at
  // the camera can land between camera and eye — spatially BEHIND the
  // player — and read as a forward hit there (the ramp pose that ghosted a
  // wall through the avatar: feet mid-slope, eye above the next layer's
  // base plane, camera below it). A candidate must therefore lie at or in
  // front of the eye: it is rejected only when the eye-to-candidate vector
  // aims backwards along the shot BOTH horizontally and in full projection.
  // The horizontal exemption keeps legitimate steep-aim reticle targets
  // (e.g. a surface OVER THE HEAD while looking steeply down through a ramp
  // opening, where the full projection is vertical-negative) working; a
  // pure vertical aim has horizontal projection 0 and stays accepted.
  const eye = placementEyePoint(playerPosition.x, playerPosition.y, playerPosition.z, crouched);
  const aimedPastTheEye = (p: Vec3Like): boolean => {
    const horizontal = (p.x - eye.x) * aimDirection.x + (p.z - eye.z) * aimDirection.z;
    if (horizontal >= 0) return true;
    return horizontal + (p.y - eye.y) * aimDirection.y >= 0;
  };
  const surface = hit && aimedPastTheEye(hit.point) && (!up || !planeHit || hit.distance <= planeT ||
    Math.hypot(hit.point.x - playerPosition.x, hit.point.y - playerPosition.y, hit.point.z - playerPosition.z) <= BUILD_RANGE.maxPlacementDistance + BUILD_GRID.cellSize)
    ? hit
    : null;

  let grid: GridPosition;
  if (surface) {
    const resolved = resolveSurfacePlacement(surface, buildType, rotation, aimDirection);
    grid = resolved.grid as GridPosition;
    rotation = resolved.rotation as GridRotation;
  } else if (planeHit) {
    const hitX = aimOrigin.x + aimDirection.x * planeT;
    const hitZ = aimOrigin.z + aimDirection.z * planeT;
    // The plane crossing must also lie at or in front of the shared eye
    // (same behind-the-player rejection as surface hits, above).
    if (!aimedPastTheEye({ x: hitX, y: planeY, z: hitZ })) {
      return {
        present: true,
        valid: false,
        reason: "no_candidate",
        grid: null,
        rotation,
        anchorWorld: null,
      };
    }
    // The tile whose canonical geometry contains the hit point.
    grid = buildCellAt(hitX, hitZ, layer) as GridPosition;
    if (buildType === "wall") {
      // Walls are edge pieces and FOLLOW THE CROSSHAIR: the wall stands on
      // the aimed tile's edge nearest the aim point (shared wallEdgeRotation
      // — the same rule surface hits already use via `nearestWall`). The
      // selected quarter turn does not lock a wall's axis: aiming around the
      // tile is the wall-aiming mechanic; R/X rotation carries no meaning
      // for wall plane-placement (surfaces keep their line/stack semantics).
      rotation = wallEdgeRotation(grid, hitX, hitZ) as GridRotation;
    }
  } else {
    return {
      present: true,
      valid: false,
      reason: "no_candidate",
      grid: null,
      rotation,
      anchorWorld: null,
    };
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

  // ── Preparation row: the shared prep-zone rule the server enforces while
  //    preparation is active (anchor grid X must equal the assigned row) ──
  if (preparationSide !== "" && preparationSide !== null
    && !isGridAllowedDuringPreparation(grid, preparationSide)) {
    return {
      present: true,
      valid: false,
      reason: "outside_preparation",
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

  // ── Actor occupancy: the piece must not be created inside a body (the
  //    local player's capsule AND every known opponent's). Canonical solids
  //    only, so a floor under the feet, a roof overhead, a wall beside the
  //    capsule and the hollow under a cone all stay valid. ──
  if (actors !== undefined && actors.length > 0 && placementActorsBlockCandidate({
    candidate,
    actors,
  }).blocked) {
    return {
      present: true,
      valid: false,
      reason: "actor_overlap",
      grid,
      rotation,
      anchorWorld,
    };
  }

  // ── Structural support: the piece must attach to the arena foundation or
  //    to a chain of existing/pending pieces that reaches it (shared rule —
  //    an elevated piece with no real contact goes red exactly where the
  //    server answers `unsupported`). ──
  if (!placementIsSupported({
    candidate: { buildType, grid, rotation },
    structures: surfaceGeometry(occupied),
  }).supported) {
    return {
      present: true,
      valid: false,
      reason: "unsupported",
      grid,
      rotation,
      anchorWorld,
    };
  }

  // ── Line of sight: the SAME shared segment policy the authoritative
  //    server enforces with the same `"occluded"` reason (see game-config
  //    `placementVisibility`). The eye is the canonical shared shot origin
  //    (standing 1.2 / crouch 0.9 above the feet position), NOT the camera
  //    position, and blockers are the exact edit-aware solids (+ pending
  //    intents — the same conservative stance as the `overlap` check), so a
  //    far-side-of-a-closed-wall candidate goes red and a candidate seen
  //    through a real edited hole stays green. ──
  if (!placementIsVisible({
    eye,
    candidate: { buildType, grid, rotation },
    structures: surfaceGeometry(occupied),
  }).visible) {
    return {
      present: true,
      valid: false,
      reason: "occluded",
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
