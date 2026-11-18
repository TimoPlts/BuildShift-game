/**
 * Placement-preview parity for the preparation row (CONTRACT.md §6): while
 * the authoritative preparation is active, the server accepts placements
 * whose anchor grid X equals this player's assigned row and rejects
 * everything else with `preparation_zone`. The client ghost must show the
 * same verdict (useful invalid feedback), while an unassigned/non-prepping
 * client sees the normal rules unchanged.
 */
import { describe, expect, it } from "vitest";
import { BUILD_BOUNDS, BUILD_GRID } from "@buildshift/game-config";
import {
  computePlacementPreview,
  type PlacementPreviewInput,
} from "./placementPreview";

function aimingDownAt(worldX: number, overrides: Partial<PlacementPreviewInput> = {}): PlacementPreviewInput {
  const pos = { x: worldX, y: 0, z: 0 };
  return {
    aimOrigin: { x: worldX, y: 2, z: 0 },
    aimDirection: { x: 0, y: -1, z: 0 },
    playerPosition: pos,
    buildType: "floor",
    rotation: 0,
    occupied: [],
    ...overrides,
  };
}

function rowCentreX(side: "negative" | "positive"): number {
  const gridX = side === "negative" ? BUILD_BOUNDS.minX : BUILD_BOUNDS.maxX;
  return gridX * BUILD_GRID.cellSize;
}

describe("placement preview during preparation", () => {
  it("anchoring on the assigned row stays valid", () => {
    for (const side of ["negative", "positive"] as const) {
      const p = computePlacementPreview(
        aimingDownAt(rowCentreX(side), { preparationSide: side }),
      );
      expect([p.present, p.valid, p.reason]).toEqual([true, true, null]);
      expect(p.grid!.x).toBe(side === "negative" ? BUILD_BOUNDS.minX : BUILD_BOUNDS.maxX);
    }
  });

  it("a centre-row candidate previews as outside_preparation (the server's prep_zone rejection)", () => {
    const p = computePlacementPreview(
      aimingDownAt(0, { preparationSide: "negative" }),
    );
    expect([p.present, p.valid, p.reason, p.grid?.x]).toEqual([true, false, "outside_preparation", 0]);
  });

  it("the enemy row previews as outside_preparation too", () => {
    const p = computePlacementPreview(
      aimingDownAt(rowCentreX("positive"), { preparationSide: "negative" }),
    );
    expect(p.valid).toBe(false);
    expect(p.reason).toBe("outside_preparation");
  });

  it("no restriction outside preparation (null / empty side behave as before)", () => {
    const centre = aimingDownAt(0);
    expect(computePlacementPreview(centre).valid).toBe(true);
    expect(computePlacementPreview({ ...centre, preparationSide: "" }).valid).toBe(true);
    expect(computePlacementPreview({ ...centre, preparationSide: null }).valid).toBe(true);
  });

  it("normal bounds still win ahead of the prep rule (out_of_bounds first)", () => {
    const p = computePlacementPreview(
      aimingDownAt(40, {
        aimOrigin: { x: 40, y: 2, z: 0 },
        playerPosition: { x: 40, y: 0, z: 0 },
        preparationSide: "negative",
      }),
    );
    expect(p.reason).toBe("out_of_bounds");
  });
});
