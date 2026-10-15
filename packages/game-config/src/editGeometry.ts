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

/** Stacked levels in a canonical cone: a 16-level stepped pyramid rising one
 * build layer, each level 0.24 m tall and narrower toward the apex. */
export const CONE_LEVELS = 16;

/** Upper bound on {@link structureCuboids} length per build type, for
 * consumers that pool one mesh per solid (e.g. the edit preview). */
export const MAX_STRUCTURE_CUBOIDS = {
  wall: 9,
  floor: 4,
  ramp: RAMP_STEPS,
  // At most two merged rectangles per level (diagonal or L-shaped edits).
  cone: CONE_LEVELS * 2,
} as const;

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
    // Stepped pyramid: level j spans y ∈ [j, j+1]·lh/L with half-size
    // (cs/2)·(L−j)/L. An edit keeps only the retained quadrants of every
    // level (tile i: column i%2 along X, row ⌊i/2⌋ along Z, low → high).
    const tiles = editGrid?.kind === "floor_cone" && editGrid.tiles.length === 4
      ? editGrid.tiles : Array<boolean>(4).fill(true);
    const rise = lh / CONE_LEVELS;
    for (let j = 0; j < CONE_LEVELS; j++) {
      const s = (cs / 2) * (CONE_LEVELS - j) / CONE_LEVELS;
      const cy = y + (j + 0.5) * rise;
      // X range retained in each Z row (row 0: z−s..z, row 1: z..z+s).
      const rows = [0, 1].map((row) => {
        const lo = tiles[row * 2], hi = tiles[row * 2 + 1];
        return lo && hi ? [x - s, x + s] : lo ? [x - s, x] : hi ? [x, x + s] : null;
      });
      const [r0, r1] = rows;
      if (r0 && r1 && r0[0] === r1[0] && r0[1] === r1[1]) {
        result.push(box((r0[0]! + r0[1]!) / 2, cy, z, (r0[1]! - r0[0]!) / 2, rise / 2, s));
        continue;
      }
      if (r0) result.push(box((r0[0]! + r0[1]!) / 2, cy, z - s / 2, (r0[1]! - r0[0]!) / 2, rise / 2, s / 2));
      if (r1) result.push(box((r1[0]! + r1[1]!) / 2, cy, z + s / 2, (r1[1]! - r1[0]!) / 2, rise / 2, s / 2));
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
): { distance: number; point: { x: number; y: number; z: number } } | null {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length < 1e-12) return null;
  let best = maxDistance / length;
  let found = false;
  for (const { center, halfExtents } of cuboids) {
    let entry = 0;
    let exit = best;
    for (const axis of ["x", "y", "z"] as const) {
      const d = direction[axis];
      const low = center[axis] - halfExtents[axis];
      const high = center[axis] + halfExtents[axis];
      if (Math.abs(d) < 1e-12) {
        if (origin[axis] < low || origin[axis] > high) { exit = -1; break; }
      } else {
        const a = (low - origin[axis]) / d;
        const b = (high - origin[axis]) / d;
        entry = Math.max(entry, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
        if (entry > exit) break;
      }
    }
    if (entry <= exit && exit >= 0 && entry <= best) {
      best = entry;
      found = true;
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
