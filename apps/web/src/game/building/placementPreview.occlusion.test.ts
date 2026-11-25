/**
 * Ghost-vs-authority PARITY for occlusion: the client preview applies the
 * SAME shared `placementIsVisible` segment policy (shared eye: standing 1.2 /
 * crouch 0.9 above the feet — NOT the camera position) with the same
 * `"occluded"` reason the server enforces, so a candidate behind a closed
 * wall never shows a green ghost. The camera AIM may still target over the
 * wall (candidate selection is unchanged); it is the VALIDITY that agrees
 * with the authoritative verdict.
 */
import { describe, expect, it } from "vitest";
import { BUILD_GRID } from "@buildshift/game-config";
import type { StructureEditState } from "@buildshift/protocol";
import {
  computePlacementPreview,
  type PlacementPreviewInput,
} from "./placementPreview";

const cs = BUILD_GRID.cellSize;

const closedWall = { buildType: "wall" as const, grid: { x: 0, y: 0, z: 1 }, rotation: 0 as const };
const doorWall: StructureEditState = { kind: "wall", tiles: [true, true, true, true, true, true, true, false, true] };

/**
 * Scene: a full-layer wall panel across the −Z edge of cell (0,·,1)
 * (plane z = 2.56, top y = 3.84). The player stands IN FRONT at
 * (0, feet 0, z = 1) → shared eye (0, 1.2, 1). The camera is raised to
 * (0, 8, −1) and aims DOWN OVER the wall at the floor cell BEHIND it
 * ((0,0,2), centre z = 10.24) — the aim ray clears the panel top so a
 * candidate exists, but the shared eye cannot see that cell.
 */
function aimOverTheWallAt(behindCell: boolean): PlacementPreviewInput {
  return {
    aimOrigin: { x: 0, y: 8, z: -1 },
    aimDirection: norm({ x: 0, y: -8, z: behindCell ? 11.24 : 5.12 - 1 }),
    playerPosition: { x: 0, y: 0, z: 1 },
    buildType: "floor",
    rotation: 0,
    occupied: [closedWall],
  };
}

function norm(v: { x: number; y: number; z: number }) {
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

describe("placement preview occlusion parity", () => {
  it("a candidate behind a closed wall previews INVALID with reason occluded", () => {
    const p = computePlacementPreview(aimOverTheWallAt(true));
    expect(p.present).toBe(true);
    expect(p.grid).toEqual({ x: 0, y: 0, z: 2 }); // candidate exists (aim cleared the wall)
    expect([p.valid, p.reason]).toEqual([false, "occluded"]);
  });

  it("the SAME candidate is valid once the wall has a real door hole (parity with the server edit rule)", () => {
    const p = { ...aimOverTheWallAt(true), occupied: [{ ...closedWall, editGrid: doorWall }] };
    const r = computePlacementPreview(p);
    expect(r.reason).not.toBe("occluded");
    expect(r.valid, r.reason ?? "valid").toBe(true);
  });

  it("no wall at all — the same aim is a plain valid ghost (the occluder causes the red)", () => {
    const p = { ...aimOverTheWallAt(true), occupied: [] };
    const r = computePlacementPreview(p);
    expect(r.grid).toEqual({ x: 0, y: 0, z: 2 });
    expect(r.valid, r.reason ?? "valid").toBe(true);
  });

  it("a near-face candidate in front of the wall stays valid (touching support is not self-occlusion)", () => {
    // Aim down at the ground in front of the wall: cell (0,0,0).
    const r = computePlacementPreview({
      aimOrigin: { x: 0, y: 8, z: -8 },
      aimDirection: norm({ x: 0, y: -8, z: 6.5 }),
      playerPosition: { x: 0, y: 0, z: -4 },
      buildType: "floor",
      rotation: 0,
      occupied: [closedWall],
    });
    expect(r.grid).toEqual({ x: 0, y: 0, z: 0 }); // cell touching the panel's front face
    expect(r.valid, r.reason ?? "valid").toBe(true);
  });

  it("eye uses the shared constants from the FEET position, not the camera", () => {
    // Camera high on a ledge at (0, 8, −1) but FEET (hence the eye) in front
    // of the wall — validity must track the feet eye (occluded), not the
    // camera (which can see the far cell).
    const r = computePlacementPreview({
      ...aimOverTheWallAt(true),
      playerPosition: { x: 0, y: 0, z: 1 }, // eye = (0, 1.2, 1)
    });
    expect(r.reason).toBe("occluded");
    // The crouch flag shifts the shared eye to 0.9 — still a closed wall.
    expect(computePlacementPreview({ ...aimOverTheWallAt(true), crouched: true }).reason).toBe("occluded");
  });

  it("an adjacent cell the eye sees beside the wall is valid", () => {
    // Aim straight down beside the panel edge (x = cs → cell x = 1, z = 1),
    // directly under the camera, no wall crossed.
    const r = computePlacementPreview({
      aimOrigin: { x: cs, y: 2, z: 5.12 },
      aimDirection: { x: 0, y: -1, z: 0 },
      playerPosition: { x: cs, y: 0, z: 5.12 },
      buildType: "floor",
      rotation: 0,
      occupied: [closedWall],
    });
    expect(r.grid).toEqual({ x: 1, y: 0, z: 1 });
    expect(r.valid, r.reason ?? "valid").toBe(true);
  });
});
