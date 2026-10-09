/**
 * structureSelection — presentation-only aim-ray selection of an owned,
 * editable structure.
 *
 * Given the camera aim ray (origin + normalized direction), a maximum range,
 * and the authoritative {@link BuildingState} mirror, this pure function finds
 * the nearest structure the ray intersects that is (a) owned by the local
 * player and (b) eligible for at least one build edit.
 *
 * Authority contract: this module only *reads* the replicated building state
 * and returns which structure the crosshair points at. It never mutates the
 * mirror, never decides edit validity, and never talks to the network — it is
 * the presentation half of "select an owned wall". The server remains the
 * sole authority on whether an edit is actually applied.
 *
 * The geometry (grid → footprint → rotation → world AABB) mirrors the
 * authoritative server's collider maths (`wc` in `state/buildingState.ts`)
 * so the client's selectable volume and the server's physical volume agree.
 */
import {
  BUILD_GRID,
  getStructureConfig,
} from "@buildshift/game-config";
import type {
  BuildingState,
  StructureState,
} from "@buildshift/protocol";

/** A plain 3-vector (avoids a Babylon dependency in pure selection math). */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** The structure the aim ray currently selects (presentation data only). */
export interface TargetedStructure {
  structureId: string;
  buildType: StructureState["buildType"];
  grid: StructureState["grid"];
  rotation: StructureState["rotation"];
  ownerId: string;
  /** Distance from the aim origin to the structure's near face (metres). */
  distance: number;
}

/** Everything the selection calculation needs for one frame. */
export interface StructureSelectionInput {
  /** World-space aim ray origin (the camera position). */
  aimOrigin: Vec3Like;
  /** Normalized world-space aim direction. */
  aimDirection: Vec3Like;
  /** Maximum selection range in metres. */
  maxRange: number;
  /** The authoritative building state mirror (server truth only). */
  building: BuildingState;
  /** Only structures owned by this player are selectable. */
  ownerId: string;
  /**
   * Optional eligibility predicate (e.g. "supports at least one edit").
   * Ineligible structures are skipped so aiming past them reaches the next
   * candidate. Defaults to "always eligible".
   */
  isEligible?: (structure: StructureState) => boolean;
}

/** Treat a near-zero component as an axis-parallel miss (no intersection). */
const EPS = 1e-8;

/**
 * Reusable AABB scratch vectors. `structureAabb` is called per structure per
 * frame (edit mode); the results are consumed synchronously by
 * `rayAabbDistance` and never retained, so two module-level objects replace
 * two allocations per structure per frame.
 */
const _aabbCtr: Vec3Like = { x: 0, y: 0, z: 0 };
const _aabbHe: Vec3Like = { x: 0, y: 0, z: 0 };

/**
 * World AABB centre + half-extents for a structure, mirroring the server's
 * `wc` (grid anchor + footprint, rotation swaps X/Z extents, then scaled by
 * the shared cell size / layer height). Writes into the module-level scratch
 * vectors and returns them.
 */
function structureAabb(
  buildType: StructureState["buildType"],
  grid: StructureState["grid"],
  rotation: StructureState["rotation"],
): { ctr: Vec3Like; he: Vec3Like } {
  const footprint = getStructureConfig(buildType)?.footprint ?? [1, 1, 1];
  const w = footprint[0];
  const h = footprint[1];
  const d = footprint[2];
  const rotated = rotation === 1 || rotation === 3;
  const xs = rotated ? d : w;
  const zs = rotated ? w : d;
  const cs = BUILD_GRID.cellSize;
  const lh = BUILD_GRID.layerHeight;
  _aabbCtr.x = ((grid.x * 2 + xs - 1) / 2) * cs;
  _aabbCtr.y = grid.y * lh + (h * lh) / 2;
  _aabbCtr.z = ((grid.z * 2 + zs - 1) / 2) * cs;
  _aabbHe.x = (xs * cs) / 2;
  _aabbHe.y = (h * lh) / 2;
  _aabbHe.z = (zs * cs) / 2;
  return { ctr: _aabbCtr, he: _aabbHe };
}

/**
 * Slab-method ray / AABB intersection. Returns the distance to the box's
 * near face when the ray enters it within `[0, maxRange]`, else `null`.
 */
function rayAabbDistance(
  origin: Vec3Like,
  dir: Vec3Like,
  ctr: Vec3Like,
  he: Vec3Like,
  maxRange: number,
): number | null {
  let tmin = 0;
  let tmax = maxRange;
  for (const axis of ["x", "y", "z"] as const) {
    const o = origin[axis];
    const d = dir[axis];
    const mn = ctr[axis] - he[axis];
    const mx = ctr[axis] + he[axis];
    if (Math.abs(d) < EPS) {
      // Ray is parallel to this axis: it only intersects if the origin's
      // coordinate already lies within the slab.
      if (o < mn || o > mx) return null;
      continue;
    }
    let t1 = (mn - o) / d;
    let t2 = (mx - o) / d;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin;
}

/**
 * Selects the nearest eligible, player-owned structure whose AABB the aim
 * ray intersects within `maxRange`.
 *
 * Pure: reads the authoritative mirror, never mutates it, returns `null` when
 * nothing is targeted (no owned structure in range on the aim ray).
 */
export function selectTargetStructure(
  input: StructureSelectionInput,
): TargetedStructure | null {
  const { aimOrigin, aimDirection, maxRange, building, ownerId } = input;
  const isEligible = input.isEligible ?? (() => true);

  let best: TargetedStructure | null = null;
  let bestDistance = Infinity;

  // `for..in` over the plain record avoids the per-frame `Object.values`
  // array allocation (the state record is always a plain object literal).
  for (const key in building.structures) {
    const structure = building.structures[key];
    if (structure.ownerId !== ownerId) continue;
    if (!isEligible(structure)) continue;

    const { ctr, he } = structureAabb(
      structure.buildType,
      structure.grid,
      structure.rotation,
    );
    const distance = rayAabbDistance(aimOrigin, aimDirection, ctr, he, maxRange);
    if (distance === null) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = {
        structureId: structure.structureId,
        buildType: structure.buildType,
        grid: structure.grid,
        rotation: structure.rotation,
        ownerId: structure.ownerId,
        distance,
      };
    }
  }

  return best;
}
