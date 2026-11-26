/**
 * placementOccupancy — the SHARED actor-occupancy policy for placement.
 *
 * A piece may not be created INSIDE a player's body. Until now the only
 * "overlap" gate was canonical build-slot occupancy (two pieces cannot share a
 * slot), so a wall could be placed straight through the placing player's own
 * capsule — and the movement resolver then had to depenetrate/eject the
 * capsule out of the freshly created solid (the visible "place a wall on
 * myself, get shoved across the tile" bug). Rejection happens BEFORE any
 * Energy spend, structure write, physics write or broadcast.
 *
 * The test is exact, not a cell/AABB approximation:
 *  - the actor is the canonical movement CAPSULE (shared `PLAYER_COLLIDER` /
 *    `PLAYER_CROUCH_COLLIDER`), built from the authoritative feet pose,
 *    stance and radius/height — standing, crouched or mid-jump alike;
 *  - the candidate's volume is its canonical collision geometry
 *    (`structureCuboids`), so a floor is a 0.15 m slab, a cone is a thin roof
 *    shell with real air inside, a ramp is thin step slabs, and an edited-out
 *    tile is real air. Sharing a build CELL with a player is therefore NOT
 *    overlap: a floor under the feet, a roof above the head, a wall beside
 *    the capsule and the hollow under a cone all pass, while solid geometry
 *    that actually intrudes on the capsule is refused.
 *  - the exact capsule↔cuboid clearance is computed (the minimum distance
 *    between the capsule's core segment and the box, minus the radius — which
 *    decomposes exactly for a vertical segment against an axis-aligned box);
 *    only a genuine intrusion deeper than {@link PLACEMENT_OCCUPANCY}
 *    .contactSlack rejects, so flush contact and the controller's own contact
 *    offset never reject.
 *  - a solid whose top surface is at or below `feet + stepUpTolerance` is a
 *    walkable PLATE the actor simply stands on (the same 0.34 m auto-step
 *    window the shared movement resolver lands on), so building the floor you
 *    are standing on is legal instead of a self-rejection.
 *
 * EVERY actor in the authoritative room is checked, not just the placer: the
 * opponent's capsule counts identically, so neither player can vault a piece
 * into the other's body. Both sides run the SAME function — the server from
 * replicated poses, the client preview from its local prediction plus the
 * interpolated opponent — so the ghost and the authoritative answer agree.
 */
import {
  PLAYER_COLLIDER,
  PLAYER_COLLIDER_TOTAL_HEIGHT,
  PLAYER_CROUCH_COLLIDER,
  PLAYER_CROUCH_COLLIDER_TOTAL_HEIGHT,
} from "./character.js";
import { structureCuboids, type StructureCuboid, type StructureGeometryInput } from "./editGeometry.js";

/** Actor-occupancy tolerances, in metres. */
export const PLACEMENT_OCCUPANCY = {
  /**
   * How deep a solid must intrude past the capsule surface to reject. Equal
   * to `PLAYER_CHARACTER_CONTROLLER.contactOffset`: the character
   * controller deliberately parks capsules this far off a face, so a pose
   * already in legitimate contact never reads as "inside" the new piece.
   */
  contactSlack: 0.02,
  /**
   * A solid whose top surface is at or below `feet + this` is a walkable
   * plate, not body obstruction. Equal to the auto step-up window of the
   * shared movement resolver (`resolveStructureMovement` lands the capsule on
   * any top within 0.34 m below its previous feet), which is exactly the
   * geometry the actor is meant to stand on.
   */
  stepUpTolerance: 0.34,
} as const;

/** An authoritative actor pose: FEET position plus stance (the replicated
 *  convention — the same pose the shared eye and the movement resolver use). */
export interface PlacementActorPose {
  x: number;
  y: number;
  z: number;
  /** The authoritative crouch flag (selects the crouched capsule height). */
  crouched: boolean;
}

/** The canonical capsule derived from a pose. */
export interface PlacementActorCapsule {
  x: number;
  z: number;
  feetY: number;
  headY: number;
  radius: number;
  /** Lower end of the core segment (feet + radius). */
  segmentFrom: number;
  /** Upper end of the core segment (head − radius). */
  segmentTo: number;
}

/** The movement capsule of one pose: standing 1.8 m, crouched 1.2 m total,
 *  radius 0.35 m in both stances (shared collider constants). */
export function placementActorCapsule(pose: PlacementActorPose): PlacementActorCapsule {
  const radius = pose.crouched ? PLAYER_CROUCH_COLLIDER.radius : PLAYER_COLLIDER.radius;
  const height = pose.crouched ? PLAYER_CROUCH_COLLIDER_TOTAL_HEIGHT : PLAYER_COLLIDER_TOTAL_HEIGHT;
  const feetY = pose.y;
  return {
    x: pose.x,
    z: pose.z,
    feetY,
    headY: feetY + height,
    radius,
    segmentFrom: feetY + radius,
    segmentTo: feetY + height - radius,
  };
}

/**
 * SIGNED clearance (metres) between a capsule and a cuboid: `> 0` clear,
 * `0` flush contact, `< 0` penetration depth. Exact — the capsule is the core
 * segment ⊕ a sphere, both the segment and the box are axis-aligned products,
 * so the closest-point distance splits into the horizontal point↔rectangle
 * distance and the vertical segment↔interval gap.
 */
export function capsuleSolidGapMeters(capsule: PlacementActorCapsule, solid: StructureCuboid): number {
  const dx = Math.max(solid.center.x - solid.halfExtents.x - capsule.x, 0, capsule.x - (solid.center.x + solid.halfExtents.x));
  const dz = Math.max(solid.center.z - solid.halfExtents.z - capsule.z, 0, capsule.z - (solid.center.z + solid.halfExtents.z));
  const dy = Math.max(
    solid.center.y - solid.halfExtents.y - capsule.segmentTo,
    0,
    capsule.segmentFrom - (solid.center.y + solid.halfExtents.y),
  );
  return Math.hypot(dx, dz, dy) - capsule.radius;
}

/** Everything the occupancy test needs for one candidate. */
export interface PlacementOccupancyInput {
  /** The would-be piece (canonical solids; an unedited piece by definition). */
  candidate: Partial<StructureGeometryInput> & { cuboids?: readonly StructureCuboid[] };
  /** Every actor to keep out of the piece (the placer AND the opponents). */
  actors: readonly PlacementActorPose[];
}

/** The verdict for one candidate. */
export interface PlacementOccupancyResult {
  blocked: boolean;
  /** `"actor_overlap"` when some actor's capsule penetrates the candidate. */
  reason: null | "actor_overlap";
  /** Index of the first blocking actor in {@link PlacementOccupancyInput.actors}. */
  actorIndex: number;
  /** Worst penetration depth found (metres, positive), for diagnostics. */
  depth: number;
}

/** Whether one capsule is penetrated by any of a piece's solids. */
export function capsuleBlockageDepth(capsule: PlacementActorCapsule, solids: readonly StructureCuboid[]): number {
  let depth = 0;
  for (const solid of solids) {
    // Walkable plate: its top is at/above nothing the body is above — the
    // actor just stands on it (see PLACEMENT_OCCUPANCY.stepUpTolerance).
    if (solid.center.y + solid.halfExtents.y <= capsule.feetY + PLACEMENT_OCCUPANCY.stepUpTolerance) continue;
    const penetration = -capsuleSolidGapMeters(capsule, solid);
    if (penetration > PLACEMENT_OCCUPANCY.contactSlack && penetration > depth) depth = penetration;
  }
  return depth;
}

/**
 * The occupancy verdict for one candidate (see the module doc). Pure and
 * deterministic: the first actor whose capsule is penetrated blocks, and the
 * reported depth is the deepest intrusion across that actor's solids.
 */
export function placementActorsBlockCandidate(input: PlacementOccupancyInput): PlacementOccupancyResult {
  const solids = input.candidate.cuboids ?? structureCuboids(input.candidate as StructureGeometryInput);
  if (solids.length === 0) return { blocked: false, reason: null, actorIndex: -1, depth: 0 };
  for (let index = 0; index < input.actors.length; index++) {
    const depth = capsuleBlockageDepth(placementActorCapsule(input.actors[index]!), solids);
    if (depth > 0) return { blocked: true, reason: "actor_overlap", actorIndex: index, depth };
  }
  return { blocked: false, reason: null, actorIndex: -1, depth: 0 };
}
