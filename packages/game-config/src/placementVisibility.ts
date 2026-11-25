/**
 * placementVisibility — the SHARED placement line-of-sight / obstruction
 * policy (occlusion mission edit-system-20261124).
 *
 * A build candidate is *visible* iff a straight segment from the
 * authoritative player eye to at least one interior sample point of the
 * candidate's canonical solids pierces the INTERIOR of no existing solid.
 * The authoritative server validates every placement request with this rule
 * (a forged in-range packet for a far-side-of-a-closed-wall slot is
 * rejected — no Energy is spent, no structure is created, nothing is
 * broadcast), and the client placement preview applies the exact same rule
 * so the ghost agrees with the server's answer.
 *
 * Canonical geometry only (see `editGeometry.ts`): blockers are the exact
 * edit-aware cuboids of every structure (`structureCuboids` — wall-edit
 * holes, floor/cone quadrant edits, ramp step slabs) plus the shared arena
 * shell. A full AABB is NEVER a blocker: air above a cone's slope and air
 * inside an edited doorway are real air.
 *
 * Touching is not occluding (attached / adjacent placement stays legal):
 *  - blockers are skin-shrunk by {@link PLACEMENT_VISIBILITY}.blockerSkin,
 *    so coplanar or edge-grazing contact (a wall stacked on its support, a
 *    floor resting on it, a wall standing on a ramp's edge) is never a hit;
 *  - candidate sample points are inset from the candidate's own faces by
 *    {@link PLACEMENT_VISIBILITY}.sampleInset (≤ skin), so a supporting
 *    structure's face coplanar with the candidate's face cannot block it;
 *  - a hit counts only when the segment END lies at least
 *    {@link PLACEMENT_VISIBILITY}.pierceMargin beyond the entry point, so a
 *    real panel (wall half-thickness `cellSize × 0.075` = 0.384 m, which
 *    exceeds skin + margin + inset) is always a blocker while any graze is
 *    not. A candidate on the FAR side of a closed wall therefore has no
 *    visible sample, while a candidate through a real edited door / window /
 *    roof gap does.
 *  - STACKING is support, not occlusion: a blocker lying entirely below a
 *    touching candidate (piece on piece, any layer gap) or a thin walkable
 *    PLATE flush with the candidate's level is exempt (stackRelated). Side
 *    contact with a full-height blocker is NOT — a floor behind a wall is
 *    still hidden by it.
 *
 * The eye is authoritative: {@link placementEyePoint} uses the SHARED shot
 * origin (`shotOrigin.ts`, standing 1.2 / crouch 0.9 above the replicated
 * pose y — the centred-reticle / server shot-line parity point). A
 * client-proposed eye height or visibility boolean is never consulted.
 */
import { shotEyeHeight } from "./shotOrigin.js";
import { ARENA_COLLIDERS } from "./arena.js";
import { structureCuboids, type StructureCuboid, type StructureGeometryInput } from "./editGeometry.js";

/** A plain world-space vector (engine-free, like the rest of this package). */
export interface PlacementVisibilityVec {
  x: number;
  y: number;
  z: number;
}

/**
 * The occlusion tolerances, in metres. See the module doc for why they are
 * consistent: `sampleInset ≤ blockerSkin` and a wall panel's half-thickness
 * (0.384) exceeds `blockerSkin + pierceMargin + sampleInset`, so grazes can
 * never block while any genuine through-panel pierce always does.
 */
export const PLACEMENT_VISIBILITY = {
  /** Sample points sit this far INSIDE the candidate's own faces. */
  sampleInset: 0.05,
  /** Blocker solids are shrunk by this skin before the pierce test. */
  blockerSkin: 0.06,
  /** How deep past a blocker's entry face the segment must end to count. */
  pierceMargin: 0.12,
  /** Raw-height cap for a blocker to be a walkable PLATE (floor slab /
   *  ramp step / cone level ≤ 0.15 m actual). Plates are exempt ONLY where
   *  the candidate's raw solid genuinely PENETRATES them (canonical slot
   *  coexistence) — never for mere flush/face contact, so an opaque floor
   *  or roof skin between eye and candidate stays a blocker. Full-height
   *  walls (3.84 m) are never plates. */
  plateMaxHeight: 0.2,
} as const;

/**
 * The authoritative placement eye for a player pose — the SAME canonical
 * shot origin as the shot line (`shotEyeHeight` above the replicated pose
 * y). Server validation and the client preview must both build their eye
 * with this function so their visibility verdicts agree.
 */
export function placementEyePoint(x: number, y: number, z: number, crouched: boolean): PlacementVisibilityVec {
  return { x, y: y + shotEyeHeight(crouched), z };
}

/** The static arena shell as occlusion blockers (shared collider table). */
export const ARENA_VISIBILITY_BLOCKERS: readonly StructureCuboid[] = ARENA_COLLIDERS.map((c) => ({
  center: { x: c.position[0], y: c.position[1], z: c.position[2] },
  halfExtents: { x: c.halfExtents[0], y: c.halfExtents[1], z: c.halfExtents[2] },
}));

/** Everything `placementIsVisible` needs for one candidate. */
export interface PlacementVisibilityInput {
  /** The authoritative eye (from {@link placementEyePoint}). */
  eye: PlacementVisibilityVec;
  /** The would-be piece (canonical footprint; unedited by definition) or an
   *  explicit solid set (`cuboids`) — the edit-LOS gate reuses this policy to
   *  probe canonical TARGET regions that are not themselves placeable pieces. */
  candidate: Partial<StructureGeometryInput> & { cuboids?: readonly StructureCuboid[] };
  /**
   * ALL existing structures as canonical geometry inputs (carry `editGrid`
   * so edited holes are real holes). Precomputed `cuboids` are honoured.
   * Ownership is irrelevant here — solids of any owner obstruct.
   */
  structures: readonly (StructureGeometryInput & { cuboids?: readonly StructureCuboid[] })[];
  /** Additional static solids (the arena shell — see {@link ARENA_VISIBILITY_BLOCKERS}). */
  staticBlockers?: readonly StructureCuboid[];
}

/** The verdict for one candidate. */
export interface PlacementVisibilityResult {
  visible: boolean;
  /** `"occluded"` when not visible, else `null`. */
  reason: null | "occluded";
  /**
   * The first confirmed occluding hit (entry point along the probe of one
   * candidate sample) for diagnostics, or `null` when visible.
   */
  blocker: { distance: number; point: PlacementVisibilityVec } | null;
}

/** A blocker solid after the skin shrink (collapsed boxes are dropped). The
 *  RAW half-extents (rx/ry/rz) are kept for the support-touch exemption. */
interface SkinnedBox {
  cx: number; cy: number; cz: number;
  hx: number; hy: number; hz: number;
  rx: number; ry: number; rz: number;
}

function skinned(cuboid: StructureCuboid, out: SkinnedBox[]): void {
  const hx = cuboid.halfExtents.x - PLACEMENT_VISIBILITY.blockerSkin;
  const hy = cuboid.halfExtents.y - PLACEMENT_VISIBILITY.blockerSkin;
  const hz = cuboid.halfExtents.z - PLACEMENT_VISIBILITY.blockerSkin;
  if (hx <= 0 || hy <= 0 || hz <= 0) return; // too thin to be a blocker once skinned
  out.push({ cx: cuboid.center.x, cy: cuboid.center.y, cz: cuboid.center.z, hx, hy, hz, rx: cuboid.halfExtents.x, ry: cuboid.halfExtents.y, rz: cuboid.halfExtents.z });
}

/**
 * Support / stacking contact. A blocker is IRRELEVANT to a candidate when
 * they share plan area (touch or overlap within `tol` in x AND z) and
 * either:
 *  • the blocker lies entirely BELOW the candidate's bottom face — the
 *    candidate is the same column built higher (floor on wall top, wall on
 *    wall, floors/cones stacked across layers); or
 *  • the candidate's raw solid actually PENETRAITES a THIN PLATE (floor
 *    slab, ramp step, cone level) — canonical slot coexistence (an edge
 *    wall standing in its roof slab's layer), the only geometry where a
 *    walkable plate legitimately shares a candidate's volume.
 * A candidate merely pressed side-first into a FULL-HEIGHT blocker, or a
 * candidate merely FLUSH / face-touching a plate WITHOUT solid penetration,
 * gets no exemption: opaque plates block sight wherever they truly stand
 * between the eye and the target.
 */
function stackRelated(cand: StructureCuboid, support: StructureCuboid, tol: number, plateMaxHeight: number): boolean {
  if (Math.abs(cand.center.x - support.center.x) > cand.halfExtents.x + support.halfExtents.x + tol) return false;
  if (Math.abs(cand.center.z - support.center.z) > cand.halfExtents.z + support.halfExtents.z + tol) return false;
  const candBottom = cand.center.y - cand.halfExtents.y;
  const supportTop = support.center.y + support.halfExtents.y;
  if (supportTop <= candBottom + tol) return true; // same column built higher
  const supportBottom = support.center.y - support.halfExtents.y;
  if (supportTop - supportBottom > plateMaxHeight) return false; // not a plate
  // PENETRATION (strict positive overlap on all axes), not flush contact:
  // QA counterexample rule — a plate merely touching a candidate's face or
  // sharing its bottom plane without sharing volume remains a blocker.
  const candTop = cand.center.y + cand.halfExtents.y;
  return supportTop > candBottom + 1e-9 && candTop > supportBottom + 1e-9
    && Math.abs(cand.center.x - support.center.x) < cand.halfExtents.x + support.halfExtents.x
    && Math.abs(cand.center.z - support.center.z) < cand.halfExtents.z + support.halfExtents.z;
}

/**
 * The interior probe points of a candidate's canonical solids: the skinned
 * corners of each cuboid (outermost — most likely visible) plus its centre.
 * Exported so tests (and any later consumer) can reason about the exact
 * geometry the policy probes; the corner points collapse to the centre when
 * a cuboid is thinner than twice the inset.
 */
export function placementVisibilitySamples(
  candidate: Partial<StructureGeometryInput> & { cuboids?: readonly StructureCuboid[] },
  inset: number = PLACEMENT_VISIBILITY.sampleInset,
): PlacementVisibilityVec[] {
  const points: PlacementVisibilityVec[] = [];
  if (candidate.cuboids) {
    for (const cuboid of candidate.cuboids) {
      pushCuboidSamples(cuboid, inset, points);
    }
    return points;
  }
  for (const cuboid of structureCuboids(candidate as StructureGeometryInput)) {
    pushCuboidSamples(cuboid, inset, points);
  }
  return points;
}

function pushCuboidSamples(cuboid: StructureCuboid, inset: number, points: PlacementVisibilityVec[]): void {
    const hx = Math.max(0, cuboid.halfExtents.x - inset);
    const hy = Math.max(0, cuboid.halfExtents.y - inset);
    const hz = Math.max(0, cuboid.halfExtents.z - inset);
    for (const sx of hx > 0 ? [-1, 1] : [0]) {
      for (const sy of hy > 0 ? [-1, 1] : [0]) {
        for (const sz of hz > 0 ? [-1, 1] : [0]) {
          points.push({
            x: cuboid.center.x + sx * hx,
            y: cuboid.center.y + sy * hy,
            z: cuboid.center.z + sz * hz,
          });
        }
      }
    }
    points.push({ x: cuboid.center.x, y: cuboid.center.y, z: cuboid.center.z });
}

/** Slab-method entry/exit metres of a UNIT direction ray into a box (−1 = miss). */
function slabSpan(eye: PlacementVisibilityVec, box: SkinnedBox, ux: number, uy: number, uz: number, maxT: number): [number, number] | null {
  let entry = 0;
  let exit = maxT;
  const axes: ["x", "y", "z"] = ["x", "y", "z"];
  for (const axis of axes) {
    const u = axis === "x" ? ux : axis === "y" ? uy : uz;
    const e = axis === "x" ? eye.x : axis === "y" ? eye.y : eye.z;
    const c = axis === "x" ? box.cx : axis === "y" ? box.cy : box.cz;
    const h = axis === "x" ? box.hx : axis === "y" ? box.hy : box.hz;
    const low = c - h;
    const high = c + h;
    if (Math.abs(u) < 1e-12) {
      if (e < low || e > high) return null; // parallel outside the slab
    } else {
      let a = (low - e) / u;
      let b = (high - e) / u;
      if (a > b) { const tmp = a; a = b; b = tmp; } // negative axis directions enter through the high face
      if (a > entry) entry = a;
      exit = Math.min(exit, b);
      if (entry > exit) return null;
    }
  }
  return entry <= exit ? [entry, exit] : null;
}

/**
 * The shared occlusion verdict for one placement candidate (see the module
 * doc for the policy). Geometrically justified multi-point probes — NOT a
 * generic centre-only ray — so a near-face placement touching its support
 * stays valid while every sample behind a closed panel is rejected.
 */
export function placementIsVisible(input: PlacementVisibilityInput): PlacementVisibilityResult {
  const { eye, structures } = input;
  const blockers: SkinnedBox[] = [];
  const blockerSolids: StructureCuboid[] = [];
  const collect = (cuboid: StructureCuboid): void => {
    const before = blockers.length;
    skinned(cuboid, blockers);
    if (blockers.length > before) blockerSolids.push(cuboid);
  };
  for (const structure of structures) {
    for (const cuboid of structure.cuboids ?? structureCuboids(structure)) collect(cuboid);
  }
  for (const cuboid of input.staticBlockers ?? ARENA_VISIBILITY_BLOCKERS) collect(cuboid);

  // Support / stacking exemption (see stackRelated).
  const candidateSolids = input.candidate.cuboids ?? structureCuboids(input.candidate as StructureGeometryInput);
  const supporting = new Set<SkinnedBox>();
  for (let i = 0; i < blockers.length; i++) {
    for (const cand of candidateSolids) {
      if (stackRelated(cand, blockerSolids[i]!, PLACEMENT_VISIBILITY.blockerSkin, PLACEMENT_VISIBILITY.plateMaxHeight)) {
        supporting.add(blockers[i]!);
        break;
      }
    }
  }

  let blocker: PlacementVisibilityResult["blocker"] = null;
  for (const point of placementVisibilitySamples(input.candidate)) {
    const dx = point.x - eye.x;
    const dy = point.y - eye.y;
    const dz = point.z - eye.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-9) continue; // sample at the eye: trivially visible
    const ux = dx / length, uy = dy / length, uz = dz / length;
    let occluded = false;
    for (const box of blockers) {
      if (supporting.has(box)) continue; // the candidate's own support surface
      const span = slabSpan(eye, box, ux, uy, uz, length);
      if (span === null) continue;
      const [entry, exit] = span;
      if (entry < 0) continue; // eye inside this skinned solid — never locks every placement
      if (exit <= entry) continue; // graze / coplanar touch: never an occluder
      if (entry > length - PLACEMENT_VISIBILITY.pierceMargin) continue; // ends at the touched face
      occluded = true;
      if (blocker === null) blocker = { distance: entry, point: { x: eye.x + ux * entry, y: eye.y + uy * entry, z: eye.z + uz * entry } };
      break;
    }
    if (!occluded) return { visible: true, reason: null, blocker: null };
  }
  return { visible: false, reason: "occluded", blocker };
}
