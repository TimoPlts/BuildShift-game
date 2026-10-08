/**
 * Unit tests for {@link selectTargetStructure} — the pure aim-ray selection
 * of an owned, editable structure.
 *
 * Pure maths: given a camera aim ray and the authoritative building-state
 * mirror, it must pick the nearest structure the player owns (and that is
 * eligible) whose AABB the ray intersects within range — and nothing else.
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

// A wall is footprint [1,2,1] → cellSize 1, layerHeight 2. At grid (0,0,-3)
// rotation 0 its AABB is x ∈ [-0.5,0.5], y ∈ [0,4], z ∈ [-3.5,-2.5]. A ray from
// the camera at (0,2,0) straight down -Z hits its near face at z=-2.5 → t=2.5.
const ORIGIN: Vec3Like = { x: 0, y: 2, z: 0 };
const FORWARD: Vec3Like = { x: 0, y: 0, z: -1 };
const RANGE = 12;

describe("selectTargetStructure", () => {
  it("selects the owned wall the aim ray points at", () => {
    const target = selectTargetStructure({
      aimOrigin: ORIGIN,
      aimDirection: FORWARD,
      maxRange: RANGE,
      building: building([structure("wall1", "wall", { x: 0, y: 0, z: -3 }, "me")]),
      ownerId: "me",
    });
    expect(target).not.toBeNull();
    expect(target?.structureId).toBe("wall1");
    expect(target?.distance).toBeCloseTo(2.5, 5);
  });

  it("skips structures owned by other players", () => {
    const target = selectTargetStructure({
      aimOrigin: ORIGIN,
      aimDirection: FORWARD,
      maxRange: RANGE,
      building: building([structure("theirs", "wall", { x: 0, y: 0, z: -3 }, "other")]),
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
        structure("far", "wall", { x: 0, y: 0, z: -5 }, "me"),
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
        structure("wall1", "wall", { x: 0, y: 0, z: -3 }, "me"),
      ]),
      ownerId: "me",
      isEligible: (s) => s.buildType !== "cone",
    });
    expect(target?.structureId).toBe("wall1");
  });

  it("selects an owned floor (a valid edit target) on the aim ray", () => {
    // Floor at grid (0,0,-3): footprint [1,1,1], layerHeight 2 → AABB
    // x ∈ [-0.5,0.5], y ∈ [0,2], z ∈ [-3.5,-2.5]. A ray at y=2, z=0 going -Z
    // still intersects the y slab [0,2] (origin y=2 is the top face) → hit.
    const target = selectTargetStructure({
      aimOrigin: ORIGIN,
      aimDirection: FORWARD,
      maxRange: RANGE,
      building: building([structure("floor1", "floor", { x: 0, y: 0, z: -3 }, "me")]),
      ownerId: "me",
    });
    expect(target?.structureId).toBe("floor1");
  });
});
