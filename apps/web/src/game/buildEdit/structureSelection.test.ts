/**
 * Unit tests for {@link selectTargetStructure} — the pure aim-ray selection
 * of an owned, editable structure.
 *
 * Pure maths: given a camera aim ray and the authoritative building-state
 * mirror, it resolves the ray against the canonical SOLID volumes of every
 * replicated structure and selects the first real surface hit — but only
 * when it belongs to an owned, eligible piece (nearest-real-surface-wins,
 * see the module docs). Stacked floor/cone/wall regressions below pin the
 * rule.
 */
import { describe, expect, it } from "vitest";
import type { BuildingState, StructureState } from "@buildshift/protocol";
import {
  selectTargetStructure,
  type Vec3Like,
} from "./structureSelection";

/** A minimal wall/floor structure at a grid cell, owned by `owner`. */
function structure(
  structureId: string,
  buildType: StructureState["buildType"],
  grid: { x: number; y: number; z: number },
  ownerId: string,
  rotation: StructureState["rotation"] = 0,
): StructureState {
  return {
    structureId,
    buildType,
    grid,
    rotation,
    ownerId,
    createdSequence: 0,
  };
}

function building(
  structures: StructureState[],
): BuildingState {
  const map: Record<string, StructureState> = {};
  for (const s of structures) {
    map[s.structureId] = s;
  }
  return { structures: map };
}

// A wall is footprint [1,1,1] → cellSize ≈ 5.12, layerHeight ≈ 3.84. At grid
// (0,0,-1) rotation 0 its AABB (per the shared wc/structureAabb formula) is
// ctr=(0, 1.92, -5.12), he=(2.56, 1.92, 2.56) → x ∈ [-2.56,2.56],
// y ∈ [0,3.84], z ∈ [-7.68,-2.56].
// A ray from the camera at (0,2,0) straight down -Z hits its near face at
// z=-2.56 → t=2.56.
const ORIGIN: Vec3Like = { x: 0, y: 2, z: 0 };
const FORWARD: Vec3Like = { x: 0, y: 0, z: -1 };
const RANGE = 12;

describe("selectTargetStructure", () => {
  it("selects the owned wall the aim ray points at", () => {
    const target = selectTargetStructure({
      aimOrigin: ORIGIN,
      aimDirection: FORWARD,
      maxRange: RANGE,
      building: building([structure("wall1", "wall", { x: 0, y: 0, z: -1 }, "me")]),
      ownerId: "me",
    });
    expect(target).not.toBeNull();
    expect(target?.structureId).toBe("wall1");
    // Walls are edge pieces: rotation 0 stands on the tile's −Z edge (z = −7.68),
    // so the panel's near face is 7.68 − 0.384 away.
    expect(target?.distance).toBeCloseTo(7.68 - 0.384, 5);
  });

  it("skips structures owned by other players", () => {
    const target = selectTargetStructure({
      aimOrigin: ORIGIN,
      aimDirection: FORWARD,
      maxRange: RANGE,
      building: building([structure("theirs", "wall", { x: 0, y: 0, z: -1 }, "other")]),
      ownerId: "me",
    });
    expect(target).toBeNull();
  });

  it("reaches the nearest owned structure when several are on the ray", () => {
    const target = selectTargetStructure({
      aimOrigin: ORIGIN,
      aimDirection: FORWARD,
      maxRange: RANGE,
      building: building([
        structure("far", "wall", { x: 0, y: 0, z: -2 }, "me"),
        structure("near", "wall", { x: 0, y: 0, z: -1 }, "me"),
      ]),
      ownerId: "me",
    });
    expect(target?.structureId).toBe("near");
  });

  it("ignores structures beyond the maximum range", () => {
    const target = selectTargetStructure({
      aimOrigin: ORIGIN,
      aimDirection: FORWARD,
      maxRange: RANGE,
      building: building([structure("beyond", "wall", { x: 0, y: 0, z: -20 }, "me")]),
      ownerId: "me",
    });
    expect(target).toBeNull();
  });

  it("returns null when the aim ray misses every owned structure", () => {
    const target = selectTargetStructure({
      aimOrigin: ORIGIN,
      aimDirection: FORWARD,
      maxRange: RANGE,
      building: building([structure("sideways", "wall", { x: 8, y: 0, z: -3 }, "me")]),
      ownerId: "me",
    });
    expect(target).toBeNull();
  });

  it("returns null when there are no structures at all", () => {
    const target = selectTargetStructure({
      aimOrigin: ORIGIN,
      aimDirection: FORWARD,
      maxRange: RANGE,
      building: building([]),
      ownerId: "me",
    });
    expect(target).toBeNull();
  });

  it("skips ineligible structures so the ray reaches the next candidate", () => {
    // `cone` supports no build edits → ineligible. The wall behind it is the
    // selectable target.
    const target = selectTargetStructure({
      aimOrigin: ORIGIN,
      aimDirection: FORWARD,
      maxRange: RANGE,
      building: building([
        structure("cone1", "cone", { x: 0, y: 0, z: -1 }, "me"),
        structure("wall1", "wall", { x: 0, y: 0, z: -2 }, "me", 2), // +Z edge of tile z = −2 (z = −7.68)
      ]),
      ownerId: "me",
      isEligible: (s) => s.buildType !== "cone",
    });
    expect(target?.structureId).toBe("wall1");
  });

  it("selects an owned floor (a valid edit target) on the aim ray", () => {
    // Floor at grid (0,0,-1): its canonical slab spans y ∈ [0, 0.15],
    // z ∈ [-7.68, -2.56]; a ray at slab height going -Z hits it.
    const target = selectTargetStructure({
      aimOrigin: { x: 0, y: 0.1, z: 0 },
      aimDirection: FORWARD,
      maxRange: RANGE,
      building: building([structure("floor1", "floor", { x: 0, y: 0, z: -1 }, "me")]),
      ownerId: "me",
    });
    expect(target?.structureId).toBe("floor1");
  });

  // ── stacked-geometry regressions (user report: cone steals the pick) ────
  //
  // A cone at grid (0,0,-1) spans x ∈ [-2.56,2.56], y ∈ [0,1.92],
  // z ∈ [-7.68,-2.56] as a bounding box — but its canonical solid is a
  // 16-level stepped pyramid: at height y the half-size is
  // 2.56·(16−⌊y/0.12⌋)/16, so near the top the solid is a ≤0.32 m spike
  // around the cell centre (0,·,−5.12) and everything else in that box is
  // real air.

  it("does not select a cone whose AABB the camera sits inside while the ray only traverses real air", () => {
    // Eye in the cone's bbox corner (x=2.0 is outside every level at eye
    // height 1.7), aiming straight -Z: the OLD full-AABB pick returned the
    // cone at distance 0 (origin inside the slab on every axis) — the ray
    // never touches the pyramid, which is confined to |x−0| ≤ 1.28.
    const target = selectTargetStructure({
      aimOrigin: { x: 2.0, y: 1.7, z: -5 },
      aimDirection: FORWARD,
      maxRange: RANGE,
      building: building([
        structure("cone1", "cone", { x: 0, y: 0, z: -1 }, "me"),
        // Own wall on the +Z edge of tile z=-3 → panel z ∈ [-13.184,-12.416].
        structure("wall1", "wall", { x: 0, y: 0, z: -3 }, "me", 2),
      ]),
      ownerId: "me",
    });
    expect(target?.structureId).toBe("wall1");
    expect(target?.distance).toBeCloseTo(-5 - -12.416, 5);
  });

  it("selects the floor underside under a same-cell cone (coplanar tie → non-cone wins)", () => {
    // Floor + cone stacked at (0,1,0) (a roof over a floor one layer up).
    // The floor's underside (y=3.84) and the cone's full-footprint lowest
    // level share that bottom plane, so an under-roof aim up hits both at
    // the exact same distance. The visible piece (the floor) must win —
    // deterministically, independent of the mirror's iteration order.
    const stacked = building([
      structure("cone1", "cone", { x: 0, y: 1, z: 0 }, "me"),
      structure("floor1", "floor", { x: 0, y: 1, z: 0 }, "me"),
    ]);
    const up = { x: 0, y: 0.98058, z: -0.19612 }; // normalized (0, 5, -1)
    for (const order of [stacked, building([
      structure("floor1", "floor", { x: 0, y: 1, z: 0 }, "me"),
      structure("cone1", "cone", { x: 0, y: 1, z: 0 }, "me"),
    ])]) {
      const target = selectTargetStructure({
        aimOrigin: { x: 0, y: 3.0, z: 0 },
        aimDirection: up,
        maxRange: RANGE,
        building: order,
        ownerId: "me",
      });
      expect(target?.structureId).toBe("floor1");
    }
  });

  it("keeps the cone editable on its own surface", () => {
    // Crosshair on the cone's own sloped body (y=4.4, above the floor's
    // slab y ∈ [3.84,3.99]): the level band covering y=4.4 (j=4, half-size
    // 2.56·12/16 = 1.92) faces +Z at z = 5.12+1.92, so a horizontal aim
    // from (0,4.4,9) hits the CONE at distance 9 − 7.04 — and the floor
    // (a level with 0.15 thickness) is nowhere on this ray.
    const target = selectTargetStructure({
      aimOrigin: { x: 0, y: 4.4, z: 9 },
      aimDirection: FORWARD,
      maxRange: RANGE,
      building: building([
        structure("floor1", "floor", { x: 0, y: 1, z: 1 }, "me"),
        structure("cone1", "cone", { x: 0, y: 1, z: 1 }, "me"),
      ]),
      ownerId: "me",
    });
    expect(target?.structureId).toBe("cone1");
    expect(target?.distance).toBeCloseTo(9 - (1 * 5.12 + 1.92), 5);
  });

  it("does not select through a closed enemy structure (nearest real surface wins)", () => {
    // Enemy wall on the +Z edge of tile z=-1 → panel z ∈ [-2.944,-2.176],
    // fully solid; own wall behind it at tile z=-3. The old pick ignored
    // enemy pieces entirely and selected the own wall "through" it.
    const target = selectTargetStructure({
      aimOrigin: { x: 0, y: 2, z: 0 },
      aimDirection: FORWARD,
      maxRange: RANGE,
      building: building([
        structure("mine", "wall", { x: 0, y: 0, z: -2 }, "me", 2),
        structure("enemy", "wall", { x: 0, y: 0, z: -1 }, "them", 2),
      ]),
      ownerId: "me",
    });
    expect(target).toBeNull();
  });

  it("reaches the own wall behind a removed (edited-out) enemy wall tile", () => {
    // Same enemy wall with its middle row edited out (tiles 3–5 false →
    // real air y ∈ [1.28, 2.56]); the level ray passes through the actual
    // opening — exactly where shots pass — and selects the own wall.
    const enemy = structure("enemy", "wall", { x: 0, y: 0, z: -1 }, "them", 2);
    enemy.editGrid = {
      kind: "wall",
      tiles: [true, true, true, false, false, false, true, true, true],
    };
    const target = selectTargetStructure({
      aimOrigin: { x: 0, y: 1.7, z: 0 },
      aimDirection: FORWARD,
      maxRange: RANGE,
      building: building([
        structure("mine", "wall", { x: 0, y: 0, z: -2 }, "me", 2),
        enemy,
      ]),
      ownerId: "me",
    });
    expect(target?.structureId).toBe("mine");
    expect(target?.distance).toBeCloseTo(7.296, 5);
  });

  it("reports the distance to the real surface, not the bounding-box near face", () => {
    // Cone at (0,0,-1) aimed at -Z from (0, 0.5, 0): the bbox near face is
    // z=-2.56 (distance 2.56), but the solid at y=0.5 (level j=4, half-size
    // 1.92 → z from -3.2) starts at z = -5.12+1.92 = -3.2.
    const target = selectTargetStructure({
      aimOrigin: { x: 0, y: 0.5, z: 0 },
      aimDirection: FORWARD,
      maxRange: RANGE,
      building: building([structure("cone1", "cone", { x: 0, y: 0, z: -1 }, "me")]),
      ownerId: "me",
    });
    expect(target?.structureId).toBe("cone1");
    expect(target?.distance).toBeCloseTo(3.2, 5);
  });

  // Baseline-audit probes (edit-system-20261124 ACCEPTANCE X1/X2) pinned.

  it("X1: a horizontal aim past a full cone's slopes resolves NO cone surface", () => {
    // Audit probe: eye (1.2, 1.86, −12) aiming +Z at the full cone cell
    // (0,0,0). The bbox pick selected the cone at 9.440 m; at y=1.86 only
    // the top level (band 1.80–1.92, half-size 0.16 around x=z=0) exists,
    // so the exact shot line passes the cone — like the shot it mirrors.
    const target = selectTargetStructure({
      aimOrigin: { x: 1.2, y: 1.86, z: -12 },
      aimDirection: { x: 0, y: 0, z: 1 },
      maxRange: 30,
      building: building([structure("cone1", "cone", { x: 0, y: 0, z: 0 }, "me")]),
      ownerId: "me",
    });
    expect(target).toBeNull();
  });

  it("X2: an empty-edited cone (zero solids) is not selectable", () => {
    // Audit probe: cone at grid (3,0,0) with all four tiles edited out.
    // The bbox pick selected it at 6.440 m; the exact raycast finds no
    // volume anywhere in the slot. (Server-side rejection/destruction of
    // the empty form is contract C2, outside this lane.)
    const empty = structure("cone1", "cone", { x: 3, y: 0, z: 0 }, "me");
    empty.editGrid = { kind: "floor_cone", tiles: [false, false, false, false] };
    const target = selectTargetStructure({
      aimOrigin: { x: 12.8 + 6.44, y: 1, z: 0 },
      aimDirection: { x: -1, y: 0, z: 0 },
      maxRange: 30,
      building: building([empty]),
      ownerId: "me",
    });
    expect(target).toBeNull();
  });
});
