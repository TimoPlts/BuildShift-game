/**
 * Shared placement line-of-sight / obstruction policy
 * (`placementVisibility.placementIsVisible`) — the exact geometry the
 * authoritative server and the client ghost both apply.
 *
 * Coordinate conventions (BUILD_GRID: cellSize 5.12, layerHeight 3.84):
 * cell (gx, gz) spans [gx·cs ∓ cs/2]; a wall at rotation 0 stands on its
 * tile's −Z edge plane z = (gz − 0.5)·cs, thickness 2 × 0.075·cs = 0.768
 * centred on that plane, covering the full edge and the full layer height.
 */
import { describe, expect, it } from "vitest";
import { BUILD_GRID } from "./building.js";
import { structureCuboids, type StructureGeometryInput } from "./editGeometry.js";
import { SHOT_EYE_HEIGHT_CROUCHED, SHOT_EYE_HEIGHT_STANDING } from "./shotOrigin.js";
import { PLACEMENT_VISIBILITY, placementEyePoint, placementIsVisible, placementVisibilitySamples } from "./placementVisibility.js";
const cs = BUILD_GRID.cellSize;
const lh = BUILD_GRID.layerHeight;
type V = { x: number; y: number; z: number };

const piece = (buildType: StructureGeometryInput["buildType"], grid: V, rotation = 0, editGrid?: StructureGeometryInput["editGrid"]): StructureGeometryInput =>
  ({ buildType, grid, rotation, ...(editGrid ? { editGrid } : {}) });

/** Wall panel z of the −Z edge of grid row gz (rotation 0). */
const edgeZ = (gz: number) => (gz - 0.5) * cs;

const wallTiles = (tiles: boolean[]): StructureGeometryInput["editGrid"] => ({ kind: "wall", tiles });
const floorTiles = (tiles: boolean[]): StructureGeometryInput["editGrid"] => ({ kind: "floor_cone", tiles });

// The closed wall: full panel on the −Z edge of row 1 (plane z = 2.56), y ∈ [0, 3.84].
const closedWall = piece("wall", { x: 0, y: 0, z: 1 }, 0);
// Floor cell BEHIND that wall, one full cell clear of the panel (the rot-0
// panel straddles z = 2.56 ± 0.384, biting into cells 0 and 1 alike).
const behindCell = { x: 0, y: 0, z: 2 };
const eyeInFront: V = { x: 0, y: SHOT_EYE_HEIGHT_STANDING, z: 0 };

describe("closed solids reject far-side candidates (both aim sides)", () => {
  it("a floor on the far side of a closed full-layer wall is occluded", () => {
    const r = placementIsVisible({ eye: eyeInFront, candidate: piece("floor", behindCell), structures: [closedWall] });
    expect(r.visible).toBe(false);
    expect(r.reason).toBe("occluded");
    expect(r.blocker).not.toBeNull();
    // The blocker entry sits on the wall's eye-side face (z = 2.56 − 0.384,
    // skin-shrunk), never on the candidate boundary — proof the PANEL blocks.
    expect(r.blocker!.point.z).toBeCloseTo(edgeZ(1) - cs * 0.075 + PLACEMENT_VISIBILITY.blockerSkin, 6);
  });

  it("the same geometry is occluded when viewed from the other side", () => {
    const eyeBehind: V = { x: 0, y: SHOT_EYE_HEIGHT_STANDING, z: 10 };
    const candidate = piece("floor", { x: 0, y: 0, z: -1 }); // cell on the far side of the wall
    const r = placementIsVisible({ eye: eyeBehind, candidate, structures: [closedWall] });
    expect(r.visible).toBe(false);
    expect(r.reason).toBe("occluded");
  });

  it("a floor stacked directly behind at the next tile is occluded too", () => {
    const r = placementIsVisible({ eye: eyeInFront, candidate: piece("floor", { x: 0, y: 0, z: 2 }), structures: [closedWall] });
    expect(r.visible).toBe(false);
  });

  it("a floor RESTING ON TOP of the closed wall is visible (support is not self-occlusion)", () => {
    // Same tile row, next layer up: the floor's bottom face is the panel's
    // top face. Side contact (the floor behind the wall above) is NOT a
    // support — only bottom-on-top rest is.
    const onTop = piece("floor", { x: 0, y: 1, z: 1 });
    expect(placementIsVisible({ eye: eyeInFront, candidate: onTop, structures: [closedWall] }).visible).toBe(true);
    // The lower floor directly behind the wall stays occluded even though it
    // presses against the panel's back face.
    expect(placementIsVisible({ eye: eyeInFront, candidate: piece("floor", { x: 0, y: 0, z: 1 }), structures: [closedWall] }).visible).toBe(false);
  });

  it("ownership is irrelevant: identical solids from any owner block identically (policy is pure geometry)", () => {
    // The helper never sees an owner field — same inputs, same verdict.
    const a = placementIsVisible({ eye: eyeInFront, candidate: piece("floor", behindCell), structures: [closedWall] });
    const b = placementIsVisible({ eye: eyeInFront, candidate: piece("floor", behindCell), structures: [closedWall] });
    expect(a.visible).toBe(b.visible);
  });
});

describe("touching / attached candidates stay legitimate", () => {
  it("a floor ADJACENT to the wall on the eye's own side is visible", () => {
    // Cell z = 0 (spans [−2.56, 2.56]) touches the panel on the eye side.
    const r = placementIsVisible({ eye: eyeInFront, candidate: piece("floor", { x: 0, y: 0, z: 0 }), structures: [closedWall] });
    expect(r.visible).toBe(true);
  });

  it("a wall stacked on top of a wall is visible (coplanar faces do not self-occlude)", () => {
    const lower = piece("wall", { x: 0, y: 0, z: 1 }, 0);
    const stacked = piece("wall", { x: 0, y: 1, z: 1 }, 0);
    const r = placementIsVisible({ eye: eyeInFront, candidate: stacked, structures: [lower] });
    expect(r.visible).toBe(true);
  });

  it("a floor continuing off the edge of an existing floor is visible (support face coplanar)", () => {
    const support = piece("floor", { x: 0, y: 0, z: 0 });
    const r = placementIsVisible({ eye: eyeInFront, candidate: piece("floor", { x: 0, y: 0, z: -1 }), structures: [support] });
    expect(r.visible).toBe(true);
  });

  it("a floor beside a ramp is visible through the open step geometry", () => {
    const ramp = piece("ramp", { x: 0, y: 0, z: 1 }, 0);
    // Cell x = 1 next to the ramp; probe points are the ramp's thin slabs.
    const r = placementIsVisible({ eye: { x: 0, y: SHOT_EYE_HEIGHT_STANDING, z: 0 }, candidate: piece("floor", { x: 1, y: 0, z: 1 }), structures: [ramp] });
    expect(r.visible).toBe(true);
  });

  it("a floor the player stands over (own tile, under the eye) is visible", () => {
    const r = placementIsVisible({ eye: eyeInFront, candidate: piece("floor", { x: 0, y: 0, z: 0 }), structures: [] });
    expect(r.visible).toBe(true);
  });

  it("the shared arena ground never blocks ordinary ground-layer placements", () => {
    // staticBlockers default = ARENA_VISIBILITY_BLOCKERS (ground slab top y=0).
    const r = placementIsVisible({ eye: eyeInFront, candidate: piece("floor", { x: 0, y: 0, z: 0 }), structures: [] });
    expect(r.visible).toBe(true);
  });
});

describe("real edited holes pass, remaining solids still block", () => {
  // 3×3 wall tiles: row = floor(i/3) with row 0 = TOP, col = i % 3 (rotation 0).
  // Door = bottom-middle tile (i = 7) removed → opening z-span of the panel,
  // x ∈ [−cs/6, cs/6], y ∈ [0, lh/3].
  const doorWall = piece("wall", { x: 0, y: 0, z: 1 }, 0, wallTiles([true, true, true, true, true, true, true, false, true]));
  const windowWall = piece("wall", { x: 0, y: 0, z: 1 }, 0, wallTiles([true, true, true, true, false, true, true, true, true]));

  it("a candidate behind the wall seen THROUGH the doorway is visible", () => {
    // Eye and the low far-side samples line up inside the door column: the
    // segment crosses the panel plane below the door lintel (y < lh/3 = 1.28).
    const r = placementIsVisible({ eye: { x: 0, y: SHOT_EYE_HEIGHT_STANDING, z: edgeZ(1) - 2 * cs }, candidate: piece("floor", behindCell), structures: [doorWall] });
    expect(r.visible).toBe(true);
  });

  it("the SAME candidate is occluded by the unedited (closed) wall", () => {
    const r = placementIsVisible({ eye: { x: 0, y: SHOT_EYE_HEIGHT_STANDING, z: edgeZ(1) - 2 * cs }, candidate: piece("floor", behindCell), structures: [closedWall] });
    expect(r.visible).toBe(false);
  });

  it("a window does not act as a universal hole: a low candidate behind it stays occluded", () => {
    // The window (middle-middle tile) spans y ∈ [1.28, 2.56]; segments from a
    // 1.2 m eye to a ground-layer floor behind the wall cross below it.
    const r = placementIsVisible({ eye: eyeInFront, candidate: piece("floor", behindCell), structures: [windowWall] });
    expect(r.visible).toBe(false);
  });

  it("eye height uses the SHARED constants (standing 1.2 / crouch 0.9)", () => {
    expect(placementEyePoint(1, 2, 3, false)).toEqual({ x: 1, y: 2 + SHOT_EYE_HEIGHT_STANDING, z: 3 });
    expect(placementEyePoint(1, 2, 3, true)).toEqual({ x: 1, y: 2 + SHOT_EYE_HEIGHT_CROUCHED, z: 3 });
  });

  it("a hole passes exactly what fits through it", () => {
    // Bottom two rows removed → opening y ∈ [0, 2·lh/3 ≈ 2.56].
    const openLow = piece("wall", { x: 0, y: 0, z: 1 }, 0, wallTiles([true, true, true, false, false, false, false, false, false]));
    const eye: V = { x: 0, y: SHOT_EYE_HEIGHT_STANDING, z: edgeZ(1) - 3 * cs };
    // A ground-layer floor behind the wall fits under the lintel → visible.
    expect(placementIsVisible({ eye, candidate: piece("floor", behindCell), structures: [openLow] }).visible).toBe(true);
    // Same eye/candidate against the closed panel → occluded (the retained
    // solids are exactly what blocks; the opening is what passes).
    expect(placementIsVisible({ eye, candidate: piece("floor", behindCell), structures: [closedWall] }).visible).toBe(false);
  });
});

describe("exact solids, not filled AABBs (no false blockers)", () => {
  const cone = piece("cone", { x: 0, y: 0, z: 1 });

  it("air INSIDE the cone's filled bounding box is real air", () => {
    // Eye (2.4, 1.86, 2.7) sits inside the cone's 5.12 × 1.92 × 5.12 AABB
    // but OUTSIDE the stepped solid (the level under it is y ∈ [0, 0.12]).
    // Audit probe [C1]: the filled bbox "hits" at the eye while the exact
    // solid is missed — the policy must follow the solid.
    const eye: V = { x: 2.4, y: 1.86, z: 2.7 };
    const above = piece("floor", { x: 0, y: 1, z: 1 }); // floor on the layer above the cone
    const r = placementIsVisible({ eye, candidate: above, structures: [cone] });
    expect(r.visible).toBe(true);
  });

  it("a three-quarter floor edit leaves a real hole the segment may cross", () => {
    // Quadrant i = 3 (+X/+Z quarter) removed from a layer-1 floor; candidate
    // floor below it, probed from above inside the removed quadrant.
    const holed = piece("floor", { x: 0, y: 1, z: 0 }, 0, floorTiles([true, true, true, false]));
    const r = placementIsVisible({ eye: { x: cs / 4, y: lh + 0.8, z: cs / 4 }, candidate: piece("floor", { x: 0, y: 0, z: 0 }), structures: [holed] });
    expect(r.visible).toBe(true);
  });

  it("the same floor fully retained blocks the same candidate", () => {
    const full = piece("floor", { x: 0, y: 1, z: 0 });
    const r = placementIsVisible({ eye: { x: cs / 4, y: lh + 0.8, z: cs / 4 }, candidate: piece("floor", { x: 0, y: 0, z: 0 }), structures: [full] });
    expect(r.visible).toBe(false);
  });

  it("a floor edited to zero tiles is no blocker at all", () => {
    const empty = piece("floor", { x: 0, y: 0, z: 1 }, 0, floorTiles([false, false, false, false]));
    const r = placementIsVisible({ eye: eyeInFront, candidate: piece("floor", behindCell), structures: [empty] });
    expect(r.visible).toBe(true);
  });
});

describe("sample geometry contract", () => {
  it("every sample lies strictly inside a candidate solid (inset corners + centre)", () => {
    const candidate = piece("wall", { x: 0, y: 0, z: 1 }, 0);
    const cuboids = structureCuboids(candidate);
    expect(cuboids.length).toBeGreaterThan(0);
    const samples = placementVisibilitySamples(candidate);
    for (const s of samples) {
      const inside = cuboids.some((c) =>
        Math.abs(s.x - c.center.x) <= c.halfExtents.x + 1e-9
        && Math.abs(s.y - c.center.y) <= c.halfExtents.y + 1e-9
        && Math.abs(s.z - c.center.z) <= c.halfExtents.z + 1e-9);
      expect(inside, JSON.stringify(s)).toBe(true);
    }
    // Sample points are inset by exactly PLACEMENT_VISIBILITY.sampleInset.
    const panel = cuboids[0]!;
    const deepest = Math.max(...samples.map((s) => Math.abs(s.x - panel.center.x) - panel.halfExtents.x));
    expect(deepest).toBeCloseTo(-PLACEMENT_VISIBILITY.sampleInset, 9);
  });

  it("zero blockers ⇒ visible (nothing self-occludes a fresh candidate)", () => {
    for (const buildType of ["wall", "floor", "ramp", "cone"] as const) {
      expect(placementIsVisible({ eye: eyeInFront, candidate: piece(buildType, behindCell), structures: [] }).visible).toBe(true);
    }
  });

describe("explicit cuboids candidates (edit-LOS probe reuse)", () => {
  // The edit authority gate feeds canonical TARGET-face probe boxes through
  // the same policy as `candidate.cuboids` — they are not placeable pieces,
  // so the footprint derivation must be bypassable without changing verdicts.
  const wall: StructureGeometryInput = { buildType: "wall", grid: { x: 0, y: 0, z: 1 }, rotation: 0 };
  const probeBehind = { cuboids: [{ center: { x: 0, y: 1.2, z: 10.24 }, halfExtents: { x: 0.2, y: 0.2, z: 0.2 } }] };
  const probeInFront = { cuboids: [{ center: { x: 0, y: 1.2, z: -10 }, halfExtents: { x: 0.2, y: 0.2, z: 0.2 } }] };

  it("a probe box beyond a closed panel is occluded and the same box in open air is visible", () => {
    expect(placementIsVisible({ eye: { x: 0, y: 1.2, z: -1 }, candidate: probeBehind, structures: [wall] }).visible).toBe(false);
    expect(placementIsVisible({ eye: { x: 0, y: 1.2, z: -1 }, candidate: probeInFront, structures: [wall] }).visible).toBe(true);
  });

  it("samples for a cuboids candidate are its skinned corners plus centre (9 points)", () => {
    expect(placementVisibilitySamples(probeBehind)).toHaveLength(9);
    const pts = placementVisibilitySamples(probeBehind);
    expect(pts.some((pt) => pt.x === 0 && pt.y === 1.2 && pt.z === 10.24)).toBe(true); // centre
  });
});
});
