import { BUILD_GRID, getStructureConfig } from "./building.js";

/** Engine-independent world-space solid volume. Babylon, Rapier and hitscan
 * consume these same boxes; an absent box is an actual opening. */
export interface StructureCuboid {
  center: { x: number; y: number; z: number };
  halfExtents: { x: number; y: number; z: number };
}

export type GeometryEditState =
  | { kind: "wall"; tiles: readonly boolean[] }
  | { kind: "floor_cone"; tiles: readonly boolean[] }
  | { kind: "ramp"; variant: "full" | "flipped" | "half_left" | "half_right" | "turn_left" | "turn_right" };

export interface StructureGeometryInput {
  buildType: "wall" | "floor" | "cone" | "ramp";
  grid: { x: number; y: number; z: number };
  rotation: number;
  editGrid?: GeometryEditState;
}

/** Steps in a canonical ramp: 16 × 0.24 m rises (within the 0.34 m step-up)
 * over ONE build tile (5.12 m, 0.32 m per step), climbing exactly one build
 * layer. */
export const RAMP_STEPS = 16;

/** Thickness of each canonical ramp step slab: a thin walking surface, open
 * underneath (never a solid column down to the ground). Slightly more than
 * one step rise, so consecutive slabs overlap and the surface has no gaps. */
export const RAMP_SLAB_THICKNESS = 0.3;

/**
 * The world-space centre of a wall's edge plane: walls are edge pieces. A
 * wall anchored at tile `grid` with rotation `r` stands on that tile's edge
 * r0 = −Z, r1 = +X, r2 = +Z, r3 = −X (the same edge two neighbouring tiles
 * share — see `structureSlots`).
 */
export function wallEdgeCenter(grid: { x: number; y: number; z: number }, rotation: number): { x: number; z: number } {
  const cs = BUILD_GRID.cellSize;
  const r = ((rotation % 4) + 4) % 4;
  const dx = r === 1 ? 0.5 : r === 3 ? -0.5 : 0;
  const dz = r === 0 ? -0.5 : r === 2 ? 0.5 : 0;
  return { x: (grid.x + dx) * cs, z: (grid.z + dz) * cs };
}

/** Stacked levels in a canonical cone: a 16-level stepped ROOF SHELL rising to
 * {@link CONE_PEAK_HEIGHT}, each level equally tall and narrower toward the
 * apex. */
export const CONE_LEVELS = 16;

/**
 * The canonical cone (roof pyramid) peak height above its layer base, in
 * metres — a ROOF piece, not a full-layer tower.
 *
 * Derivation (documented, not an arbitrary shrink):
 *  - the roof run is the half-cell from the base edge to the apex axis:
 *    `cellSize / 2` = 2.56 m;
 *  - the pitch is the classic residential 3:4 rise:run (a "9:12 pitch",
 *    ≈ 36.9°) — the steepest pitch that still reads as a roof rather than a
 *    spike;
 *  - peak = 2.56 × 3/4 = **1.92 m**, exactly half the 3.84 m layer height,
 *    so a cone reads as half a wall next to one, and stacking a cone on a
 *    wall caps the cell without dominating it;
 *  - with {@link CONE_LEVELS} = 16 levels the per-level rise is 1.92/16 =
 *    **0.12 m**, well under the 0.34 m auto step-up, so the roof stays
 *    walkable from every side.
 *
 * Visual mesh, edit preview, hitscan and movement colliders all derive from
 * this one constant (via {@link structureCuboids}, which emits the thin roof
 * SHELL described there — not a filled pyramid).
 */
export const CONE_PEAK_HEIGHT: number = (BUILD_GRID.cellSize / 2) * 0.75;

/** Per-level rise of the canonical cone (metres): 1.92/16 = 0.12 m. */
export const CONE_RISE = CONE_PEAK_HEIGHT / CONE_LEVELS;

/**
 * Vertical thickness of the canonical cone ROOF SHELL, in metres — exactly
 * TWO level rises (2 × 0.12 = 0.24 m, the same slab class as
 * {@link RAMP_SLAB_THICKNESS}).
 *
 * The cone is a ROOF, not a solid ziggurat: every level is a thin skirt
 * band around the pyramid surface and everything under the surface is real
 * air. The thickness is deliberately ≥ {@link CONE_RISE} so consecutive
 * bands overlap vertically — the shell is watertight (no ray leaks through
 * the step creases) while never filling the roof interior. Headroom is then
 * the honest consequence of the documented pitch, asserted (not hidden) by
 * the geometry tests: a standing 1.8 m capsule fits fully under an elevated
 * cone (any cone whose layer base is above head height), the 1.2 m crouched
 * capsule fits under the upper shell of a ground-level cone, and a ground
 * cone's 1.92 m apex can NEVER provide standing headroom at its own layer
 * (that is physics, not a bug to paper over).
 */
export const CONE_SHELL_THICKNESS = 2 * CONE_RISE;

/** Upper bound on {@link structureCuboids} length per build type, for
 * consumers that pool one mesh per solid (e.g. the edit preview). */
export const MAX_STRUCTURE_CUBOIDS = {
  wall: 9,
  floor: 4,
  ramp: RAMP_STEPS,
  // The roof shell decomposes into at most six merged rectangles per level
  // (two outward Z bands + the four outward X strips of a full skirt).
  cone: CONE_LEVELS * 6,
} as const;

/** Merge exactly-touching axis-aligned rectangles in one plane (used by the
 * cone roof shell): repeatedly fuse any pair that shares a full edge line
 * and forms a rectangle, until no merge is possible. Deterministic and
 * volume-preserving. */
function mergeRects(rects: { x0: number; x1: number; z0: number; z1: number }[]): { x0: number; x1: number; z0: number; z1: number }[] {
  const out = [...rects];
  for (;;) {
    let merged = false;
    for (let a = 0; a < out.length && !merged; a++) {
      for (let b = a + 1; b < out.length; b++) {
        const A = out[a]!, B = out[b]!;
        let u: { x0: number; x1: number; z0: number; z1: number } | null = null;
        if (A.x0 === B.x0 && A.x1 === B.x1 && (A.z1 === B.z0 || B.z1 === A.z0)) {
          u = { x0: A.x0, x1: A.x1, z0: Math.min(A.z0, B.z0), z1: Math.max(A.z1, B.z1) };
        } else if (A.z0 === B.z0 && A.z1 === B.z1 && (A.x1 === B.x0 || B.x1 === A.x0)) {
          u = { x0: Math.min(A.x0, B.x0), x1: Math.max(A.x1, B.x1), z0: A.z0, z1: A.z1 };
        }
        if (u) {
          out.splice(b, 1);
          out[a] = u;
          merged = true;
          break;
        }
      }
    }
    if (!merged) return out;
  }
}

function box(x: number, y: number, z: number, hx: number, hy: number, hz: number): StructureCuboid {
  return { center: { x, y, z }, halfExtents: { x: hx, y: hy, z: hz } };
}

/** The exact visual/collision/hitscan volumes for a replicated structure. */
export function structureCuboids(input: StructureGeometryInput): StructureCuboid[] {
  const { buildType, grid, rotation, editGrid } = input;
  const config = getStructureConfig(buildType);
  if (!config) return [];
  const cs = BUILD_GRID.cellSize;
  const lh = BUILD_GRID.layerHeight;
  const x = grid.x * cs;
  const y = grid.y * lh;
  const z = grid.z * cs;
  const result: StructureCuboid[] = [];

  if (buildType === "wall") {
    const tiles = editGrid?.kind === "wall" && editGrid.tiles.length === 9
      ? editGrid.tiles : Array<boolean>(9).fill(true);
    const alongX = rotation === 0 || rotation === 2;
    // Edge piece: the panel stands on the tile edge, not through its middle.
    const { x, z } = wallEdgeCenter(grid, rotation);
    if (tiles.every(Boolean)) {
      return [alongX
        ? box(x, y + lh / 2, z, cs / 2, lh / 2, cs * 0.075)
        : box(x, y + lh / 2, z, cs * 0.075, lh / 2, cs / 2)];
    }
    const forward = rotation === 0 || rotation === 1;
    for (let i = 0; i < 9; i++) {
      if (!tiles[i]) continue;
      const col = forward ? i % 3 : 2 - (i % 3);
      const row = Math.floor(i / 3);
      const offset = -cs / 2 + (col + 0.5) * cs / 3;
      const cy = y + (2 - row + 0.5) * lh / 3;
      result.push(alongX
        ? box(x + offset, cy, z, cs / 6, lh / 6, cs * 0.075)
        : box(x, cy, z + offset, cs * 0.075, lh / 6, cs / 6));
    }
    return result;
  }

  if (buildType === "floor") {
    const tiles = editGrid?.kind === "floor_cone" && editGrid.tiles.length === 4
      ? editGrid.tiles : Array<boolean>(4).fill(true);
    const height = 0.15;
    if (tiles.every(Boolean)) return [box(x, y + height / 2, z, cs / 2, height / 2, cs / 2)];
    for (let i = 0; i < 4; i++) {
      if (!tiles[i]) continue;
      result.push(box(
        x + ((i % 2) - 0.5) * cs / 2,
        y + height / 2,
        z + (Math.floor(i / 2) - 0.5) * cs / 2,
        cs / 4, height / 2, cs / 4,
      ));
    }
    return result;
  }

  if (buildType === "cone") {
    // Stepped ROOF SHELL (see {@link CONE_SHELL_THICKNESS}): level j is the
    // thin skirt between the pyramid half-sizes s_j = (cs/2)(L−j)/L and
    // s_{j+1}, spanning y ∈ [(j+1)·rise − T, (j+1)·rise] clamped to the layer
    // base (PEAK = CONE_PEAK_HEIGHT, a low roof, not a full-layer spire).
    // The shell TOP is exactly the top of the old stepped pyramid — the same
    // walkable tread heights, peak and rotation behaviour — but everything
    // below the surface is real air: shots, camera and sight pass through
    // the roof interior, and an elevated cone is proper cover to walk under.
    // An edit keeps only the retained quadrants; a removed quadrant is a
    // true full-height opening at every level.
    // (tile i: column i%2 along X, row ⌊i/2⌋ along Z, low → high).
    //
    // Per retained quadrant the skirt is an L of two rectangles: an outer
    // band along the quadrant's outward Z edge (full quadrant X span) plus a
    // side strip along its outward X edge inside the next level's Z span.
    // Exactly-touching rectangles are merged, so a full four-quadrant skirt
    // is four boxes per level, not eight.
    const tiles = editGrid?.kind === "floor_cone" && editGrid.tiles.length === 4
      ? editGrid.tiles : Array<boolean>(4).fill(true);
    const inset = (cs / 2) / CONE_LEVELS; // s_j − s_{j+1}, one lattice step
    for (let j = 0; j < CONE_LEVELS; j++) {
      const s = (cs / 2) * (CONE_LEVELS - j) / CONE_LEVELS;
      const si = s - inset; // = s_{j+1} on the same exact lattice
      const bandTop = y + (j + 1) * CONE_RISE;
      const bandBottom = Math.max(y, bandTop - CONE_SHELL_THICKNESS);
      const cy = (bandTop + bandBottom) / 2;
      const hy = (bandTop - bandBottom) / 2;
      const rects: { x0: number; x1: number; z0: number; z1: number }[] = [];
      for (let i = 0; i < 4; i++) {
        if (!tiles[i]) continue;
        const col = i % 2, row = Math.floor(i / 2);
        const xo = col === 0 ? x - s : x + s; // quadrant's outer X face
        const xi = col === 0 ? x - si : x + si; // next level's outer X face
        const zo = row === 0 ? z - s : z + s; // quadrant's outer Z face
        const zi = row === 0 ? z - si : z + si; // next level's outer Z face
        // Outer band along the outward Z edge, full quadrant X span.
        rects.push({ x0: Math.min(x, xo), x1: Math.max(x, xo), z0: Math.min(zo, zi), z1: Math.max(zo, zi) });
        // Side strip along the outward X edge, inside the next level's Z span.
        rects.push({ x0: Math.min(xo, xi), x1: Math.max(xo, xi), z0: Math.min(z, zi), z1: Math.max(z, zi) });
      }
      // Drop degenerate slivers (the apex level's side strips vanish when
      // s_{j+1} = 0) — never emit zero-extent solids.
      const kept = rects.filter((r) => r.x1 > r.x0 && r.z1 > r.z0);
      for (const r of mergeRects(kept)) {
        result.push(box((r.x0 + r.x1) / 2, cy, (r.z0 + r.z1) / 2, (r.x1 - r.x0) / 2, hy, (r.z1 - r.z0) / 2));
      }
    }
    return result;
  }

  // Ramp: RAMP_STEPS thin step slabs across ONE tile, climbing one full
  // layer (open underneath). Rotations 0/2 run along X, 1/3 along Z;
  // rotations 2/3 descend toward the axis' positive end, and `flipped`
  // reverses the slope.
  const variant = editGrid?.kind === "ramp" ? editGrid.variant : "full";
  const alongX = rotation === 0 || rotation === 2;
  const reverse = (rotation === 2 || rotation === 3) !== (variant === "flipped");
  // Lateral sign of the climber's LEFT side (game handedness: facing +X, left
  // is +Z; facing +Z, left is −X). Half ramps split the WIDTH: half_left
  // keeps the left half of the ramp as seen looking up it.
  const ascent = reverse ? -1 : 1;
  const leftSign = alongX ? ascent : -ascent;
  const side = variant === "half_left" ? 1 : variant === "half_right" ? -1 : 0;
  const turn = variant === "turn_left" ? -1 : variant === "turn_right" ? 1 : 0;
  const stepLength = cs / RAMP_STEPS;
  for (let i = 0; i < RAMP_STEPS; i++) {
    const fromLow = reverse ? RAMP_STEPS - 1 - i : i;
    const top = lh * (fromLow + 1) / RAMP_STEPS;
    const bottom = Math.max(0, top - RAMP_SLAB_THICKNESS);
    const along = -cs / 2 + (i + 0.5) * stepLength;
    let lateral = 0, halfWidth = cs / 2;
    if (side !== 0) {
      lateral = side * leftSign * cs / 4;
      halfWidth = cs / 4;
    } else if (turn !== 0) {
      lateral = turn * (i / (RAMP_STEPS - 1)) * cs / 4;
      halfWidth = cs / 4;
    }
    const cy = y + (top + bottom) / 2;
    const hy = (top - bottom) / 2;
    result.push(alongX
      ? box(x + along, cy, z + lateral, stepLength / 2, hy, halfWidth)
      : box(x + lateral, cy, z + along, halfWidth, hy, stepLength / 2));
  }
  return result;
}

/** Nearest positive ray intersection with any solid volume of one structure. */
export function rayStructureIntersection(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  maxDistance: number,
  cuboids: readonly StructureCuboid[],
): { distance: number; point: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } } | null {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length < 1e-12) return null;
  let best = maxDistance / length;
  let found = false;
  let bestAxis: "x" | "y" | "z" = "y";
  let bestSign = 1;
  for (const { center, halfExtents } of cuboids) {
    let entry = 0;
    let exit = best;
    // The face the ray enters through (its outward normal is the hit normal).
    let entryAxis: "x" | "y" | "z" | null = null;
    let entrySign = 1;
    for (const axis of ["x", "y", "z"] as const) {
      const d = direction[axis];
      const low = center[axis] - halfExtents[axis];
      const high = center[axis] + halfExtents[axis];
      if (Math.abs(d) < 1e-12) {
        // Parallel to this axis: inside the slab (1 nm tolerance closes float
        // seams between abutting boxes, e.g. adjacent ramp steps).
        if (origin[axis] < low - 1e-9 || origin[axis] > high + 1e-9) { exit = -1; break; }
      } else {
        const a = (low - origin[axis]) / d;
        const b = (high - origin[axis]) / d;
        const near = Math.min(a, b);
        if (near > entry) { entry = near; entryAxis = axis; entrySign = d > 0 ? -1 : 1; }
        exit = Math.min(exit, Math.max(a, b));
        if (entry > exit) break;
      }
    }
    if (entry <= exit && exit >= 0 && entry <= best) {
      best = entry;
      found = true;
      // Starting inside the box: report the face opposing the ray's dominant axis.
      if (entryAxis === null) {
        const ax = Math.abs(direction.x), ay = Math.abs(direction.y), az = Math.abs(direction.z);
        entryAxis = ax >= ay && ax >= az ? "x" : ay >= az ? "y" : "z";
        entrySign = direction[entryAxis] > 0 ? -1 : 1;
      }
      bestAxis = entryAxis;
      bestSign = entrySign;
    }
  }
  if (!found) return null;
  return {
    distance: best * length,
    point: {
      x: origin.x + direction.x * best,
      y: origin.y + direction.y * best,
      z: origin.z + direction.z * best,
    },
    normal: { x: bestAxis === "x" ? bestSign : 0, y: bestAxis === "y" ? bestSign : 0, z: bestAxis === "z" ? bestSign : 0 },
  };
}

export interface StructureMovementPose {
  x: number; y: number; z: number;
  velocityY: number;
  grounded: boolean;
}

/** Resolve the canonical feet position against structure solids. The same
 * deterministic pass runs after movement integration on client and server. */
export function resolveStructureMovement<T extends StructureMovementPose>(
  previous: StructureMovementPose,
  proposed: T,
  cuboids: readonly StructureCuboid[],
  radius: number,
  height: number,
): T {
  const out = { ...proposed };
  const overlapXZ = (c: StructureCuboid) =>
    out.x + radius > c.center.x - c.halfExtents.x &&
    out.x - radius < c.center.x + c.halfExtents.x &&
    out.z + radius > c.center.z - c.halfExtents.z &&
    out.z - radius < c.center.z + c.halfExtents.z;

  // Land on the highest crossed solid top, including the shallow successive
  // ramp steps. Removed tiles supply no volume and therefore no support.
  if (proposed.velocityY <= 0) {
    for (const c of cuboids) {
      const top = c.center.y + c.halfExtents.y;
      if (!overlapXZ(c) || previous.y < top - 0.34 || proposed.y > top) continue;
      if (top >= out.y) {
        out.y = top;
        out.velocityY = 0;
        out.grounded = true;
      }
    }
  }

  // A jump stops at the underside of a solid section.
  if (proposed.velocityY > 0) {
    for (const c of cuboids) {
      const bottom = c.center.y - c.halfExtents.y;
      if (!overlapXZ(c) || previous.y + height > bottom || proposed.y + height < bottom) continue;
      out.y = Math.min(out.y, bottom - height);
      out.velocityY = 0;
      out.grounded = false;
    }
  }

  // Horizontal capsule approximation against the same boxes. Resolving each
  // axis separately permits natural sliding along the remaining solid tiles.
  for (const c of cuboids) {
    const minX = c.center.x - c.halfExtents.x - radius;
    const maxX = c.center.x + c.halfExtents.x + radius;
    const minZ = c.center.z - c.halfExtents.z - radius;
    const maxZ = c.center.z + c.halfExtents.z + radius;
    const bottom = c.center.y - c.halfExtents.y;
    const top = c.center.y + c.halfExtents.y;
    if (out.y >= top - 0.02 || out.y + height <= bottom + 0.02) continue;
    if (out.x <= minX || out.x >= maxX || out.z <= minZ || out.z >= maxZ) continue;
    if (previous.x <= minX) out.x = minX;
    else if (previous.x >= maxX) out.x = maxX;
    if (previous.z <= minZ) out.z = minZ;
    else if (previous.z >= maxZ) out.z = maxZ;
  }
  return out as T;
}

/**
 * The world-space bounding box of a structure's canonical (unedited)
 * geometry — the targeting / camera-obstruction volume, so edge walls and
 * thin one-tile ramps are bounded where they actually stand.
 */
export function structureBounds(input: Omit<StructureGeometryInput, "editGrid">): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const { center, halfExtents } of structureCuboids(input)) {
    const c = [center.x, center.y, center.z];
    const h = [halfExtents.x, halfExtents.y, halfExtents.z];
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, c[i]! - h[i]!);
      max[i] = Math.max(max[i]!, c[i]! + h[i]!);
    }
  }
  return { min, max };
}
