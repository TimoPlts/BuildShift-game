/**
 * placementSupport — the SHARED structural-support (anchoring) policy.
 *
 * A newly placed piece must connect, through REAL structural contacts, to the
 * arena build foundation or to an existing chain of pieces that itself
 * reaches that foundation. This is what stops a wall/floor/ramp/cone from
 * appearing "randomly in the air": slot occupancy, range and line of sight
 * are all satisfied by a disconnected airborne island, so a piece with no
 * load path to the ground was previously accepted (and left floating).
 *
 * The policy is geometry-only and is applied by BOTH sides from the same
 * code: the authoritative server recomputes it for every placement request
 * from its own replicated structures (a client claim is never consulted —
 * nothing here reads a client-supplied support flag or serialised geometry),
 * and the client preview applies the identical rule so the ghost goes red
 * with the same `"unsupported"` reason the server answers with.
 *
 * ── Acceptance contact convention (explicit, per the mission brief) ──
 * Two pieces ATTACH when some solid of one and some solid of the other are in
 * a real surface contact:
 *   • the solids' closest distance is at most
 *     {@link PLACEMENT_SUPPORT}.contactTolerance — i.e. on every axis their
 *     intervals overlap or are separated by no more than that tolerance, so
 *     touching, flush, and a genuine interpenetration of the canonical
 *     slot-coexistence kind (walls are edge pieces standing inside a floor's
 *     slab layer) all count; AND
 *   • the contact has real BEARING EXTENT: on at least one axis the shared
 *     interval is at least {@link PLACEMENT_SUPPORT}.minContactSpan wide — a
 *     face, or a continuous contact line (one ramp tread meeting the next
 *     tile's tread along its full 5.12 m width). Knife-edge corner lines (two
 *     coplanar panels meeting end-to-end across a layer, perpendicular panels
 *     grazing at a patch) have no bearing area, carry nothing, and are not a
 *     contact.
 * A piece is GROUNDED when one of its solids RESTS on the arena build
 * foundation: same face convention against the foundation slab's solid, whose
 * top surface is the canonical ground plane (`VERTICAL_MOVEMENT.groundY`).
 * Support is then the transitive closure: a piece is supported when it is
 * grounded, or when it attaches to at least one already-supported piece.
 *
 * What that deliberately means:
 *  - an existing neighbour CELL is not enough — the solids must touch;
 *  - a self-supporting / cyclic cluster is not enough — the search starts
 *    only at the pieces that rest on the foundation, so an island whose
 *    pieces all touch each other but nothing grounded stays unsupported;
 *  - decorative arena props are not a foundation: only the colliders of
 *    ARENA_COLLIDERS whose top surface is exactly the ground plane (the
 *    `foundation-ground` slab) root a chain;
 *  - FULL base support is NOT required: one valid edge/face contact with a
 *    grounded piece is enough, which is what keeps legitimate wall stacking,
 *    ramp chains, floors bridging off a connected structure and cone-on-floor
 *    working;
 *  - rotated and EDITED geometry is honoured: an edited-out tile contributes
 *    no solid (see `structureCuboids`), so support can never be claimed
 *    through an actual hole, and a rotated ramp/wall attaches where its
 *    rotated solids actually are.
 *
 * Scope: this is a policy on INITIAL PLACEMENT only. Structures are never
 * deleted by collapse, and destroying or editing a supporting piece does not
 * cascade — see `MEMORY.md` for the documented lifecycle decision.
 */
import { ARENA_COLLIDERS } from "./arena.js";
import { VERTICAL_MOVEMENT } from "./movement.js";
import { structureCuboids, type StructureCuboid, type StructureGeometryInput } from "./editGeometry.js";

/** Support-contact tolerances, in metres. */
export const PLACEMENT_SUPPORT = {
  /**
   * Maximum interval separation that still counts as a contact. Equal to
   * `PLACEMENT_VISIBILITY.blockerSkin`: the same float/skin class the
   * occlusion gate uses, so "touching" means the same distance on both
   * gates, and lattice-exact contacts (ramp step to ramp step, wall base on
   * floor top) pass without depending on float luck.
   */
  contactTolerance: 0.06,
  /**
   * Minimum width, in metres, of the shared interval on at least ONE axis of
   * a contact — the contact must have real bearing extent.
   *
   * Derivation (not a tuned magic number): the canonical solids all live on
   * one lattice, which leaves exactly two kinds of touch. DESIGNED load paths
   * are wide: the narrowest one is a half-ramp's tread, `cellSize/4` = 1.28 m.
   * ACCIDENTAL corner lines are narrow: two coplanar panels meeting end-to-end
   * across a layer touch along the panel's full thickness, 0.768 m, and
   * perpendicular panels graze at a 0.384 m patch. A threshold between those
   * two populations (0.768 < 1.0 ≤ 1.28) accepts every real load path and
   * refuses knife-edge corners, which have no bearing area and carry nothing.
   */
  minContactSpan: 1.0,
} as const;

/** A candidate plus the existing pieces it may attach to (canonical inputs —
 *  precomputed `cuboids` are honoured). */
export interface PlacementSupportInput {
  /** The would-be piece (unedited by definition), or explicit solids. */
  candidate: Partial<StructureGeometryInput> & { cuboids?: readonly StructureCuboid[] };
  /** Every existing structure, carrying `editGrid` so edited-out tiles are
   *  real openings and supply neither volume nor support. */
  structures: readonly (StructureGeometryInput & { cuboids?: readonly StructureCuboid[] })[];
  /** Override of the foundation solids (tests); default
   *  {@link ARENA_FOUNDATION_SUPPORTS}. */
  foundation?: readonly StructureCuboid[];
}

/** The verdict for one candidate. */
export interface PlacementSupportResult {
  supported: boolean;
  /** `"unsupported"` when the piece has no load path to the foundation. */
  reason: null | "unsupported";
  /** How many existing pieces are currently reachable from the foundation
   *  (diagnostics: an island that is merely internally connected is not). */
  groundedStructures: number;
}

/** The arena build foundation: the collider(s) of the shared arena table whose
 *  top surface IS the canonical ground plane. Arena walls / ceilings / props
 *  (tops above the ground plane) are excluded by construction, so a chain can
 *  never be rooted on decorative arena geometry. */
export const ARENA_FOUNDATION_SUPPORTS: readonly StructureCuboid[] = ARENA_COLLIDERS
  .filter((c) => Math.abs(c.position[1] + c.halfExtents[1] - VERTICAL_MOVEMENT.groundY) <= 1e-6)
  .map((c) => ({
    center: { x: c.position[0], y: c.position[1], z: c.position[2] },
    halfExtents: { x: c.halfExtents[0], y: c.halfExtents[1], z: c.halfExtents[2] },
  }));

/** Shared-interval width of two solids on one axis (negative = separated). */
function spanOn(axis: "x" | "y" | "z", a: StructureCuboid, b: StructureCuboid): number {
  const ca = a.center[axis], ha = a.halfExtents[axis];
  const cb = b.center[axis], hb = b.halfExtents[axis];
  return Math.min(ca + ha, cb + hb) - Math.max(ca - ha, cb - hb);
}

/** Whether two solids are in a real surface contact (see the module doc's
 *  convention: within `tolerance` on every axis, with real extent somewhere). */
export function solidsAttach(
  a: StructureCuboid,
  b: StructureCuboid,
  tolerance: number = PLACEMENT_SUPPORT.contactTolerance,
  minSpan: number = PLACEMENT_SUPPORT.minContactSpan,
): boolean {
  let extent = false;
  for (const axis of ["x", "y", "z"] as const) {
    const span = spanOn(axis, a, b);
    if (span < -tolerance) return false; // separated by more than a contact
    if (span >= minSpan) extent = true;
  }
  return extent;
}

/** Whether a solid rests on the arena foundation (its top face is the ground
 *  plane, over the foundation footprint). */
export function solidRestsOnFoundation(
  solid: StructureCuboid,
  foundation: readonly StructureCuboid[] = ARENA_FOUNDATION_SUPPORTS,
): boolean {
  for (const slab of foundation) if (solidsAttach(solid, slab)) return true;
  return false;
}

/** Merged AABB of a solid group (broad phase only: it can never ADD a
 *  contact, only rule a group pair out cheaply). */
function groupBounds(solids: readonly StructureCuboid[]): { min: [number, number, number]; max: [number, number, number] } | null {
  if (solids.length === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const s of solids) {
    for (let i = 0; i < 3; i++) {
      const axis = (["x", "y", "z"] as const)[i]!;
      min[i] = Math.min(min[i]!, s.center[axis] - s.halfExtents[axis]);
      max[i] = Math.max(max[i]!, s.center[axis] + s.halfExtents[axis]);
    }
  }
  return { min, max };
}

function boundsAttach(
  a: { min: [number, number, number]; max: [number, number, number] },
  b: { min: [number, number, number]; max: [number, number, number] },
  tol: number,
): boolean {
  for (let i = 0; i < 3; i++) if (Math.min(a.max[i]!, b.max[i]!) - Math.max(a.min[i]!, b.min[i]!) < -tol) return false;
  return true;
}

/** Whether any solid of group A attaches to any solid of group B. */
function groupsAttach(a: readonly StructureCuboid[], b: readonly StructureCuboid[]): boolean {
  const tol = PLACEMENT_SUPPORT.contactTolerance;
  const ba = groupBounds(a), bb = groupBounds(b);
  if (!ba || !bb || !boundsAttach(ba, bb, tol)) return false;
  for (const sa of a) for (const sb of b) if (solidsAttach(sa, sb)) return true;
  return false;
}

/** A group is GROUNDED when one of its solids rests on the foundation. */
function groupGrounded(solids: readonly StructureCuboid[], foundation: readonly StructureCuboid[]): boolean {
  for (const s of solids) if (solidRestsOnFoundation(s, foundation)) return true;
  return false;
}

/**
 * The support verdict for one candidate (see the module doc). Breadth-first
 * from the foundation-resting pieces outward, so support always has a real
 * path to the ground and a cycle of mutually-touching airborne pieces can
 * never bootstrap itself.
 */
export function placementIsSupported(input: PlacementSupportInput): PlacementSupportResult {
  const foundation = input.foundation ?? ARENA_FOUNDATION_SUPPORTS;
  const groups: readonly (readonly StructureCuboid[])[] = input.structures.map(
    (s) => s.cuboids ?? structureCuboids(s as StructureGeometryInput),
  );
  const grounded = new Array<boolean>(groups.length).fill(false);
  const queue: number[] = [];
  for (let i = 0; i < groups.length; i++) {
    if (groupGrounded(groups[i]!, foundation)) {
      grounded[i] = true;
      queue.push(i);
    }
  }
  // Simple worklist relaxation: a piece becomes grounded as soon as it
  // attaches to one that already is. Terminates (each index flips once).
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++]!;
    for (let j = 0; j < groups.length; j++) {
      if (grounded[j] || groups[j]!.length === 0) continue;
      if (groupsAttach(groups[i]!, groups[j]!)) {
        grounded[j] = true;
        queue.push(j);
      }
    }
  }
  const candidate = input.candidate.cuboids ?? structureCuboids(input.candidate as StructureGeometryInput);
  if (groupGrounded(candidate, foundation)) {
    return { supported: true, reason: null, groundedStructures: queue.length };
  }
  for (let j = 0; j < groups.length; j++) {
    if (!grounded[j]) continue;
    if (groupsAttach(candidate, groups[j]!)) {
      return { supported: true, reason: null, groundedStructures: queue.length };
    }
  }
  // An empty candidate solid list (an unknown kind, or a piece edited to
  // nothing) has no load path either — it is not "trivially supported".
  return { supported: false, reason: "unsupported", groundedStructures: queue.length };
}
