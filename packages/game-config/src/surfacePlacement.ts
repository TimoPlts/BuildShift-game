/**
 * Surface-aware build targeting — building FROM an existing piece.
 *
 * When the crosshair ray hits an existing structure, the hit face (point +
 * outward normal) decides which neighbouring canonical slot the selected
 * piece goes to, instead of snapping the raw hit point back into the piece
 * that was hit (or the empty tile behind it). Shared by the client preview
 * and the tests; the server stays authoritative and only ever validates the
 * resulting `(buildType, grid, rotation)` request with the usual bounds /
 * range / slot rules.
 *
 * Conventions (see `wallEdgeCenter`, `structureSlots`, `structureCuboids`):
 *  - tiles are centred on `grid × cellSize`; layer `y` spans `[y, y+1]·lh`;
 *  - wall rotation = the tile edge it stands on: 0 −Z, 1 +X, 2 +Z, 3 −X;
 *  - ramp rotation = the direction it rises: 0 +X, 1 +Z, 2 −X, 3 −Z
 *    (`flipped` reverses it).
 *
 * Resolution rules (deterministic, no ray offsets — the hit face picks the side):
 *
 *  WALL hit (edge between its tile A and the tile B across that edge)
 *   - upper third of a face, or its top → "high":
 *       wall  → the same edge one layer up (stacked walls);
 *       other → one layer up, on the tile across the edge in the aim direction
 *               (a floor extends outward from the wall's top).
 *   - lower part of a face → the tile on the hit side, same layer; a wall
 *     continues the line on the side of the hit (outer quarters), else it is
 *     the same edge (occupied → invalid);
 *   - an end face → the next tile along the wall's line.
 *  FLOOR hit (top / bottom)
 *       floor → the neighbouring tile across the edge nearest the hit (air floors);
 *       wall  → the edge nearest the hit (on the floor; under it from below);
 *       ramp/cone → the floor's tile (on it; under it from below).
 *     slab edge face → the neighbouring tile on that side.
 *  RAMP hit (surface from above)
 *       wall  → the ramp tile's edge nearest the hit (ramp boxes);
 *       ramp  → continuation: the tile past the high end, one layer up, rising
 *               the same way;
 *       floor/cone → high half: the tile past the high end, one layer up;
 *                    low half: above the ramp's tile.
 *     side faces / underside → the side tile / the ramp's own tile, same layer.
 *  CONE hit
 *       wall → the edge nearest the hit; upper half of the top → the layer
 *       above the cone; otherwise the neighbouring tile across the nearest edge.
 */
import { BUILD_GRID, normalizePlacementRotation, wallEdgeRotation } from "./building.js";
import { rayStructureIntersection, structureCuboids, wallEdgeCenter, type StructureCuboid, type StructureGeometryInput } from "./editGeometry.js";

type Vec3 = { x: number; y: number; z: number };
type Cell = { x: number; y: number; z: number };

/** Outward horizontal direction of each wall edge (by wall rotation). */
const EDGE_DIRS: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
/** Rise direction of each ramp rotation. */
const RAMP_DIRS: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** Fraction of a wall's height above which aiming at its face targets the layer above. */
export const WALL_HIGH_FRACTION = 2 / 3;

/** A surface hit on one structure. */
export interface StructureSurfaceHit {
  /** Index of the hit structure in the raycast input. */
  index: number;
  structure: StructureGeometryInput;
  point: Vec3;
  /** Outward unit normal of the face that was hit (axis-aligned). */
  normal: Vec3;
  distance: number;
}

/**
 * The nearest structure face along a ray (canonical, edit-aware geometry).
 * Callers that raycast every frame may pass each structure's precomputed
 * `cuboids` (otherwise they are derived with `structureCuboids`).
 */
export function raycastStructureSurface(
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  structures: readonly (StructureGeometryInput & { cuboids?: readonly StructureCuboid[] })[],
): StructureSurfaceHit | null {
  let best: StructureSurfaceHit | null = null;
  structures.forEach((structure, index) => {
    const hit = rayStructureIntersection(origin, direction, best ? best.distance : maxDistance, structure.cuboids ?? structureCuboids(structure));
    if (hit && (!best || hit.distance < best.distance)) best = { index, structure, ...hit };
  });
  return best;
}

const mod4 = (r: number) => ((r % 4) + 4) % 4;
const step = (g: Cell, dx: number, dz: number, dy = 0): Cell => ({ x: g.x + dx, y: g.y + dy, z: g.z + dz });
/** The neighbour of `g` across its edge nearest to the point. */
const acrossNearestEdge = (g: Cell, p: Vec3) => {
  const [dx, dz] = EDGE_DIRS[wallEdgeRotation(g, p.x, p.z)]!;
  return step(g, dx, dz);
};

/** The direction a ramp rises (its high end), honouring the `flipped` edit. */
export function rampHighDirection(structure: StructureGeometryInput): readonly [number, number] {
  const [dx, dz] = RAMP_DIRS[mod4(structure.rotation)]!;
  const flipped = structure.editGrid?.kind === "ramp" && structure.editGrid.variant === "flipped";
  return flipped ? [-dx + 0, -dz + 0] : [dx, dz]; // `+ 0` avoids −0
}

/** The candidate slot resolved from a surface hit. */
export interface SurfacePlacement {
  grid: Cell;
  rotation: number;
}

/**
 * Resolves the slot the selected piece should take when the aim ray hits
 * `hit` (see the module doc for the rules). `aimDirection` decides which side
 * of a wall a floor extends to; `selectedRotation` is used where the surface
 * does not dictate one (ramps not continuing another ramp).
 */
export function resolveSurfacePlacement(
  hit: Pick<StructureSurfaceHit, "structure" | "point" | "normal">,
  buildType: string,
  selectedRotation: number,
  aimDirection: Vec3,
): SurfacePlacement {
  const cs = BUILD_GRID.cellSize;
  const lh = BUILD_GRID.layerHeight;
  const { structure: s, point: p, normal: n } = hit;
  const g: Cell = { x: s.grid.x, y: s.grid.y, z: s.grid.z };
  const localY = p.y - g.y * lh;
  const top = n.y > 0.5;
  const bottom = n.y < -0.5;
  const side = !top && !bottom;
  const own = (grid: Cell): SurfacePlacement => ({ grid, rotation: normalizePlacementRotation(buildType, selectedRotation) });
  const wallAt = (grid: Cell, rotation: number): SurfacePlacement => ({ grid, rotation: mod4(rotation) });
  const nearestWall = (grid: Cell): SurfacePlacement => wallAt(grid, wallEdgeRotation(grid, p.x, p.z));

  if (s.buildType === "wall") {
    const r = mod4(s.rotation);
    const [ex, ez] = EDGE_DIRS[r]!;
    const across = step(g, ex, ez);
    const facing = n.x * ex + n.z * ez; // ±1 on the two broad faces, 0 on end faces
    const endFace = side && Math.abs(facing) < 0.5;
    const high = top || (side && !endFace && localY >= lh * WALL_HIGH_FRACTION);
    if (buildType === "wall") {
      if (high) return wallAt(step(g, 0, 0, 1), r);
      if (endFace) return wallAt(step(g, n.x, n.z), r);
      // Lower face: continue the line toward the side of the hit.
      const c = wallEdgeCenter(g, r);
      const tx = -ez, tz = ex; // along the wall's run
      const u = (p.x - c.x) * tx + (p.z - c.z) * tz;
      if (Math.abs(u) > cs / 4) return wallAt(step(g, Math.sign(u) * tx, Math.sign(u) * tz), r);
      return wallAt(g, r);
    }
    if (high) {
      const outward = aimDirection.x * ex + aimDirection.z * ez > 0 ? across : g;
      return own(step(outward, 0, 0, 1));
    }
    if (endFace) return own(step(g, n.x, n.z));
    return own(facing > 0 ? across : g);
  }

  if (s.buildType === "floor") {
    const layerShift = bottom ? -1 : 0;
    if (buildType === "wall") return nearestWall(step(g, 0, 0, layerShift));
    if (side) return own(step(g, n.x, n.z));
    if (buildType === "floor") return own(acrossNearestEdge(g, p));
    return own(step(g, 0, 0, layerShift));
  }

  if (s.buildType === "ramp") {
    const [hx, hz] = rampHighDirection(s);
    if (buildType === "wall") return nearestWall(g);
    const sideFace = side && Math.abs(n.x * hx + n.z * hz) < 0.5;
    if (sideFace) return own(step(g, n.x, n.z));
    if (bottom) return own(g);
    const past = step(g, hx, hz, 1);
    if (buildType === "ramp") return { grid: past, rotation: RAMP_DIRS.findIndex(([dx, dz]) => dx === hx && dz === hz) };
    // How far up the ramp the hit is (0 = low end, 1 = high end).
    const along = ((p.x - g.x * cs) * hx + (p.z - g.z * cs) * hz) / cs + 0.5;
    return own(along >= 0.5 ? past : step(g, 0, 0, 1));
  }

  // Cone.
  if (buildType === "wall") return nearestWall(g);
  if (top && localY >= lh / 2) return own(step(g, 0, 0, 1));
  return own(side ? step(g, n.x, n.z) : acrossNearestEdge(g, p));
}
