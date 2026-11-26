/**
 * Ramp-pose placement regressions (placement-solidity 20261125).
 *
 * The runtime feeds the placement preview the third-person CAMERA position as
 * the aim-ray origin. The camera sits on the shot line at a fixed distance
 * BEHIND the shared authoritative eye (`placementEyePoint` — the same point
 * the server's visibility check uses), so the camera ray and the eye ray are
 * the same LINE — but a candidate resolved from a ray parameter measured from
 * the camera can land between the camera and the eye, i.e. spatially BEHIND
 * the player. That is the reported screenshot bug: aiming forward/upward on a
 * ramp produced a green wall ghost intersecting or behind the avatar.
 *
 * The shared eye must therefore decide what counts as "aimed at": every
 * candidate (surface hit or layer-plane fallback) has to lie at or in front of
 * the eye along the aim direction. These tests reproduce the exact runtime
 * geometry (camera = eye − dir · cameraDistance, collinear on the shot line).
 */
import { describe, expect, it } from "vitest";
import { BUILD_GRID } from "@buildshift/game-config";
import {
  computePlacementPreview,
  type OccupiedStructure,
  type Vec3Like,
} from "./placementPreview";

const cs = BUILD_GRID.cellSize;
const lh = BUILD_GRID.layerHeight;

/** The standing shot-eye height used by the shared placement policy. */
const EYE = 1.2;
/** The nominal third-person tracking distance along the shot line. */
const CAM_DISTANCE = 3.7;

/** The canonical third-person camera position for a pose: eye − dir·d. */
const cameraOnShotLine = (feet: Vec3Like, dir: Vec3Like, eyeHeight = EYE): Vec3Like => ({
  x: feet.x - dir.x * CAM_DISTANCE,
  y: feet.y + eyeHeight - dir.y * CAM_DISTANCE,
  z: feet.z - dir.z * CAM_DISTANCE,
});

/** Horizontal dot of a candidate anchor with the aim, from the feet position
 * — NEGATIVE means the candidate is behind where the player is aiming (the
 * ghost-behind-the-avatar failure this mission eliminates). */
const forwardness = (anchor: Vec3Like, player: Vec3Like, dir: Vec3Like): number =>
  (anchor.x - player.x) * dir.x + (anchor.z - player.z) * dir.z;

/** Centre of the edge-wall panel for a tile/rotation (wall rotations:
 * 0 −Z, 1 +X, 2 +Z, 3 −X stand on the tile edge). */
const wallEdgeCenter = (grid: { x: number; y: number; z: number }, rotation: number): Vec3Like => {
  const dx = rotation === 1 ? 0.5 : rotation === 3 ? -0.5 : 0;
  const dz = rotation === 0 ? -0.5 : rotation === 2 ? 0.5 : 0;
  return { x: (grid.x + dx) * cs, y: grid.y * lh, z: (grid.z + dz) * cs };
};

describe("mid-ramp upward aim never ghosts a wall behind the avatar", () => {
  // Player feet on the tread with top 2.88 of a layer-0 ramp in tile (0,0,0)
  // rising toward +X. The standing eye (4.08) is ABOVE the layer-1 base plane
  // (3.84) while the shot-line camera (3.7 m back along the up-tilted line)
  // sits BELOW it — so the plane-crossing parameter measured from the camera
  // is positive, yet the crossing point lies BEHIND the eye (repro).
  const feet: Vec3Like = { x: 1.12, y: 2.88, z: 0 };
  const ramp: OccupiedStructure = { buildType: "ramp", grid: { x: 0, y: 0, z: 0 }, rotation: 0 };

  for (const deg of [5, 15, 30, 40, 55, 70, 80] as const) {
    it(`aiming up ${deg}° on the ramp never ghosts the behind-player plane tile`, () => {
      const rad = (deg * Math.PI) / 180;
      const dir: Vec3Like = { x: Math.cos(rad), y: Math.sin(rad), z: 0 };
      const p = computePlacementPreview({
        aimOrigin: cameraOnShotLine(feet, dir),
        aimDirection: dir,
        playerPosition: feet,
        buildType: "wall",
        rotation: 0,
        occupied: [ramp],
      });
      // The pre-fix repro candidate: the layer-1 plane tile behind/above the
      // player, crossed between camera and eye, marked VALID. Any surface
      // candidate that remains is an honest in-front-of-the-eye hit (the
      // documented aim-at-edge mechanic).
      expect(p.valid && p.grid?.x === 0 && p.grid?.y === 1 && p.grid?.z === 0, `${deg}°`).toBe(false);
    });
  }

  it("the 40° repro is truthful: no candidate rather than a behind-player wall", () => {
    const rad = (40 * Math.PI) / 180;
    const dir: Vec3Like = { x: Math.cos(rad), y: Math.sin(rad), z: 0 };
    const p = computePlacementPreview({
      aimOrigin: cameraOnShotLine(feet, dir),
      aimDirection: dir,
      playerPosition: feet,
      buildType: "wall",
      rotation: 0,
      occupied: [ramp],
    });
    // The ray rises away from the ramp surface and the layer-1 plane crossing
    // is behind the eye, so the honest answer is "nothing aimed at".
    expect([p.present, p.valid, p.reason, p.grid]).toEqual([true, false, "no_candidate", null]);
  });

  it("a surface hit between the camera and the eye (wall at the player's back) is not a candidate", () => {
    // The player faces +X, away from a wall standing on the x = −2.56 edge
    // (tile (−1,0,0), rot 1). The wall face near the back-sitting camera is
    // the FIRST solid along the camera ray, so the pre-fix preview resolved a
    // candidate on the player's own back edge.
    const feetNear: Vec3Like = { x: 0.1, y: 0.05, z: 0 };
    const behindWall: OccupiedStructure = { buildType: "wall", grid: { x: -1, y: 0, z: 0 }, rotation: 1 };
    const dir: Vec3Like = { x: Math.cos(0.1745), y: Math.sin(0.1745), z: 0 }; // up-forward, 10°
    const p = computePlacementPreview({
      aimOrigin: cameraOnShotLine(feetNear, dir),
      aimDirection: dir,
      playerPosition: feetNear,
      buildType: "wall",
      rotation: 0,
      occupied: [behindWall],
    });
    // The behind-player wall must never be the (in range, "overlap"-red or
    // worse, green) candidate; the candidate falls through to the far plane
    // crossing, which the bounds/range rules truthfully reject ahead of the
    // player.
    expect(["out_of_range", "out_of_bounds"]).toContain(p.reason);
    expect(p.grid!.x).toBeGreaterThan(0);
    expect(p.valid && p.grid?.x === -1 && p.rotation === 1).toBe(false);
  });
});

describe("aiming up from flat ground still targets the layer above (feature preserved)", () => {
  it("60° up over open sky places the candidate on the layer above, in front of the eye", () => {
    const feet: Vec3Like = { x: 0, y: 0, z: 0 };
    const dir: Vec3Like = { x: 0.5, y: Math.sqrt(3) / 2, z: 0 };
    const p = computePlacementPreview({
      aimOrigin: cameraOnShotLine(feet, dir),
      aimDirection: dir,
      playerPosition: feet,
      buildType: "floor",
      rotation: 0,
      occupied: [],
    });
    // The cell above the player is still the one aimed at, and it is still in
    // front of the eye. But over open sky that floor has nothing to stand on,
    // so the shared support gate now refuses the ghost too — the floating roof
    // this gate exists for. Below: the same aim on top of a wall is placeable.
    expect([p.valid, p.reason, p.grid]).toEqual([false, "unsupported", { x: 0, y: 1, z: 0 }]);
    expect(forwardness(p.anchorWorld!, feet, dir)).toBeGreaterThanOrEqual(0);
    const onWall = computePlacementPreview({
      aimOrigin: cameraOnShotLine(feet, dir),
      aimDirection: dir,
      playerPosition: feet,
      buildType: "floor",
      rotation: 0,
      occupied: [{ buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0 }],
    });
    expect([onWall.valid, onWall.grid]).toEqual([true, { x: 0, y: 1, z: 0 }]);
  });
});

describe("forward wall choice from low/mid/top ramp poses, all four headings", () => {
  // Ramp rotations rise +X→0, +Z→1, −X→2, −Z→3; the aimed high-end edge is
  // wall rotation +X→1, +Z→2, −X→3, −Z→0.
  // `crestGrid`/`crestWallRotation`: with feet AT the layer-1 base the aim
  // crosses the NEXT tile's plane; the named edge of that forward tile faces
  // BACK toward the ramp's high end (same physical edge, opposite tile side).
  const headings = [
    { name: "+X", rampRotation: 0, wallRotation: 1, ux: 1, uz: 0, crestGrid: { x: 1, y: 1, z: 0 }, crestRotation: 3 },
    { name: "+Z", rampRotation: 1, wallRotation: 2, ux: 0, uz: 1, crestGrid: { x: 0, y: 1, z: 1 }, crestRotation: 0 },
    { name: "-X", rampRotation: 2, wallRotation: 3, ux: -1, uz: 0, crestGrid: { x: -1, y: 1, z: 0 }, crestRotation: 1 },
    { name: "-Z", rampRotation: 3, wallRotation: 0, ux: 0, uz: -1, crestGrid: { x: 0, y: 1, z: -1 }, crestRotation: 2 },
  ] as const;
  // Low / mid / top ramp poses (feet ON the tread top, measured ALONG the
  // ascent from the tile centre; tread rise is lh/16 = 0.24 m).
  const poses = [
    { name: "low", along: -1.12, y: 1.2, aimDownDeg: 10 },
    { name: "mid", along: 1.12, y: 2.88, aimDownDeg: 20 },
    // The crest pose stands AT the layer-1 base: aiming down-forward crosses
    // the next tile's build plane, so only the forward-ness contract is
    // asserted there (not a fixed tile/edge).
    { name: "crest", along: 2.4, y: 3.84, aimDownDeg: 40 },
  ] as const;

  for (const h of headings) {
    for (const pose of poses) {
      it(`ramp rising ${h.name}, ${pose.name} pose, aim ${pose.aimDownDeg}° down at the surface ahead -> forward wall`, () => {
        const feet: Vec3Like = { x: h.ux * pose.along, y: pose.y, z: h.uz * pose.along };
        const rad = (pose.aimDownDeg * Math.PI) / 180;
        const dir: Vec3Like = { x: h.ux * Math.cos(rad), y: -Math.sin(rad), z: h.uz * Math.cos(rad) };
        const p = computePlacementPreview({
          aimOrigin: cameraOnShotLine(feet, dir),
          aimDirection: dir,
          playerPosition: feet,
          buildType: "wall",
          rotation: 0,
          occupied: [{ buildType: "ramp", grid: { x: 0, y: 0, z: 0 }, rotation: h.rampRotation }],
        });
        expect([p.present, p.valid, p.reason]).toEqual([true, true, null]);
        if (pose.name === "crest") {
          // The plane candidate stands on the tile PAST the ramp's high end —
          // still the forward edge the reticle crosses, never the avatar.
          expect(p.grid).toEqual(h.crestGrid);
          expect(p.rotation).toBe(h.crestRotation);
        } else {
          expect(p.grid).toEqual({ x: 0, y: 0, z: 0 });
          expect(p.rotation).toBe(h.wallRotation);
        }
        const edge = wallEdgeCenter(p.grid!, p.rotation);
        expect(forwardness(edge, feet, dir)).toBeGreaterThan(0);
      });
    }
  }
});

describe("building on a ramp: the wall follows the aimed edge ahead, not behind", () => {
  it("aiming down the climb at the crest resolves the crest edge wall", () => {
    // Feet on tread 10 (x∈[0.32,0.64], top 3.84 + 2.4 = 6.24) of a LAYER-1
    // ramp rising +X, aiming 35° down the climb; the wall candidate is the
    // ramp tile's crest edge — the edge ahead — not the low edge behind.
    const feet: Vec3Like = { x: 0.6, y: 6.24, z: 0 };
    const rad = (35 * Math.PI) / 180;
    const dir: Vec3Like = { x: Math.cos(rad), y: -Math.sin(rad), z: 0 };
    const p = computePlacementPreview({
      aimOrigin: cameraOnShotLine(feet, dir),
      aimDirection: dir,
      playerPosition: feet,
      buildType: "wall",
      rotation: 0,
      // The layer-1 ramp the avatar stands on is itself built on the layer-0
      // ramp below it: an airborne ramp could not hold anything up.
      occupied: [
        { buildType: "ramp", grid: { x: 0, y: 0, z: 0 }, rotation: 0 },
        { buildType: "ramp", grid: { x: 0, y: 1, z: 0 }, rotation: 0 },
      ],
    });
    expect([p.present, p.valid, p.reason]).toEqual([true, true, null]);
    expect(p.grid).toEqual({ x: 0, y: 1, z: 0 });
    expect(p.rotation).toBe(1); // the +X crest edge, ahead of the climb
    const edge = wallEdgeCenter(p.grid!, p.rotation);
    expect(forwardness(edge, feet, dir)).toBeGreaterThan(0.05);
  });
});
