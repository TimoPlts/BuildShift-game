/**
 * Surface-aware build targeting (shared `resolveSurfacePlacement`): real aim
 * rays against canonical geometry → hit face → the slot to build FROM it.
 */
import { describe, expect, it } from "vitest";
import { BUILD_GRID, facingPlacementRotation, quarterTurnFromYaw, slotsConflict, structureSlots, wallEdgeForOrientation } from "./building.js";
import type { StructureGeometryInput } from "./editGeometry.js";
import { raycastStructureSurface, resolveSurfacePlacement, rampHighDirection } from "./surfacePlacement.js";

const cs = BUILD_GRID.cellSize;
const lh = BUILD_GRID.layerHeight;
type V = { x: number; y: number; z: number };
const norm = (v: V): V => { const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const piece = (buildType: StructureGeometryInput["buildType"], grid: V, rotation = 0, editGrid?: StructureGeometryInput["editGrid"]): StructureGeometryInput =>
  ({ buildType, grid, rotation, ...(editGrid ? { editGrid } : {}) });

/** Aim from `eye` at `target`; resolve against `structures` for `buildType`. */
function aim(structures: StructureGeometryInput[], eye: V, target: V, buildType: string, selectedRotation = 0) {
  const dir = norm({ x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z });
  const hit = raycastStructureSurface(eye, dir, 40, structures);
  expect(hit, "the aim ray must hit a structure").not.toBeNull();
  return { hit: hit!, ...resolveSurfacePlacement(hit!, buildType, selectedRotation, dir) };
}

describe("shared raycast reports the hit face", () => {
  it("returns the outward normal of the entered face", () => {
    const wall = piece("wall", { x: 0, y: 0, z: 0 }, 0); // −Z edge panel at z = −2.56
    const front = raycastStructureSurface({ x: 0, y: 1, z: -10 }, { x: 0, y: 0, z: 1 }, 40, [wall])!;
    expect(front.normal).toEqual({ x: 0, y: 0, z: -1 });
    const topHit = raycastStructureSurface({ x: 0, y: 8, z: -cs / 2 }, { x: 0, y: -1, z: 0 }, 40, [wall])!;
    expect(topHit.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(topHit.point.y).toBeCloseTo(lh, 9);
  });
});

describe("walls: stacking and continuing", () => {
  // Wall on the −Z edge of tile (0,0,0); the player stands south of it (z < −2.56) facing +Z.
  const wall = piece("wall", { x: 0, y: 0, z: 0 }, 0);
  const eye = { x: 0, y: 2.5, z: -9 };

  it("the top face → a wall on the same edge one layer up", () => {
    const r = aim([wall], { x: 0.5, y: 7, z: -6 }, { x: 0.5, y: lh, z: -cs / 2 }, "wall");
    expect(r.hit.normal.y).toBe(1);
    expect([r.grid, r.rotation]).toEqual([{ x: 0, y: 1, z: 0 }, 0]);
  });

  it("the upper third of its face → the wall above (no sky aiming needed)", () => {
    const r = aim([wall], eye, { x: 0.3, y: lh * 0.8, z: -cs / 2 }, "wall");
    expect([r.grid, r.rotation]).toEqual([{ x: 0, y: 1, z: 0 }, 0]);
  });

  it("stacks repeatedly: wall → wall above → wall above again, each a distinct slot", () => {
    const stack = [wall];
    for (let layer = 1; layer <= 2; layer++) {
      const top = stack[stack.length - 1]!;
      const r = aim(stack, { x: 0, y: layer * lh + 1, z: -10 }, { x: 0, y: (layer - 1) * lh + lh * 0.85, z: -cs / 2 }, "wall");
      expect([r.grid, r.rotation]).toEqual([{ x: 0, y: layer, z: 0 }, 0]);
      expect(slotsConflict({ buildType: "wall", grid: r.grid, rotation: r.rotation }, top)).toBe(false);
      stack.push(piece("wall", r.grid, r.rotation));
    }
    const slots = stack.flatMap((s) => structureSlots(s.buildType, s.grid, s.rotation));
    expect(new Set(slots).size).toBe(3);
    expect(slots).toEqual(["wall-z:0,0,0", "wall-z:0,1,0", "wall-z:0,2,0"]);
  });

  it("the lower face's outer quarters → the wall continues left / right on the same edge line", () => {
    expect(aim([wall], eye, { x: -1.9, y: 1, z: -cs / 2 }, "wall").grid).toEqual({ x: -1, y: 0, z: 0 });
    expect(aim([wall], eye, { x: 1.9, y: 1, z: -cs / 2 }, "wall").grid).toEqual({ x: 1, y: 0, z: 0 });
    const centre = aim([wall], eye, { x: 0, y: 1, z: -cs / 2 }, "wall");
    expect([centre.grid, centre.rotation]).toEqual([{ x: 0, y: 0, z: 0 }, 0]); // the same slot: occupied → invalid
  });

  it("a floor from the wall's top extends outward (in the aim direction), one layer up", () => {
    expect(aim([wall], eye, { x: 0, y: lh * 0.9, z: -cs / 2 }, "floor").grid).toEqual({ x: 0, y: 1, z: 0 });
    // From the other side, facing −Z, the floor goes to the south tile.
    expect(aim([wall], { x: 0, y: 2.5, z: 6 }, { x: 0, y: lh * 0.9, z: -cs / 2 }, "floor").grid).toEqual({ x: 0, y: 1, z: -1 });
  });

  it.each([
    [0, { x: 0, y: 1, z: -9 }, { x: 0, y: 0, z: -1 }], // −Z edge, hit from the south → the south tile
    [0, { x: 0, y: 1, z: 6 }, { x: 0, y: 0, z: 0 }],
    [1, { x: 9, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }], // +X edge, hit from the east → the east tile
    [1, { x: -6, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }],
    [2, { x: 0, y: 1, z: 9 }, { x: 0, y: 0, z: 1 }], // +Z edge
    [2, { x: 0, y: 1, z: -6 }, { x: 0, y: 0, z: 0 }],
    [3, { x: -9, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }], // −X edge
    [3, { x: 6, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }],
  ] as const)("wall r%i: a ramp / cone / floor against its lower face goes to the tile on the hit side", (rotation, eye2, tile) => {
    const w = piece("wall", { x: 0, y: 0, z: 0 }, rotation);
    const edge = [[0, -1], [1, 0], [0, 1], [-1, 0]][rotation]!;
    const target = { x: edge[0]! * cs / 2, y: 1, z: edge[1]! * cs / 2 };
    for (const type of ["floor", "ramp", "cone"]) expect(aim([w], eye2, target, type).grid, type).toEqual(tile);
  });
});

describe("floors: air chains and walls on edges", () => {
  // A floor at layer 1 (in the air) the player stands on, looking at its outer parts.
  const floor = piece("floor", { x: 0, y: 1, z: 0 });
  const eye = { x: 0, y: lh + 3, z: -4 };

  it.each([
    [{ x: 0, z: 2.2 }, { x: 0, y: 1, z: 1 }],
    [{ x: 2.2, z: 0.3 }, { x: 1, y: 1, z: 0 }],
    [{ x: -2.2, z: 0.3 }, { x: -1, y: 1, z: 0 }],
    [{ x: 0.2, z: -2.2 }, { x: 0, y: 1, z: -1 }],
  ])("floor edge near %o → the neighbouring air floor", (t, tile) => {
    expect(aim([floor], eye, { x: t.x, y: lh + 0.15, z: t.z }, "floor").grid).toEqual(tile);
  });

  it("chains: each new air floor is the next surface (several tiles out)", () => {
    const chain = [floor];
    for (let z = 1; z <= 3; z++) {
      const r = aim(chain, { x: 0, y: lh + 3, z: (z - 1) * cs - 3 }, { x: 0, y: lh + 0.15, z: (z - 1) * cs + 2.2 }, "floor");
      expect(r.grid).toEqual({ x: 0, y: 1, z });
      chain.push(piece("floor", r.grid));
    }
  });

  it("a wall from a floor goes on the targeted edge, standing on it", () => {
    const r = aim([floor], eye, { x: 0.3, y: lh + 0.15, z: 2.2 }, "wall");
    expect([r.grid, r.rotation]).toEqual([{ x: 0, y: 1, z: 0 }, 2]);
    const left = aim([floor], eye, { x: -2.2, y: lh + 0.15, z: 0.4 }, "wall");
    expect([left.grid, left.rotation]).toEqual([{ x: 0, y: 1, z: 0 }, 3]);
  });

  it("a ramp or cone from a floor's top takes that tile's own (separate) slot", () => {
    expect(aim([floor], eye, { x: 0.5, y: lh + 0.15, z: 1 }, "ramp", 1)).toMatchObject({ grid: { x: 0, y: 1, z: 0 }, rotation: 1 });
    expect(aim([floor], eye, { x: 0.5, y: lh + 0.15, z: 1 }, "cone").grid).toEqual({ x: 0, y: 1, z: 0 });
  });
});

describe("ramps: continuing up and boxing in", () => {
  // Ramp rising toward +Z (rotation 1) on tile (0,0,0); the player climbs it facing +Z.
  const ramp = piece("ramp", { x: 0, y: 0, z: 0 }, 1);
  const eye = { x: 0.4, y: 4.5, z: -5 };

  it("the high end → a floor at the next layer past the high end", () => {
    expect(aim([ramp], eye, { x: 0.4, y: lh * 0.85, z: 1.8 }, "floor").grid).toEqual({ x: 0, y: 1, z: 1 });
    // The low half → a floor over the ramp's own tile.
    expect(aim([ramp], { x: 0.4, y: 6, z: -6 }, { x: 0.4, y: lh * 0.2, z: -1.8 }, "floor").grid).toEqual({ x: 0, y: 1, z: 0 });
  });

  it("→ the next ramp, one layer up past the high end, rising the same way (whatever rotation is selected)", () => {
    const r = aim([ramp], eye, { x: 0.4, y: lh * 0.85, z: 1.8 }, "ramp", 3);
    expect([r.grid, r.rotation]).toEqual([{ x: 0, y: 1, z: 1 }, 1]);
    // And from that one, again.
    const next = aim([ramp, piece("ramp", r.grid, r.rotation)], { x: 0.4, y: lh + 4.5, z: 0 }, { x: 0.4, y: lh + lh * 0.85, z: cs + 1.8 }, "ramp");
    expect([next.grid, next.rotation]).toEqual([{ x: 0, y: 2, z: 2 }, 1]);
  });

  it.each([0, 1, 2, 3])("rotation %i continues toward its own high end", (rotation) => {
    const rp = piece("ramp", { x: 0, y: 0, z: 0 }, rotation);
    const [hx, hz] = rampHighDirection(rp);
    const target = { x: hx * 1.8 + hz * 0.4, y: lh, z: hz * 1.8 + hx * 0.4 };
    const r = aim([rp], { x: target.x - hx * 6, y: 6, z: target.z - hz * 6 }, target, "ramp");
    expect([r.grid, r.rotation]).toEqual([{ x: hx, y: 1, z: hz }, rotation]);
  });

  it("a flipped ramp continues toward its (reversed) high end", () => {
    const flipped = piece("ramp", { x: 0, y: 0, z: 0 }, 1, { kind: "ramp", variant: "flipped" });
    expect(rampHighDirection(flipped)).toEqual([0, -1]);
    const r = aim([flipped], { x: 0.4, y: 6, z: 4 }, { x: 0.4, y: lh * 0.85, z: -1.8 }, "ramp");
    expect([r.grid, r.rotation]).toEqual([{ x: 0, y: 1, z: -1 }, 3]);
  });

  it("ramp box: aiming at the ramp near each side puts a wall on that edge — all four coexist with it", () => {
    const targets: [V, number][] = [
      [{ x: 0.3, y: 1.0, z: -2.1 }, 0],
      [{ x: 2.2, y: 2.0, z: 0.2 }, 1],
      [{ x: -0.3, y: 3.4, z: 2.1 }, 2],
      [{ x: -2.2, y: 2.0, z: -0.2 }, 3],
    ];
    const walls: StructureGeometryInput[] = [];
    for (const [t, edge] of targets) {
      const r = aim([ramp], { x: t.x * 0.2, y: 8, z: t.z * 0.2 - 1 }, t, "wall");
      expect([r.grid, r.rotation], `edge ${edge}`).toEqual([{ x: 0, y: 0, z: 0 }, edge]);
      walls.push(piece("wall", r.grid, r.rotation));
    }
    for (const w of walls) expect(slotsConflict(w, ramp)).toBe(false);
    expect(new Set(walls.flatMap((w) => structureSlots("wall", w.grid, w.rotation))).size).toBe(4);
  });
});

describe("cones", () => {
  const cone = piece("cone", { x: 0, y: 0, z: 0 });
  it("a wall goes on the cone tile's edge nearest the hit; a floor on its upper half goes above it", () => {
    const r = aim([cone], { x: 0, y: 6, z: -8 }, { x: 0.2, y: 0.5, z: -2.3 }, "wall");
    expect([r.grid, r.rotation]).toEqual([{ x: 0, y: 0, z: 0 }, 0]);
    expect(aim([cone], { x: 0, y: 8, z: -2 }, { x: 0, y: lh, z: 0 }, "floor").grid).toEqual({ x: 0, y: 1, z: 0 });
  });
  it("a floor against its side goes to the neighbouring tile on that side", () => {
    expect(aim([cone], { x: -9, y: 0.3, z: 0.2 }, { x: 0, y: 0.1, z: 0.2 }, "floor").grid).toEqual({ x: -1, y: 0, z: 0 });
  });
});

describe("edited pieces", () => {
  it("an aim through an edited-out wall tile does not hit the wall", () => {
    const tiles = Array(9).fill(true);
    tiles[4] = false; // centre window
    const wall = piece("wall", { x: 0, y: 0, z: 0 }, 0, { kind: "wall", tiles });
    expect(raycastStructureSurface({ x: 0, y: lh / 2, z: -9 }, { x: 0, y: 0, z: 1 }, 40, [wall])).toBeNull();
  });
});

describe("equip-facing orientation (shared)", () => {
  const H = Math.PI / 2;
  it("maps the four cardinal facings to a quarter turn (yaw 0 = −Z, +π/2 = +X, π = +Z, −π/2 = −X)", () => {
    expect([0, H, Math.PI, -H].map(quarterTurnFromYaw)).toEqual([0, 1, 2, 3]);
    expect(quarterTurnFromYaw(-Math.PI)).toBe(2); // the ±π wrap is one direction
    expect(quarterTurnFromYaw(2 * Math.PI + H)).toBe(1); // any winding
  });
  it("is deterministic around each cardinal (±44°) and at the exact diagonals", () => {
    const d = (44 * Math.PI) / 180;
    for (const [yaw, q] of [[0, 0], [H, 1], [Math.PI, 2], [-H, 3]] as const) {
      expect([quarterTurnFromYaw(yaw - d), quarterTurnFromYaw(yaw + d)]).toEqual([q, q]);
    }
    expect(quarterTurnFromYaw(Math.PI / 4)).toBe(quarterTurnFromYaw(Math.PI / 4)); // stable
    expect(quarterTurnFromYaw(-0.0)).toBe(0);
  });
  it("walls face the edge ahead; ramps rise away from the player; floors / cones are rotation-invariant", () => {
    // Facing north (−Z): wall on the −Z edge (0), ramp rising −Z (3).
    expect([0, H, Math.PI, -H].map((y) => facingPlacementRotation("wall", y))).toEqual([0, 1, 2, 3]);
    expect([0, H, Math.PI, -H].map((y) => facingPlacementRotation("ramp", y))).toEqual([3, 0, 1, 2]);
    for (const y of [0, H, Math.PI, -H]) expect([facingPlacementRotation("floor", y), facingPlacementRotation("cone", y)]).toEqual([0, 0]);
    // The ramp's high end is in the facing direction.
    for (const [yaw, dir] of [[0, [0, -1]], [H, [1, 0]], [Math.PI, [0, 1]], [-H, [-1, 0]]] as const) {
      expect(rampHighDirection({ buildType: "ramp", grid: { x: 0, y: 0, z: 0 }, rotation: facingPlacementRotation("ramp", yaw) })).toEqual(dir);
    }
  });
  it("a locked wall orientation only picks the nearer parallel edge", () => {
    expect([wallEdgeForOrientation({ x: 0, y: 0, z: 0 }, 0.4, -1, 0), wallEdgeForOrientation({ x: 0, y: 0, z: 0 }, 0.4, 1, 0)]).toEqual([0, 2]);
    expect([wallEdgeForOrientation({ x: 0, y: 0, z: 0 }, -1, 2.4, 1), wallEdgeForOrientation({ x: 0, y: 0, z: 0 }, 1, 2.4, 3)]).toEqual([3, 1]);
  });
});

describe("vertical stacking from surfaces (source structure grid / layer)", () => {
  it("floor above a wall box: the near wall's top → the box tile one layer up (from outside, aiming in)", () => {
    const near = piece("wall", { x: 0, y: 0, z: 0 }, 2); // the box tile (0,0,0)'s +Z edge, seen from z > 2.56
    const r = aim([near], { x: 0, y: 3.2, z: 7 }, { x: 0, y: lh - 0.1, z: cs / 2 + 0.384 }, "floor");
    expect(r.grid).toEqual({ x: 0, y: 1, z: 0 });
  });
  it("cone above an elevated floor: on that floor's tile and layer", () => {
    const floor = piece("floor", { x: 1, y: 1, z: 0 });
    expect(aim([floor], { x: cs, y: lh + 3, z: -4 }, { x: cs + 0.4, y: lh + 0.15, z: 0.6 }, "cone").grid).toEqual({ x: 1, y: 1, z: 0 });
  });
  it("ramp above a floor: on that floor's tile, keeping the equipped (selected) rotation", () => {
    const floor = piece("floor", { x: 0, y: 1, z: -1 });
    expect(aim([floor], { x: 0, y: lh + 3, z: 0 }, { x: 0.3, y: lh + 0.15, z: -cs + 0.4 }, "ramp", 2)).toMatchObject({ grid: { x: 0, y: 1, z: -1 }, rotation: 2 });
  });
  it("floor above a ramp's high end → the next layer past it; above a floor-topped wall → the next layer", () => {
    const ramp = piece("ramp", { x: 0, y: 1, z: 0 }, 1); // a ramp on layer 1
    expect(aim([ramp], { x: 0.4, y: lh + 4.5, z: -5 }, { x: 0.4, y: lh + lh * 0.85, z: 1.8 }, "floor").grid).toEqual({ x: 0, y: 2, z: 1 });
    const upper = piece("wall", { x: 0, y: 1, z: 0 }, 0);
    const r = aim([upper], { x: 0, y: lh + 2.5, z: -9 }, { x: 0.2, y: lh + lh * 0.9, z: -cs / 2 - 0.384 }, "wall");
    expect([r.grid, r.rotation]).toEqual([{ x: 0, y: 2, z: 0 }, 0]);
  });
  it("two stacked boxes: every wall / floor slot of both levels is distinct, the same x/z on another layer is a different slot", () => {
    const level = (y: number) => [0, 1, 2, 3].map((r) => piece("wall", { x: 0, y, z: 0 }, r)).concat(piece("floor", { x: 0, y: y + 1, z: 0 }));
    const all = [...level(0), ...level(1)];
    const slots = all.flatMap((s) => structureSlots(s.buildType, s.grid, s.rotation));
    expect(new Set(slots).size).toBe(slots.length);
    expect(slotsConflict(piece("wall", { x: 0, y: 1, z: 0 }, 0), piece("wall", { x: 0, y: 0, z: 0 }, 0))).toBe(false);
    expect(slotsConflict(piece("wall", { x: 0, y: 1, z: 0 }, 0), piece("wall", { x: 0, y: 1, z: -1 }, 2))).toBe(true); // same edge, same layer
  });
});
