import { describe, expect, it } from "vitest";
import { CONE_LEVELS, MAX_STRUCTURE_CUBOIDS, RAMP_STEPS, rayStructureIntersection, resolveStructureMovement, structureCuboids, type StructureCuboid } from "./editGeometry.js";
import { BUILD_GRID } from "./building.js";

const grid = { x: 0, y: 0, z: 0 };
const forward = { x: 0, y: 0, z: 1 };

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
    const previous = { x: 0, y: 0, z: -1, velocityY: 0, grounded: true };
    const next = { ...previous, z: 0 };
    expect(resolveStructureMovement(previous, next, opening, 0.35, 1.2).z).toBe(0);
    expect(resolveStructureMovement(previous, next, opening, 0.35, 1.8).z).toBeLessThan(-0.7);
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
        { x, y: 0, z: -1, velocityY: 0, grounded: true },
        { x, y: 0, z: 0, velocityY: 0, grounded: true },
        solids,
        0.35,
        height,
      );

    expect(cross(0, 1.2, full).z).toBeLessThan(-0.7);
    expect(cross(0, 1.2).z).toBe(0);
    expect(cross(0, 1.8).z).toBeLessThan(-0.7);
    expect(cross(-1.5, 1.2).z).toBeLessThan(-0.7);
    expect(cross(1.5, 1.2).z).toBeLessThan(-0.7);
    expect(cross(0, 1.2, reset).z).toBeLessThan(-0.7);
  });

  it("rotates the same doorway traversal and side blockers with the wall", () => {
    const doorway = structureCuboids({ buildType: "wall", grid, rotation: 1,
      editGrid: { kind: "wall", tiles: [true, true, true, true, true, true, true, false, true] } });
    const cross = (z: number) => resolveStructureMovement(
      { x: -1, y: 0, z, velocityY: 0, grounded: true },
      { x: 0, y: 0, z, velocityY: 0, grounded: true },
      doorway,
      0.35,
      1.2,
    );
    expect(cross(0).x).toBe(0);
    expect(cross(-1.5).x).toBeLessThan(-0.7);
    expect(cross(1.5).x).toBeLessThan(-0.7);
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
  // Footprint: anchor cell and the next cell along the positive axis.
  const center = alongX ? { x: cs / 2, z: 0 } : { x: 0, z: cs / 2 };
  return { up, left, center };
}

describe("canonical ramp: one full layer, width halves", () => {
  const grid = { x: 0, y: 0, z: 0 };
  const top = (cuboids: StructureCuboid[]) => Math.max(...cuboids.map((c) => c.center.y + c.halfExtents.y));

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
    const floorGrid = { x: Math.round((center.x + up.x * 1.5 * cs) / cs), y: 1, z: Math.round((center.z + up.z * 1.5 * cs) / cs) };
    const floor = structureCuboids({ buildType: "floor", grid: floorGrid, rotation: 0 });
    const floorTop = lh + 0.15;
    const start = { x: center.x - up.x * (cs + 1), z: center.z - up.z * (cs + 1) };
    const path = walk(start, up, 75, [...ramp, ...floor]);
    const end = path.at(-1)!;
    expect(end.y).toBeCloseTo(floorTop, 6);
    // On the floor: past the ramp's high end, over the floor footprint.
    expect((end.x - center.x) * up.x + (end.z - center.z) * up.z).toBeGreaterThan(cs);
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
      const lane = (side: number) => ({ x: center.x - up.x * (cs + 1) + left.x * side * cs / 4, z: center.z - up.z * (cs + 1) + left.z * side * cs / 4 });
      const kept = walk(lane(sign), up, 60, half);
      expect(Math.max(...kept.map((p) => p.y))).toBeCloseTo(lh, 6);
      const removed = walk(lane(-sign), up, 60, half);
      expect(Math.max(...removed.map((p) => p.y))).toBe(0);
    }
  });

  it.each([0, 1, 2, 3])("rotation %i: flipped reverses which end is high", (rotation) => {
    const { up, center } = rampFrame(rotation, false);
    const highEnd = (cuboids: StructureCuboid[]) => {
      const c = cuboids.reduce((a, b) => (a.halfExtents.y > b.halfExtents.y ? a : b));
      return (c.center.x - center.x) * up.x + (c.center.z - center.z) * up.z;
    };
    expect(highEnd(structureCuboids({ buildType: "ramp", grid, rotation }))).toBeGreaterThan(0);
    expect(highEnd(structureCuboids({ buildType: "ramp", grid, rotation, editGrid: { kind: "ramp", variant: "flipped" } }))).toBeLessThan(0);
  });
});

describe("canonical cone: climbable stepped pyramid", () => {
  const grid = { x: 0, y: 0, z: 0 };

  it("is a stepped pyramid rising one layer within the step-up", () => {
    const cone = structureCuboids({ buildType: "cone", grid, rotation: 0 });
    expect(cone).toHaveLength(CONE_LEVELS);
    for (const [j, c] of cone.entries()) {
      expect(c.center.y - c.halfExtents.y).toBeCloseTo(j * lh / CONE_LEVELS, 9);
      expect(c.halfExtents.y * 2).toBeLessThan(0.34);
      expect(c.halfExtents.x).toBeCloseTo((cs / 2) * (CONE_LEVELS - j) / CONE_LEVELS, 9);
    }
    expect(Math.max(...cone.map((c) => c.center.y + c.halfExtents.y))).toBeCloseTo(lh, 9);
  });

  it("real walking climbs over the apex and down the far side", () => {
    const cone = structureCuboids({ buildType: "cone", grid, rotation: 0 });
    const path = walk({ x: 0, z: cs / 2 + 1 }, { x: 0, z: -1 }, 70, cone);
    const peak = path.reduce((a, b) => (b.y > a.y ? b : a));
    expect(peak.y).toBeGreaterThan(lh - 0.5);
    expect(Math.abs(peak.z)).toBeLessThan(1);
    const end = path.at(-1)!;
    expect(end.z).toBeLessThan(-cs / 2 - RADIUS);
    expect(end.y).toBe(0);
  });

  it("a canonical half edit opens a ground-level lane through the cone; reset restores the climb", () => {
    const half = structureCuboids({ buildType: "cone", grid, rotation: 0, editGrid: { kind: "floor_cone", tiles: [false, true, false, true] } });
    expect(half).toHaveLength(CONE_LEVELS);
    for (const c of half) expect(c.center.x - c.halfExtents.x).toBeCloseTo(0, 9);
    const lane = walk({ x: -cs / 4, z: cs / 2 + 1 }, { x: 0, z: -1 }, 60, half);
    expect(Math.max(...lane.map((p) => p.y))).toBe(0);
    expect(lane.at(-1)!.z).toBeLessThan(-cs / 2 - RADIUS);
    const kept = walk({ x: cs / 4, z: cs / 2 + 1 }, { x: 0, z: -1 }, 70, half);
    expect(Math.max(...kept.map((p) => p.y))).toBeGreaterThan(lh / 2);
    const reset = structureCuboids({ buildType: "cone", grid, rotation: 0, editGrid: { kind: "floor_cone", tiles: [true, true, true, true] } });
    expect(reset).toEqual(structureCuboids({ buildType: "cone", grid, rotation: 0 }));
    expect(Math.max(...walk({ x: -cs / 4, z: cs / 2 + 1 }, { x: 0, z: -1 }, 70, reset).map((p) => p.y))).toBeGreaterThan(lh / 2);
  });

  it("never exceeds MAX_STRUCTURE_CUBOIDS for any floor_cone edit", () => {
    for (let mask = 1; mask < 16; mask++) {
      const tiles = [0, 1, 2, 3].map((i) => Boolean(mask & (1 << i)));
      expect(structureCuboids({ buildType: "cone", grid, rotation: 0, editGrid: { kind: "floor_cone", tiles } }).length)
        .toBeLessThanOrEqual(MAX_STRUCTURE_CUBOIDS.cone);
    }
  });
});

