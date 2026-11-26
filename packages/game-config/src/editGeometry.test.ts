import { describe, expect, it } from "vitest";
import { CONE_LEVELS, CONE_PEAK_HEIGHT, CONE_RISE, CONE_SHELL_THICKNESS, MAX_STRUCTURE_CUBOIDS, RAMP_SLAB_THICKNESS, RAMP_STEPS, rayStructureIntersection, resolveStructureMovement, structureCuboids, wallEdgeCenter, type StructureCuboid } from "./editGeometry.js";
import { BUILD_GRID } from "./building.js";

const grid = { x: 0, y: 0, z: 0 };
const forward = { x: 0, y: 0, z: 1 };
/** Walls are edge pieces: rotation 0 stands on the tile's −Z edge, rotation 1 on its +X edge. */
const PZ = wallEdgeCenter(grid, 0).z;
const PX = wallEdgeCenter(grid, 1).x;

describe("canonical structure geometry", () => {
  it("passes shots through wall windows and doors but blocks solid tiles", () => {
    const window = structureCuboids({ buildType: "wall", grid, rotation: 0,
      editGrid: { kind: "wall", tiles: [true, true, true, true, false, true, true, true, true] } });
    expect(rayStructureIntersection({ x: 0, y: 1.92, z: -3 }, forward, 10, window)).toBeNull();
    expect(rayStructureIntersection({ x: 2, y: 1.92, z: -3 }, forward, 10, window)).not.toBeNull();
    const door = structureCuboids({ buildType: "wall", grid, rotation: 0,
      editGrid: { kind: "wall", tiles: [true, true, true, true, false, true, true, false, true] } });
    expect(rayStructureIntersection({ x: 0, y: 0.9, z: -3 }, forward, 10, door)).toBeNull();
    expect(rayStructureIntersection({ x: 0, y: 3.2, z: -3 }, forward, 10, door)).not.toBeNull();
  });

  it.each(["floor", "cone"] as const)("opens only removed %s quadrants", (buildType) => {
    const geometry = structureCuboids({ buildType, grid, rotation: 0,
      editGrid: { kind: "floor_cone", tiles: [false, true, true, true] } });
    expect(rayStructureIntersection({ x: -1, y: 6, z: -1 }, { x: 0, y: -1, z: 0 }, 10, geometry)).toBeNull();
    expect(rayStructureIntersection({ x: 1, y: 6, z: 1 }, { x: 0, y: -1, z: 0 }, 10, geometry)).not.toBeNull();
  });

  it("gives a full-state reset the exact default volume", () => {
    const wall = structureCuboids({ buildType: "wall", grid, rotation: 1 });
    const reset = structureCuboids({ buildType: "wall", grid, rotation: 1,
      editGrid: { kind: "wall", tiles: Array(9).fill(true) } });
    expect(reset).toEqual(wall);
  });

  it("lets a crouched player cross a low opening while a standing player is blocked", () => {
    const opening = structureCuboids({ buildType: "wall", grid, rotation: 0,
      editGrid: { kind: "wall", tiles: [true, true, true, true, true, true, false, false, false] } });
    const previous = { x: 0, y: 0, z: PZ - 1, velocityY: 0, grounded: true };
    const next = { ...previous, z: PZ };
    expect(resolveStructureMovement(previous, next, opening, 0.35, 1.2).z).toBe(PZ);
    expect(resolveStructureMovement(previous, next, opening, 0.35, 1.8).z).toBeLessThan(PZ - 0.7);
  });

  it("uses the canonical edited cuboids for full-wall, doorway, edge, and reset traversal", () => {
    // Rows 0/1 stay solid; the centre tile in the bottom row is a 1.28 m
    // doorway. A 1.2 m crouched capsule fits, while a standing 1.8 m capsule
    // and either remaining lower-side panel do not.
    const doorwayTiles = [true, true, true, true, true, true, true, false, true];
    const full = structureCuboids({ buildType: "wall", grid, rotation: 0 });
    const doorway = structureCuboids({ buildType: "wall", grid, rotation: 0,
      editGrid: { kind: "wall", tiles: doorwayTiles } });
    const reset = structureCuboids({ buildType: "wall", grid, rotation: 0,
      editGrid: { kind: "wall", tiles: Array(9).fill(true) } });
    const cross = (x: number, height: number, solids = doorway) =>
      resolveStructureMovement(
        { x, y: 0, z: PZ - 1, velocityY: 0, grounded: true },
        { x, y: 0, z: PZ, velocityY: 0, grounded: true },
        solids,
        0.35,
        height,
      );

    expect(cross(0, 1.2, full).z).toBeLessThan(PZ - 0.7);
    expect(cross(0, 1.2).z).toBe(PZ);
    expect(cross(0, 1.8).z).toBeLessThan(PZ - 0.7);
    expect(cross(-1.5, 1.2).z).toBeLessThan(PZ - 0.7);
    expect(cross(1.5, 1.2).z).toBeLessThan(PZ - 0.7);
    expect(cross(0, 1.2, reset).z).toBeLessThan(PZ - 0.7);
  });

  it("rotates the same doorway traversal and side blockers with the wall", () => {
    const doorway = structureCuboids({ buildType: "wall", grid, rotation: 1,
      editGrid: { kind: "wall", tiles: [true, true, true, true, true, true, true, false, true] } });
    const cross = (z: number) => resolveStructureMovement(
      { x: PX - 1, y: 0, z, velocityY: 0, grounded: true },
      { x: PX, y: 0, z, velocityY: 0, grounded: true },
      doorway,
      0.35,
      1.2,
    );
    expect(cross(0).x).toBe(PX);
    expect(cross(-1.5).x).toBeLessThan(PX - 0.7);
    expect(cross(1.5).x).toBeLessThan(PX - 0.7);
  });

  it("walls are edge pieces: each rotation stands on its own tile edge, and neighbours share edges", () => {
    const span = (rotation: number, g = grid) => {
      const [c] = structureCuboids({ buildType: "wall", grid: g, rotation });
      return { x: [c!.center.x - c!.halfExtents.x, c!.center.x + c!.halfExtents.x], z: [c!.center.z - c!.halfExtents.z, c!.center.z + c!.halfExtents.z] };
    };
    expect(span(0).z.map((v) => +v.toFixed(3))).toEqual([-2.944, -2.176]); // −Z edge (z = −2.56)
    expect(span(2).z.map((v) => +v.toFixed(3))).toEqual([2.176, 2.944]); // +Z edge
    expect(span(1).x.map((v) => +v.toFixed(3))).toEqual([2.176, 2.944]); // +X edge
    expect(span(3).x.map((v) => +v.toFixed(3))).toEqual([-2.944, -2.176]); // −X edge
    // The +Z edge of tile (0,0) is the −Z edge of tile (0,1): same physical panel.
    expect(span(2)).toEqual(span(0, { x: 0, y: 0, z: 1 }));
    expect(span(1)).toEqual(span(3, { x: 1, y: 0, z: 0 }));
  });

  it("supports a player over a solid elevated floor quadrant and lets them fall through a removed one", () => {
    const floor = structureCuboids({ buildType: "floor", grid: { x: 0, y: 1, z: 0 }, rotation: 0,
      editGrid: { kind: "floor_cone", tiles: [false, true, true, true] } });
    const falling = { x: -1, y: 3.9, z: -1, velocityY: -1, grounded: false };
    const aboveHole = { ...falling, y: 4.01 };
    expect(resolveStructureMovement(aboveHole, falling, floor, 0.35, 1.8).y).toBe(3.9);
    const solidPrevious = { ...aboveHole, x: 1, z: 1 };
    const solidNext = { ...falling, x: 1, z: 1 };
    const landed = resolveStructureMovement(solidPrevious, solidNext, floor, 0.35, 1.8);
    expect(landed.y).toBeCloseTo(3.99, 5);
    expect(landed.grounded).toBe(true);
  });
});

// ─── Ramp / cone traversal through the shared resolver ──────────────────────

const cs = BUILD_GRID.cellSize;
const lh = BUILD_GRID.layerHeight;
const RADIUS = 0.35;
const HEIGHT = 1.8;

/** Walk a standing capsule `ticks` server steps (0.2 m/tick, gravity −20,
 * 30 Hz — the authoritative step) through the shared resolver. */
function walk(start: { x: number; z: number }, dir: { x: number; z: number }, ticks: number, solids: StructureCuboid[]) {
  let pose = { x: start.x, y: 0, z: start.z, velocityY: 0, grounded: true };
  const path = [pose];
  for (let i = 0; i < ticks; i++) {
    let vy = pose.velocityY - 20 / 30;
    let y = pose.y + vy / 30;
    let grounded = false;
    if (y <= 0) { y = 0; vy = 0; grounded = true; }
    pose = resolveStructureMovement(pose, { x: pose.x + dir.x * 0.2, y, z: pose.z + dir.z * 0.2, velocityY: vy, grounded }, solids, RADIUS, HEIGHT);
    path.push(pose);
  }
  return path;
}

/** Ascent direction and climber's-left vector of a canonical ramp. */
function rampFrame(rotation: number, flipped: boolean) {
  const alongX = rotation === 0 || rotation === 2;
  const reverse = (rotation === 2 || rotation === 3) !== flipped;
  const s = reverse ? -1 : 1;
  const up = alongX ? { x: s, z: 0 } : { x: 0, z: s };
  // Game handedness: facing +X the left is +Z; facing +Z the left is −X.
  const left = { x: -up.z, z: up.x };
  // Footprint: exactly the anchor tile.
  const center = { x: 0, z: 0 };
  return { up, left, center };
}

describe("canonical ramp: one tile, one full layer, thin, width halves", () => {
  const grid = { x: 0, y: 0, z: 0 };
  const top = (cuboids: StructureCuboid[]) => Math.max(...cuboids.map((c) => c.center.y + c.halfExtents.y));

  it.each([0, 1, 2, 3])("rotation %i occupies exactly one tile with thin step slabs (open underneath)", (rotation) => {
    const ramp = structureCuboids({ buildType: "ramp", grid, rotation });
    for (const c of ramp) {
      for (const axis of ["x", "z"] as const) {
        expect(c.center[axis] - c.halfExtents[axis]).toBeGreaterThanOrEqual(-cs / 2 - 1e-9);
        expect(c.center[axis] + c.halfExtents[axis]).toBeLessThanOrEqual(cs / 2 + 1e-9);
      }
      expect(c.halfExtents.y * 2).toBeLessThanOrEqual(RAMP_SLAB_THICKNESS + 1e-9); // a slab, not a column
    }
    // Consecutive slabs overlap vertically: a closed walking surface.
    const tops = ramp.map((c) => [c.center.y - c.halfExtents.y, c.center.y + c.halfExtents.y] as const).sort((a, b) => a[1] - b[1]);
    for (let i = 1; i < tops.length; i++) expect(tops[i]![0]).toBeLessThanOrEqual(tops[i - 1]![1] + 1e-9);
  });

  it.each([0, 1, 2, 3])("rotation %i: a standing player walks straight under the high half; at the low end they step onto it", (rotation) => {
    const { up, left } = rampFrame(rotation, false);
    const ramp = structureCuboids({ buildType: "ramp", grid, rotation });
    const across = (along: number) => {
      const start = { x: up.x * along - left.x * (cs / 2 + 1), z: up.z * along - left.z * (cs / 2 + 1) };
      const path = walk(start, left, 40, ramp);
      const end = path.at(-1)!;
      return { travelled: (end.x - start.x) * left.x + (end.z - start.z) * left.z, maxY: Math.max(...path.map((p) => p.y)) };
    };
    const under = across(cs / 2 - 0.6);
    expect(under.travelled).toBeGreaterThan(cs + 1.5); // open underneath: straight through
    expect(under.maxY).toBe(0); // ... at ground level
    const low = across(-cs / 2 + 0.6);
    expect(low.maxY).toBeGreaterThan(0); // the low steps are a walking surface
    expect(low.maxY).toBeLessThan(1); // (not a wall)
  });

  it.each([0, 1, 2, 3])("rotation %i rises exactly one layer in steps within the 0.34 m step-up", (rotation) => {
    const ramp = structureCuboids({ buildType: "ramp", grid, rotation });
    expect(ramp).toHaveLength(RAMP_STEPS);
    expect(top(ramp)).toBeCloseTo(lh, 9);
    const heights = ramp.map((c) => c.center.y + c.halfExtents.y).sort((a, b) => a - b);
    for (let i = 1; i < heights.length; i++) expect(heights[i]! - heights[i - 1]!).toBeLessThan(0.34);
    expect(heights[0]).toBeLessThan(0.34);
  });

  it.each([0, 1, 2, 3])("rotation %i: real walking climbs the ramp onto a next-layer floor with no jump", (rotation) => {
    const { up, center } = rampFrame(rotation, false);
    const ramp = structureCuboids({ buildType: "ramp", grid, rotation });
    // The next-layer floor sits in the cell beyond the ramp's high end.
    const floorGrid = { x: Math.round((center.x + up.x * cs) / cs), y: 1, z: Math.round((center.z + up.z * cs) / cs) };
    const floor = structureCuboids({ buildType: "floor", grid: floorGrid, rotation: 0 });
    const floorTop = lh + 0.15;
    const start = { x: center.x - up.x * (cs / 2 + 1), z: center.z - up.z * (cs / 2 + 1) };
    const path = walk(start, up, 50, [...ramp, ...floor]);
    const end = path.at(-1)!;
    expect(end.y).toBeCloseTo(floorTop, 6);
    // On the floor: past the ramp's high end, over the next tile's floor.
    expect((end.x - center.x) * up.x + (end.z - center.z) * up.z).toBeGreaterThan(cs / 2);
    // Monotonic climb, never a jump (velocity never positive).
    expect(path.every((p) => p.velocityY <= 0)).toBe(true);
    for (let i = 1; i < path.length; i++) expect(path[i]!.y).toBeGreaterThanOrEqual(path[i - 1]!.y - 1e-9);
  });

  it.each([0, 1, 2, 3])("rotation %i: half_left / half_right keep the climber's left / right half of the width", (rotation) => {
    const { up, left, center } = rampFrame(rotation, false);
    for (const [variant, sign] of [["half_left", 1], ["half_right", -1]] as const) {
      const half = structureCuboids({ buildType: "ramp", grid, rotation, editGrid: { kind: "ramp", variant } });
      expect(half).toHaveLength(RAMP_STEPS);
      expect(top(half)).toBeCloseTo(lh, 9);
      for (const c of half) {
        const lateral = (c.center.x - center.x) * left.x + (c.center.z - center.z) * left.z;
        expect(lateral).toBeCloseTo(sign * cs / 4, 9);
      }
      // The kept lane climbs to the top; the removed lane never leaves the ground.
      const lane = (side: number) => ({ x: center.x - up.x * (cs / 2 + 1) + left.x * side * cs / 4, z: center.z - up.z * (cs / 2 + 1) + left.z * side * cs / 4 });
      const kept = walk(lane(sign), up, 33, half);
      expect(Math.max(...kept.map((p) => p.y))).toBeCloseTo(lh, 6);
      const removed = walk(lane(-sign), up, 33, half);
      expect(Math.max(...removed.map((p) => p.y))).toBe(0);
    }
  });

  it.each([0, 1, 2, 3])("rotation %i: flipped reverses which end is high", (rotation) => {
    const { up, center } = rampFrame(rotation, false);
    const highEnd = (cuboids: StructureCuboid[]) => {
      const c = cuboids.reduce((a, b) => (a.center.y + a.halfExtents.y > b.center.y + b.halfExtents.y ? a : b));
      return (c.center.x - center.x) * up.x + (c.center.z - center.z) * up.z;
    };
    expect(highEnd(structureCuboids({ buildType: "ramp", grid, rotation }))).toBeGreaterThan(0);
    expect(highEnd(structureCuboids({ buildType: "ramp", grid, rotation, editGrid: { kind: "ramp", variant: "flipped" } }))).toBeLessThan(0);
  });
});

describe("canonical cone: climbable low roof pyramid", () => {
  const grid = { x: 0, y: 0, z: 0 };

  it("peak follows the documented roof pitch: run cs/2 × 3:4 rise = half a layer", () => {
    // The value is derived (see CONE_PEAK_HEIGHT), not an arbitrary shrink:
    // a 9:12-style pitch over the half-cell run → exactly half a 3.84 m wall.
    expect(CONE_PEAK_HEIGHT).toBeCloseTo((cs / 2) * 0.75, 9);
    expect(CONE_PEAK_HEIGHT).toBeCloseTo(lh / 2, 9);
    expect(CONE_PEAK_HEIGHT).toBeLessThan(lh);
    // Every level stays a walkable step, never a spike to jump.
    expect(CONE_PEAK_HEIGHT / CONE_LEVELS).toBeLessThan(0.34);
  });

  it("is a stepped roof SHELL rising to the peak, thin and hollow at every level", () => {
    const cone = structureCuboids({ buildType: "cone", grid, rotation: 0 });
    // Four merged band boxes for levels 0..14, one cap box for the apex level.
    expect(cone).toHaveLength((CONE_LEVELS - 1) * 4 + 1);
    const topOf = (c: StructureCuboid) => c.center.y + c.halfExtents.y;
    const bottomOf = (c: StructureCuboid) => c.center.y - c.halfExtents.y;
    // Every level's TOP is exactly the old stepped pyramid's tread top: the
    // walkable surface, peak and step-up behaviour are unchanged.
    const byLevel = new Map<number, StructureCuboid[]>();
    for (const c of cone) {
      const j = Math.round(topOf(c) / CONE_RISE - 1);
      byLevel.set(j, [...(byLevel.get(j) ?? []), c]);
    }
    expect([...byLevel.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: CONE_LEVELS }, (_, j) => j));
    for (const [j, boxes] of byLevel) {
      for (const c of boxes) {
        expect(topOf(c)).toBeCloseTo((j + 1) * CONE_RISE, 9);
        // Thin: the band is the documented shell thickness, clamped to the layer base.
        expect(bottomOf(c)).toBeCloseTo(Math.max(0, (j + 1) * CONE_RISE - CONE_SHELL_THICKNESS), 9);
        expect(c.halfExtents.y * 2).toBeLessThanOrEqual(CONE_SHELL_THICKNESS + 1e-9);
        expect(c.halfExtents.y * 2).toBeLessThan(0.34); // never a wall-scale slab
      }
      // Consecutive bands overlap vertically by one full rise: no crease crack.
      if (j > 1) expect((j + 1) * CONE_RISE - CONE_SHELL_THICKNESS).toBeLessThanOrEqual(j * CONE_RISE + 1e-9);
    }
    expect(Math.max(...cone.map(topOf))).toBeCloseTo(CONE_PEAK_HEIGHT, 9);
    // Hollow: the apex column and the air under the surface are real air.
    const inside = (p: { x: number; y: number; z: number }) => cone.some((c) =>
      Math.abs(p.x - c.center.x) <= c.halfExtents.x - 1e-9
      && Math.abs(p.y - c.center.y) <= c.halfExtents.y - 1e-9
      && Math.abs(p.z - c.center.z) <= c.halfExtents.z - 1e-9);
    for (const y of [0.05, 0.5, 1.0, 1.5, 1.66]) expect(inside({ x: 0, y, z: 0 })).toBe(false);
    expect(inside({ x: 0, y: 1.0, z: 0 })).toBe(false); // under the cap: air
    expect(inside({ x: 1.0, y: 1.0, z: 0 })).toBe(true); // the band j=9 is material
  });

  it("is rotation-invariant (corners are fixed, rotations never tilt the roof)", () => {
    const base = structureCuboids({ buildType: "cone", grid, rotation: 0 });
    for (const rotation of [1, 2, 3]) {
      expect(structureCuboids({ buildType: "cone", grid, rotation })).toEqual(base);
    }
  });

  it("a retained quadrant is exactly that quadrant's quarter shell at every level", () => {
    // Tile 0 (NW) example: every band sits inside x ≤ 0, z ≤ 0 and covers
    // exactly the quarter annulus between s_j and s_{j+1} — the shell
    // converges on the cell-centre apex, so an edited roof keeps a full-
    // height opening in the removed quadrants and no phantom material.
    const inset = (cs / 2) / CONE_LEVELS;
    for (const tile of [0, 1, 2, 3]) {
      const tiles = [0, 1, 2, 3].map((i) => i === tile);
      const quarter = structureCuboids({ buildType: "cone", grid, rotation: 0, editGrid: { kind: "floor_cone", tiles } });
      const sx = tile % 2 === 0 ? -1 : 1;
      const sz = tile < 2 ? -1 : 1;
      // Volume: quarter-annulus area × band height, summed over all levels.
      let expected = 0;
      for (let j = 0; j < CONE_LEVELS; j++) {
        const s = (cs / 2) * (CONE_LEVELS - j) / CONE_LEVELS;
        const si = s - inset;
        expected += (s * s - si * si) * Math.min(CONE_SHELL_THICKNESS, (j + 1) * CONE_RISE);
      }
      const volume = quarter.reduce((v, c) => v + 8 * c.halfExtents.x * c.halfExtents.y * c.halfExtents.z, 0);
      expect(volume).toBeCloseTo(expected, 9);
      // Everything sits strictly in the retained quadrant.
      for (const c of quarter) {
        expect(sx * (c.center.x - c.halfExtents.x)).toBeGreaterThanOrEqual(-1e-9);
        expect(sx * (c.center.x + c.halfExtents.x)).toBeLessThanOrEqual(cs / 2 + 1e-9);
        expect(sz * (c.center.z - c.halfExtents.z)).toBeGreaterThanOrEqual(-1e-9);
        expect(sz * (c.center.z + c.halfExtents.z)).toBeLessThanOrEqual(cs / 2 + 1e-9);
      }
      // The opposite quadrant is a true void: a full-height ray through it
      // hits nothing, while the retained quadrant blocks.
      const ox = -sx * cs / 4, oz = -sz * cs / 4;
      expect(rayStructureIntersection({ x: ox, y: 6, z: oz }, { x: 0, y: -1, z: 0 }, 10, quarter)).toBeNull();
      expect(rayStructureIntersection({ x: sx * cs / 4, y: 6, z: sz * cs / 4 }, { x: 0, y: -1, z: 0 }, 10, quarter)).not.toBeNull();
    }
  });

  it("real walking climbs over the apex and down the far side", () => {
    const cone = structureCuboids({ buildType: "cone", grid, rotation: 0 });
    const path = walk({ x: 0, z: cs / 2 + 1 }, { x: 0, z: -1 }, 70, cone);
    const peak = path.reduce((a, b) => (b.y > a.y ? b : a));
    expect(peak.y).toBeGreaterThan(CONE_PEAK_HEIGHT - 0.3);
    expect(Math.abs(peak.z)).toBeLessThan(1);
    const end = path.at(-1)!;
    expect(end.z).toBeLessThan(-cs / 2 - RADIUS);
    expect(end.y).toBe(0);
  });

  it("a canonical half edit opens a ground-level lane through the cone; reset restores the climb", () => {
    const half = structureCuboids({ buildType: "cone", grid, rotation: 0, editGrid: { kind: "floor_cone", tiles: [false, true, false, true] } });
    // Retained right column: three merged boxes per band + one apex cap.
    expect(half).toHaveLength((CONE_LEVELS - 1) * 3 + 1);
    for (const c of half) expect(c.center.x - c.halfExtents.x).toBeGreaterThanOrEqual(-1e-9);
    const lane = walk({ x: -cs / 4, z: cs / 2 + 1 }, { x: 0, z: -1 }, 60, half);
    expect(Math.max(...lane.map((p) => p.y))).toBe(0);
    expect(lane.at(-1)!.z).toBeLessThan(-cs / 2 - RADIUS);
    const kept = walk({ x: cs / 4, z: cs / 2 + 1 }, { x: 0, z: -1 }, 70, half);
    expect(Math.max(...kept.map((p) => p.y))).toBeGreaterThan(CONE_PEAK_HEIGHT / 2);
    const reset = structureCuboids({ buildType: "cone", grid, rotation: 0, editGrid: { kind: "floor_cone", tiles: [true, true, true, true] } });
    expect(reset).toEqual(structureCuboids({ buildType: "cone", grid, rotation: 0 }));
    expect(Math.max(...walk({ x: -cs / 4, z: cs / 2 + 1 }, { x: 0, z: -1 }, 70, reset).map((p) => p.y))).toBeGreaterThan(CONE_PEAK_HEIGHT / 2);
  });

  it("never exceeds MAX_STRUCTURE_CUBOIDS for any floor_cone edit", () => {
    for (let mask = 0; mask < 16; mask++) {
      const tiles = [0, 1, 2, 3].map((i) => Boolean(mask & (1 << i)));
      expect(structureCuboids({ buildType: "cone", grid, rotation: 0, editGrid: { kind: "floor_cone", tiles } }).length)
        .toBeLessThanOrEqual(MAX_STRUCTURE_CUBOIDS.cone);
    }
  });
});

describe("cone roof shell: hollow, watertight, honest headroom", () => {
  const grid = { x: 0, y: 0, z: 0 };
  const cone = structureCuboids({ buildType: "cone", grid, rotation: 0 });
  const shellVolume = (cuboids: StructureCuboid[]) =>
    cuboids.reduce((v, c) => v + 8 * c.halfExtents.x * c.halfExtents.y * c.halfExtents.z, 0);

  it("is a thin shell, not a filled pyramid (< 40% of the stepped-pyramid volume)", () => {
    let filled = 0;
    for (let j = 0; j < CONE_LEVELS; j++) {
      const s = (cs / 2) * (CONE_LEVELS - j) / CONE_LEVELS;
      filled += (2 * s) ** 2 * CONE_RISE;
    }
    expect(shellVolume(cone)).toBeLessThan(0.4 * filled);
  });

  it("blocks horizontal sightlines at EVERY height under the peak — no leaks through step creases", () => {
    // The band windows [top−T, top] tile the full column [0, PEAK] because
    // T ≥ rise, so a horizontal ray at any height hits the outer band face.
    for (const y of [0.01, 0.06, 0.13, 0.25, 0.5, 0.9, 1.0, 1.2, 1.43, 1.56, 1.67, 1.81, 1.91]) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const from = { x: -dx * (cs / 2 + 1.5), y, z: -dz * (cs / 2 + 1.5) };
        // Near the peak the silhouette face is close to the axis — give the
        // ray enough reach to traverse the whole cell.
        expect(rayStructureIntersection(from, { x: dx, y: 0, z: dz }, cs + 2, cone)).not.toBeNull();
      }
    }
    // Above the peak (and below the ground plane) there is nothing to hit.
    expect(rayStructureIntersection({ x: -cs, y: CONE_PEAK_HEIGHT + 0.01, z: 0 }, { x: 1, y: 0, z: 0 }, cs * 2, cone)).toBeNull();
  });

  it("encloses the roof interior: no upward ray escapes the hollow cavity", () => {
    // Every direction with a non-negative vertical component started inside
    // the cavity must cross shell material (the only opening is the bottom,
    // deliberately open to the ground the cone sits on).
    const from = { x: 0, y: 1.0, z: 0 };
    const dirs: { x: number; y: number; z: number }[] = [];
    for (let a = -1; a <= 1; a++) for (let b = 0; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      if (a === 0 && b === 0 && c === 0) continue;
      const n = Math.hypot(a, b, c);
      dirs.push({ x: a / n, y: b / n, z: c / n });
    }
    // Plus deterministic pseudo-random directions (LCG) to probe off-lattice escapes.
    let seed = 42;
    for (let k = 0; k < 500; k++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const u = seed / 2147483648;
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const v = seed / 2147483648;
      const phi = u * Math.PI * 2, cosT = v; // v ∈ [0,1): upper hemisphere and horizon
      dirs.push({ x: Math.cos(phi) * Math.sqrt(1 - cosT * cosT), y: cosT, z: Math.sin(phi) * Math.sqrt(1 - cosT * cosT) });
    }
    for (const d of dirs) {
      expect(rayStructureIntersection(from, d, 30, cone)).not.toBeNull();
    }
  });

  it("removes ALL volume for the empty edit (an edited-away cone is no longer a solid at all)", () => {
    expect(structureCuboids({ buildType: "cone", grid, rotation: 0, editGrid: { kind: "floor_cone", tiles: [false, false, false, false] } })).toEqual([]);
  });

  // Capsule (r, total height) standing on the ground under a shell: exact
  // segment-AABB test — a cuboid blocks iff its distance to the capsule's
  // core segment is under r.
  const capsuleBlocked = (cuboids: StructureCuboid[], x: number, z: number, height: number, r = 0.35) =>
    cuboids.some((c) => {
      const dx = Math.max(c.center.x - c.halfExtents.x - x, 0, x - (c.center.x + c.halfExtents.x));
      const dz = Math.max(c.center.z - c.halfExtents.z - z, 0, z - (c.center.z + c.halfExtents.z));
      const y0 = c.center.y - c.halfExtents.y, y1 = c.center.y + c.halfExtents.y;
      const dy = y1 < r ? r - y1 : y0 > height - r ? y0 - (height - r) : 0;
      return dx * dx + dz * dz + dy * dy < r * r;
    });

  it("gives an elevated cone a full standing attic (1.8 m capsule fits anywhere in the footprint)", () => {
    const raised = structureCuboids({ buildType: "cone", grid: { x: 0, y: 1, z: 0 }, rotation: 0 });
    // Honest clearance: the shell's lowest material is the layer base itself.
    expect(Math.min(...raised.map((c) => c.center.y - c.halfExtents.y))).toBeGreaterThanOrEqual(lh - 1e-9);
    for (const x of [0, 1.28, -1.28, 2.2, -2.2]) for (const z of [0, 1.28, -1.28, 2.2, -2.2]) {
      expect(capsuleBlocked(raised, x, z, 1.8)).toBe(false);
    }
    // And a standing capsule can actually WALK the footprint at ground level.
    const path = walk({ x: -cs / 2 - 1, z: 0 }, { x: 1, z: 0 }, 60, raised);
    expect(path.at(-1)!.x).toBeGreaterThan(cs / 2 + RADIUS);
    expect(Math.max(...path.map((p) => p.y))).toBe(0);
  });

  it("gives a ground cone a crouch-only attic under the apex (documented honest pitch)", () => {
    // Crouched (1.2 m) fits under the upper shell at the apex — with room.
    expect(capsuleBlocked(cone, 0, 0, 1.2)).toBe(false);
    // Standing (1.8 m) under a 1.92 m PEAK minus a 0.24 m shell cannot fit:
    // the peak is simply lower than a standing player. This is the honest
    // physical consequence of the documented 3:4 roof pitch.
    expect(capsuleBlocked(cone, 0, 0, 1.8)).toBe(true);
    // Away from the apex even crouching is blocked by the shell sides — the
    // attic is a real, small, readable space, not a phantom full room.
    expect(capsuleBlocked(cone, cs / 4, 0, 1.2)).toBe(true);
  });
});

// ─── Solid-wall embedment (video 2: climbing into a wall, walking through) ──

describe("embedded in a solid wall: push out, never walk through", () => {
  /** A capsule INSIDE a panel (self-built wall, or a window edited shut)
   *  walking forward must come out flush at a face — the pre-fix resolver
   *  had no directional clamp once BOTH horizontal axes overlapped, so the
   *  capsule simply kept walking through the wall. */
  it("a capsule embedded in a solid wall is pushed flush to the nearer face", () => {
    const wall = structureCuboids({ buildType: "wall", grid, rotation: 1 });
    const box = wall[0]!;
    const flushLow = box.center.x - box.halfExtents.x - RADIUS;
    const flushHigh = box.center.x + box.halfExtents.x + RADIUS;
    // Invalid state: standing inside the panel, stepping +X through it.
    const embedded = { x: box.center.x, y: 0, z: box.center.z, velocityY: 0, grounded: true };
    const resolved = resolveStructureMovement(
      embedded,
      { x: embedded.x + 0.2, y: 0, z: box.center.z, velocityY: 0, grounded: true },
      wall, RADIUS, HEIGHT,
    );
    const onAFace = Math.abs(resolved.x - flushLow) < 1e-9 || Math.abs(resolved.x - flushHigh) < 1e-9;
    expect(onAFace, `resolved.x = ${resolved.x}`).toBe(true);
    // Deterministic: the push is by geometry (the shallower face from the
    // step's position), not by which way the player is walking.
    expect(resolved.x).toBe(flushHigh);
  });

  it("several embedded steps walk OUT of the wall, never through it", () => {
    const wall = structureCuboids({ buildType: "wall", grid, rotation: 1 });
    const box = wall[0]!;
    const flushHigh = box.center.x + box.halfExtents.x + RADIUS;
    let pose = { x: box.center.x + 0.1, y: 0, z: box.center.z, velocityY: 0, grounded: true };
    for (let i = 0; i < 5; i++) {
      pose = resolveStructureMovement(
        pose, { x: pose.x + 0.2, y: 0, z: box.center.z, velocityY: 0, grounded: true },
        wall, RADIUS, HEIGHT,
      );
      // Never allowed to sit free INSIDE the panel band.
      const inside = pose.x > box.center.x - box.halfExtents.x - RADIUS + 1e-9
        && pose.x < box.center.x + box.halfExtents.x + RADIUS - 1e-9;
      expect(inside, `tick ${i}: x = ${pose.x}`).toBe(false);
    }
    expect(pose.x).toBeGreaterThanOrEqual(flushHigh - 1e-9); // ejected +X, the faced direction
  });

  it("editing a wall window shut around a crouched player pushes them out", () => {
    // Crouched player standing inside the 1.28 m window of a rot-0 wall…
    const doorway = structureCuboids({ buildType: "wall", grid, rotation: 0,
      editGrid: { kind: "wall", tiles: [true, true, true, true, true, true, true, false, true] } });
    const inWindow = { x: 0, y: 0, z: PZ, velocityY: 0, grounded: true };
    expect(resolveStructureMovement(inWindow, { ...inWindow, z: PZ + 0.2, velocityY: 0, grounded: true }, doorway, RADIUS, 1.2).z)
      .toBe(PZ + 0.2); // the window is passable: no embedment, no push
    // …then the window is edited shut. The panel now covers the whole capsule.
    const shut = structureCuboids({ buildType: "wall", grid, rotation: 0 });
    const resolved = resolveStructureMovement(inWindow, { ...inWindow, z: PZ + 0.2, velocityY: 0, grounded: true }, shut, RADIUS, 1.2);
    const panel = shut[0]!;
    const flushLow = panel.center.z - panel.halfExtents.z - RADIUS;
    const flushHigh = panel.center.z + panel.halfExtents.z + RADIUS;
    const onAFace = Math.abs(resolved.z - flushLow) < 1e-9 || Math.abs(resolved.z - flushHigh) < 1e-9;
    expect(onAFace, `resolved.z = ${resolved.z}`).toBe(true);
  });

  it("walking into a wall from outside still stops flush at the near face (never embeds)", () => {
    const wall = structureCuboids({ buildType: "wall", grid, rotation: 1 });
    const limit = wall[0]!.center.x - wall[0]!.halfExtents.x - RADIUS;
    for (const pose of walk({ x: PX - 2, z: 0 }, { x: 1, z: 0 }, 20, wall)) {
      expect(pose.x, `x = ${pose.x}`).toBeLessThanOrEqual(limit + 1e-9);
    }
  });

  it("climbing a ramp never triggers the embedment push (plates cannot cover the capsule)", () => {
    const ramp = structureCuboids({ buildType: "ramp", grid, rotation: 0 });
    const path = walk({ x: -cs / 2 + 0.4, z: 0 }, { x: 1, z: 0 }, 20, ramp);
    // A real climb…
    expect(path.at(-1)!.y).toBeGreaterThan(2.5);
    // …and no teleport: every tick advances at most one movement step in X
    // (a spurious push-out would jump the capsule by metres).
    for (let i = 1; i < path.length; i++) {
      expect(Math.abs(path[i]!.x - path[i - 1]!.x), `tick ${i}`).toBeLessThanOrEqual(0.2 + 1e-9);
      expect(path[i]!.y, `tick ${i} downhill slip`).toBeGreaterThanOrEqual(path[i - 1]!.y - 0.07);
    }
  });
});

