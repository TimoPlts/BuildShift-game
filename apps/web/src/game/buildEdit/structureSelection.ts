/**
 * structureSelection — presentation-only aim-ray selection of an owned,
 * editable structure.
 *
 * Given the camera aim ray (origin + normalized direction), a maximum range,
 * and the authoritative {@link BuildingState} mirror, this pure function
 * resolves the aim ray against the *canonical solid geometry* of every
 * replicated structure (the shared `structureCuboids` /
 * `rayStructureIntersection` maths from `@buildshift/game-config` — the same
 * volumes movement, hitscan and the renderer use, including the piece's
 * server-accepted `editGrid`) and applies the documented targeting rule:
 *
 * **Targeting rule (nearest real surface wins).** The aim ray's nearest
 * *actual solid surface* among ALL replicated structures (own or not) is the
 * picked structure. That structure is returned as the edit target only when
 * it is owned by the local player and eligible; otherwise nothing is
 * selected. Consequences (each pinned by a regression test):
 *
 *  - A cone can never "steal" a selection through air: its coarse AABB
 *    covers the corners around the pyramid's slopes, but a ray that only
 *    traverses that air resolves no cone surface, so a floor underside or a
 *    wall behind the cone stays selectable while the cone remains
 *    selectable wherever its real roof surface is under the crosshair.
 *  - No zero-distance phantoms: distance 0 is reported only when the eye
 *    actually lies inside a solid volume, never merely inside a bounding
 *    box (standing in the air beneath/around a roof no longer self-targets
 *    the cone).
 *  - No editing through blockers: the first real surface is an enemy (or
 *    otherwise ineligible) piece → no target. Ray-trough-opening still
 *    works, because a removed edit tile supplies no volume and the ray
 *    passes through the actual opening (matching hitscan).
 *  - Exact-distance ties (coplanar surfaces, e.g. a same-cell floor and a
 *    cone's full-footprint lowest level, whose bottom faces coincide) are
 *    broken deterministically toward the NON-cone piece: candidates are
 *    fed to the shared raycast in a stable order (every non-cone first,
 *    then cones), and the raycast keeps the earliest nearest hit — so the
 *    visible piece wins regardless of the mirror's key order. A cone's
 *    lowest level is only ever a hidden sub-volume inside such stacks.
 *
 * Distance is measured from the camera eye origin (the shared aim-ray
 * origin, kept identical to the server shot-line's eye) to the hit surface
 * along the ray, within the shared edit range.
 *
 * Contract C1 (edit-system-20261124): this is the ONE place the edit
 * surface decision is made, and it consumes the shared exact-solid
 * `raycastStructureSurface` (all owners) with ownership/eligibility derived
 * AFTER the hit — never as a pre-filter. `structureBounds`/AABB survives
 * only as loose presentation culling here.
 *
 * Authority contract: this module only *reads* the replicated building state
 * and returns which structure the crosshair points at. It never mutates the
 * mirror, never decides edit validity, and never talks to the network — it is
 * the presentation half of "select an owned wall". The server remains the
 * sole authority on whether an edit is actually applied.
 */
import {
  raycastStructureSurface,
  structureBounds,
  type GeometryEditState,
  type StructureGeometryInput,
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
   * Applied to the structure the exact raycast hit FIRST: an ineligible
   * first surface selects nothing (it is never skipped through — that is
   * what "nearest real surface wins" means). Defaults to "always eligible".
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
 * World AABB centre + half-extents of a structure's canonical geometry
 * (shared `structureBounds`): a wall is bounded on its tile edge, a ramp by
 * its one tile. Writes into the module-level scratch vectors and returns them
 * — consume synchronously (shared by per-structure selection and per-frame
 * tile hit-testing).
 */
export function structureAabb(
  buildType: StructureState["buildType"],
  grid: StructureState["grid"],
  rotation: StructureState["rotation"],
): { ctr: Vec3Like; he: Vec3Like } {
  const { min, max } = structureBounds({ buildType, grid, rotation });
  _aabbCtr.x = (min[0] + max[0]) / 2;
  _aabbCtr.y = (min[1] + max[1]) / 2;
  _aabbCtr.z = (min[2] + max[2]) / 2;
  _aabbHe.x = (max[0] - min[0]) / 2;
  _aabbHe.y = (max[1] - min[1]) / 2;
  _aabbHe.z = (max[2] - min[2]) / 2;
  return { ctr: _aabbCtr, he: _aabbHe };
}

/**
 * Slab-method ray / AABB intersection. Returns the distance to the box's
 * near face when the ray enters it within `[0, maxRange]`, else `null`.
 *
 * Only used as the cheap broad-phase reject (and by `editDragSelection`'
 * surface fallbacks); the actual pick resolves against the canonical solid
 * cuboids so bounding-box air never selects a piece.
 */
export function rayAabbDistance(
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
 * Resolves the aim ray with the shared edit-aware exact-solid raycast
 * ({@link raycastStructureSurface} over the canonical `structureCuboids` of
 * EVERY replicated structure — the same volumes movement, hitscan and the
 * renderer use, honouring each piece's server-accepted `editGrid`) and
 * returns the {@link TargetedStructure} for the first real surface — but
 * only when that surface belongs to an owned, eligible piece (see the
 * module-level targeting rule). Returns `null` when nothing is hit, the
 * first surface belongs to another player / is ineligible, or the hit is
 * beyond `maxRange`.
 *
 * Pure: reads the authoritative mirror, never mutates it.
 */
export function selectTargetStructure(
  input: StructureSelectionInput,
): TargetedStructure | null {
  const { aimOrigin, aimDirection, maxRange, building, ownerId } = input;
  const isEligible = input.isEligible ?? (() => true);

  // Candidates for the one shared raycast, in the documented tie order:
  // every non-cone first, then cones (a coplanar tie enters identical
  // slab maths, so strict `distance <` keeps the earlier, visible piece).
  const candidates: { structure: StructureState; geometry: StructureGeometryInput }[] = [];
  for (const conePass of [false, true] as const) {
    // `for..in` over the plain record avoids the per-frame `Object.values`
    // array allocation (the state record is always a plain object literal).
    for (const key in building.structures) {
      const structure = building.structures[key];
      if ((structure.buildType === "cone") !== conePass) continue;

      // Loose culling ONLY (presentation, per contract C1): the unedited
      // bounds are a superset of the (never-growing) edited volumes, so a
      // ray missing this AABB cannot hit a solid. The pick itself is made
      // exclusively on the exact cuboids below.
      const { ctr, he } = structureAabb(
        structure.buildType,
        structure.grid,
        structure.rotation,
      );
      if (rayAabbDistance(aimOrigin, aimDirection, ctr, he, maxRange) === null) {
        continue;
      }
      candidates.push({
        structure,
        geometry: {
          buildType: structure.buildType,
          grid: structure.grid,
          rotation: structure.rotation,
          // Removed edit tiles supply no volume → real air, exactly as to
          // hitscan and movement.
          editGrid: structure.editGrid as GeometryEditState | undefined,
        },
      });
    }
  }

  const hit = raycastStructureSurface(
    aimOrigin,
    aimDirection,
    maxRange,
    candidates.map((candidate) => candidate.geometry),
  );
  if (hit === null) return null;
  const picked = candidates[hit.index]!;
  const structure = picked.structure;

  // Ownership / eligibility derive from the hit — never filtered before it.
  if (structure.ownerId !== ownerId) return null; // first surface is someone else's — no edit through it
  if (!isEligible(structure)) return null;

  return {
    structureId: structure.structureId,
    buildType: structure.buildType,
    grid: structure.grid,
    rotation: structure.rotation,
    ownerId: structure.ownerId,
    distance: hit.distance,
  };
}
