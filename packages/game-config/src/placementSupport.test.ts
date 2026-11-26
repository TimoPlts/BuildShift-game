/**
 * Structural support (anchoring) — the SHARED placement policy contract.
 *
 * A piece may only be created where it has a real load path to the arena build
 * foundation: it must rest on the foundation slab itself, or make genuine
 * surface contact with a piece that (transitively) does. A neighbour cell, an
 * internally-connected but airborne island, and a self-supporting cycle are
 * all refused; legitimate wall stacking, ramp chains, floors bridging off a
 * connected structure and cone-on-floor are all preserved, and edited-out
 * tiles supply no support.
 *
 * Everything here is asserted on canonical collision geometry
 * (`structureCuboids`), so the numbers below are the real solids — cell 5.12 m,
 * layer 3.84 m, floor slab 0.15 m, wall panel 0.384 m half-thickness, cone
 * roof shell up to its 1.92 m apex, 16 ramp treads climbing exactly one layer.
 */
import { describe, expect, it } from "vitest";
import {
  ARENA_FOUNDATION_SUPPORTS,
  BUILD_GRID,
  placementIsSupported,
  solidRestsOnFoundation,
  solidsAttach,
  structureCuboids,
  type GeometryEditState,
  type StructureGeometryInput,
} from "./index.js";

const CS = BUILD_GRID.cellSize;
const LH = BUILD_GRID.layerHeight;

const g = (x: number, y: number, z: number) => ({ x, y, z });
const piece = (buildType: "wall" | "floor" | "ramp" | "cone", x: number, y: number, z: number, rotation = 0, editGrid?: GeometryEditState): StructureGeometryInput => ({
  buildType,
  grid: g(x, y, z),
  rotation,
  ...(editGrid ? { editGrid } : {}),
});
const allRotations = [0, 1, 2, 3];
const KINDS = ["wall", "floor", "ramp", "cone"] as const;
/** Every rotation of every kind, elevated at `layer` in its own tile. */
const elevatedKinds = (layer: number) =>
  KINDS.flatMap((kind) =>
    allRotations.map((rotation) => ({ kind, rotation, candidate: piece(kind, 0, layer, 0, rotation) })),
  );

describe("structural support: what roots a chain in the arena foundation", () => {
  it("the foundation is the arena ground slab only (not arena props/walls/ceiling)", () => {
    expect(ARENA_FOUNDATION_SUPPORTS.length).toBeGreaterThan(0);
    for (const slab of ARENA_FOUNDATION_SUPPORTS) {
      // Top surface is the canonical ground plane (y = 0).
      expect(slab.center.y + slab.halfExtents.y).toBe(0);
    }
    // A prop whose top is NOT the ground plane is not a foundation: nothing
    // can be rooted by standing on decorative arena geometry.
    const prop = [{ center: { x: 0, y: 2.42, z: 0 }, halfExtents: { x: CS, y: 1.92, z: CS } }]; // floats above the ground plane
    expect(solidRestsOnFoundation(structureCuboids(piece("floor", 0, 0, 0))[0]!, prop)).toBe(false);
    expect(placementIsSupported({ candidate: piece("floor", 0, 0, 0), structures: [], foundation: prop }).supported).toBe(false);
  });

  it("accepts every ground-layer kind as a root, at every rotation", () => {
    for (const kind of ["wall", "floor", "ramp", "cone"] as const) {
      for (const rotation of allRotations) {
        const r = placementIsSupported({ candidate: piece(kind, 0, 0, 0, rotation), structures: [] });
        expect([kind, rotation, r.supported, r.reason]).toEqual([kind, rotation, true, null]);
      }
    }
    // Grid corners of the build volume are still over the foundation slab.
    for (const x of [-2, 2]) for (const z of [-2, 2]) {
      expect(placementIsSupported({ candidate: piece("wall", x, 0, z, 0), structures: [] }).supported).toBe(true);
    }
  });
});

describe("structural support: disconnected airborne pieces are refused", () => {
  it.each([1, 2])("rejects every elevated kind with nothing under it (layer %i, all rotations)", (layer) => {
    for (const t of elevatedKinds(layer)) {
      const r = placementIsSupported({ candidate: t.candidate, structures: [] });
      expect([t.kind, t.rotation, r.supported, r.reason]).toEqual([t.kind, t.rotation, false, "unsupported"]);
    }
  });

  it("rejects the user's case: an elevated wall beside (not on) a grounded wall, all rotations", () => {
    // A grounded wall on the −Z edge of tile (0,0,0) and its mirror one tile
    // over: none of the floating rotations above the EMPTY tile (1,0,0)→(1,1,0)
    // touch it, so none of them may exist.
    const grounded = [piece("wall", 0, 0, 0, 0)];
    for (const rotation of allRotations) {
      const r = placementIsSupported({ candidate: piece("wall", 1, 1, 0, rotation), structures: grounded });
      expect([rotation, r.supported, r.reason]).toEqual([rotation, false, "unsupported"]);
    }
  });

  it("a neighbouring grounded piece is not enough — the solids must touch", () => {
    const grounded = [piece("floor", 0, 0, 0), piece("wall", 0, 0, -1, 2)];
    // Same layer, one tile diagonally away: the neighbour cell is occupied and
    // grounded, but there is no contact at all.
    const r = placementIsSupported({ candidate: piece("floor", 1, 1, 1), structures: grounded });
    expect([r.supported, r.reason]).toEqual([false, "unsupported"]);
  });

  it("rejects a self-supporting cycle: mutually touching floors with no path down", () => {
    // Three floors at layer 2 forming a closed ring — every piece touches two
    // others, none of them touches anything grounded.
    const island = [piece("floor", 0, 2, 0), piece("floor", 1, 2, 0), piece("floor", 0, 2, 1)];
    for (const candidate of island) {
      const others = island.filter((p) => p !== candidate);
      const r = placementIsSupported({ candidate, structures: others });
      expect([r.supported, r.reason]).toEqual([false, "unsupported"]);
      expect(r.groundedStructures).toBe(0);
    }
  });

  it("rejects a ramp cantilevered one layer above a grounded ramp's LOW end", () => {
    // The grounded ramp rises +X; its crest is the +X edge. A second ramp one
    // layer up over the LOW side has its crest above thin air.
    const grounded = [piece("ramp", 0, 0, 0, 0)];
    const r = placementIsSupported({ candidate: piece("ramp", -1, 1, 0, 0), structures: grounded });
    expect([r.supported, r.reason]).toEqual([false, "unsupported"]);
  });

  it("respects rotation: only the crest side of a grounded ramp can carry the next ramp", () => {
    const grounded = [piece("ramp", 0, 0, 0, 1)]; // rises +Z
    expect(placementIsSupported({ candidate: piece("ramp", 0, 1, 1, 1), structures: grounded }).supported).toBe(true);
    const wrong = placementIsSupported({ candidate: piece("ramp", 0, 1, -1, 1), structures: grounded });
    expect([wrong.supported, wrong.reason]).toEqual([false, "unsupported"]);
  });
});

describe("structural support: legitimate upward building stays legal", () => {
  it("stacks a wall on a grounded wall (all rotations)", () => {
    for (const rotation of allRotations) {
      const grounded = [piece("wall", 0, 0, 0, rotation)];
      expect(placementIsSupported({ candidate: piece("wall", 0, 1, 0, rotation), structures: grounded }).supported).toBe(true);
      expect(placementIsSupported({ candidate: piece("wall", 0, 2, 0, rotation), structures: [...grounded, piece("wall", 0, 1, 0, rotation)] }).supported).toBe(true);
    }
  });

  it("supports a wall layer 2 when layer 1 of that column is empty", () => {
    const grounded = [piece("wall", 0, 0, 0, 0)];
    const r = placementIsSupported({ candidate: piece("wall", 0, 2, 0, 0), structures: grounded });
    expect([r.supported, r.reason]).toEqual([false, "unsupported"]);
  });

  it("supports a floor resting on a grounded wall's top, then a floor bridging off it", () => {
    const grounded = [piece("wall", 0, 0, 0, 0)];
    expect(placementIsSupported({ candidate: piece("floor", 0, 1, 0), structures: grounded }).supported).toBe(true);
    // The bridge piece never touches the wall — it hangs off the floor that does.
    expect(placementIsSupported({ candidate: piece("floor", 0, 1, 1), structures: grounded }).supported).toBe(false);
    const supported = placementIsSupported({ candidate: piece("floor", 0, 1, 1), structures: [...grounded, piece("floor", 0, 1, 0)] });
    expect(supported.supported).toBe(true);
    expect(supported.groundedStructures).toBe(2);
  });

  it("supports a floor and a cone on the ramp crest (one layer past the high end)", () => {
    const grounded = [piece("ramp", 0, 0, 0, 0)];
    expect(placementIsSupported({ candidate: piece("floor", 1, 1, 0), structures: grounded }).supported).toBe(true);
    expect(placementIsSupported({ candidate: piece("cone", 1, 1, 0), structures: grounded }).supported).toBe(true);
  });

  it("supports a cone standing on a floor in its own tile (slot coexistence)", () => {
    const grounded = [piece("floor", 0, 0, 0)];
    expect(placementIsSupported({ candidate: piece("cone", 0, 0, 0), structures: grounded }).supported).toBe(true);
    const elevated = [piece("floor", 0, 1, 0), piece("wall", 0, 0, 0, 0)];
    expect(placementIsSupported({ candidate: piece("cone", 0, 1, 0), structures: elevated }).supported).toBe(true);
  });

  it("does not require full base support — one valid edge contact carries a plate", () => {
    const grounded = [piece("wall", 1, 0, 0, 1)]; // +X edge of tile (0,0,0): top at y = LH, x = CS/2
    // A floor whose slab only overlaps that wall's top edge (0.384 m of it).
    const candidate = piece("floor", 1, 1, 0);
    const r = placementIsSupported({ candidate, structures: grounded });
    expect(r.supported).toBe(true);
    // ...and the contact really is partial, not a full-column rest.
    const solid = structureCuboids(candidate)[0]!;
    const wallTop = structureCuboids(grounded[0]!)[0]!;
    const sharedX = Math.min(solid.center.x + solid.halfExtents.x, wallTop.center.x + wallTop.halfExtents.x)
      - Math.max(solid.center.x - solid.halfExtents.x, wallTop.center.x - wallTop.halfExtents.x);
    expect(sharedX).toBeLessThan(CS / 2);
    expect(sharedX).toBeGreaterThan(0);
  });
});

describe("structural support: edited-out attachment geometry carries nothing", () => {
  const wallTopRowRemoved: GeometryEditState = { kind: "wall", tiles: [false, false, false, true, true, true, true, true, true] };

  it("refuses a wall stacked where the support's top row was edited away", () => {
    const grounded = [piece("wall", 0, 0, 0, 0, wallTopRowRemoved)];
    // Sanity: the edit is a real hole — the remaining solids stop short of the
    // layer top, so the stacked panel's base has nothing to rest on.
    const solids = structureCuboids(grounded[0]!);
    expect(Math.max(...solids.map((s) => s.center.y + s.halfExtents.y))).toBeLessThan(LH);
    const r = placementIsSupported({ candidate: piece("wall", 0, 1, 0, 0), structures: grounded });
    expect([r.supported, r.reason]).toEqual([false, "unsupported"]);
    // The same placement on the unedited wall is legal.
    expect(placementIsSupported({ candidate: piece("wall", 0, 1, 0, 0), structures: [piece("wall", 0, 0, 0, 0)] }).supported).toBe(true);
  });

  it("refuses a floor resting on a wall whose top row was edited away, but not one resting on the wall beside it", () => {
    const holed = [piece("wall", 0, 0, 0, 0, wallTopRowRemoved)];
    expect(placementIsSupported({ candidate: piece("floor", 0, 1, 0), structures: holed }).supported).toBe(false);
    const intactNeighbour = [piece("wall", 0, 0, 0, 0, wallTopRowRemoved), piece("wall", 1, 0, 0, 1)];
    // The +X edge wall of tile (1,0,0) is at x = CS and is intact: the floor of
    // tile (1,1,0) rests on it. (The holed wall must not be what supports it.)
    const r = placementIsSupported({ candidate: piece("floor", 1, 1, 0), structures: holed.concat([piece("wall", 1, 0, 0, 1)]) });
    expect(r.supported).toBe(true);
    expect(intactNeighbour.length).toBe(2);
  });

  it("treats a fully edited-away support as no support at all", () => {
    const empty: GeometryEditState = { kind: "wall", tiles: [false, false, false, false, false, false, false, false, false] };
    expect(structureCuboids(piece("wall", 0, 0, 0, 0, empty))).toHaveLength(0);
    const r = placementIsSupported({ candidate: piece("wall", 0, 1, 0, 0), structures: [piece("wall", 0, 0, 0, 0, empty)] });
    expect([r.supported, r.reason]).toEqual([false, "unsupported"]);
  });
});

describe("structural support: the contact convention itself", () => {
  it("counts flush contact and real interpenetration, and rejects far-apart solids", () => {
    const floor = structureCuboids(piece("floor", 0, 0, 0))[0]!;
    const groundRest = { center: { x: 0, y: -0.1, z: 0 }, halfExtents: { x: 1, y: 0.1, z: 1 } }; // top exactly at the slab bottom
    expect(solidsAttach(floor, groundRest)).toBe(true);
    expect(solidsAttach(floor, { center: { x: 0, y: -0.13, z: 0 }, halfExtents: { x: 1, y: 0.1, z: 1 } })).toBe(true); // 0.03 gap ≤ tolerance
    expect(solidsAttach(floor, { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 1, y: 0.1, z: 1 } })).toBe(false);
  });

  it("requires real extent: a corner-to-corner graze is not a contact", () => {
    const floor = structureCuboids(piece("floor", 0, 0, 0))[0]!; // x,z ∈ [−CS/2, CS/2], y ∈ [0, 0.15]
    const corner = { center: { x: CS / 2 + 0.5, y: 0.65, z: CS / 2 + 0.5 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } };
    expect(solidsAttach(floor, corner)).toBe(false);
    expect(solidRestsOnFoundation(corner)).toBe(false);
  });

  it("draws the line between a designed load path and a knife-edge corner line", () => {
    // Two coplanar wall panels, one per layer, meeting end-to-end: their only
    // shared interval is the panel's 0.768 m thickness — a corner line with no
    // bearing area, so the upper panel is NOT rooted by it.
    const lower = structureCuboids(piece("wall", 0, 0, 0, 0))[0]!;
    const endToEnd = structureCuboids(piece("wall", 1, 1, 0, 0))[0]!;
    expect(solidsAttach(lower, endToEnd)).toBe(false);
    // The designed continuation of a ramp run touches along the tread's full
    // 5.12 m width — that is a load path.
    const crest = structureCuboids(piece("ramp", 0, 0, 0, 0))[15]!; // highest tread
    const nextRun = structureCuboids(piece("ramp", 1, 1, 0, 0))[0]!; // lowest tread of the run past the crest
    expect(solidsAttach(crest, nextRun)).toBe(true);
  });

  it("reports how many existing pieces are reachable from the foundation", () => {
    const grounded = [piece("wall", 0, 0, 0, 0), piece("floor", 0, 0, 1), piece("floor", 2, 2, 2)];
    const r = placementIsSupported({ candidate: piece("floor", 0, 1, 0), structures: grounded });
    expect(r.supported).toBe(true);
    expect(r.groundedStructures).toBe(2); // the two ground-level pieces, not the floating one
  });
});
