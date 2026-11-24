/**
 * structureObstacles — computes world-space AABBs for build structures to
 * feed into the camera obstruction system.
 *
 * This is a pure math module (no Babylon, no networking) that converts the
 * authoritative building state into a list of axis-aligned boxes the camera
 * controller can raycast against: the *canonical solid cuboids* of each
 * structure's current (possibly edited) geometry — the exact same volumes
 * the player collides with and the renderer draws
 * (`structureCuboids`, shared with `predictionOrchestrator` and the aim
 * resolver).
 *
 * Why cuboids and not the per-structure bounding box
 * (`build-feel-20261123`): a canonical ramp is 16 thin step slabs that are
 * open underneath, and a canonical cone is a 16-level stepped pyramid. Their
 * union bounding boxes are solid 5.12 × 3.84 × 5.12 m columns, so a camera
 * ray behind the eye "hit" thin air beside the walk surface and dollied the
 * camera to arm's length INSIDE the build — the reported sudden zoom with
 * the world gone. Edited builds likewise must obstruct by their *retained*
 * solids (an opened tile is an actual opening), which only the cuboid
 * decomposition of the replicated `editGrid` expresses. Wall/floor pieces
 * decompose to one box each, so exact-obstruction cost stays trivial and
 * real wall/ceiling safety is preserved exactly where solids stand.
 */
import { structureCuboids } from "@buildshift/game-config";
import type { BuildingState } from "@buildshift/protocol";
import type { ObstacleAABB } from "./ThirdPersonCameraController";

export function computeStructureObstacles(
  buildingState: BuildingState,
): ObstacleAABB[] {
  const { structures } = buildingState;
  const result: ObstacleAABB[] = [];

  for (const structureId in structures) {
    const structure = structures[structureId];
    // The canonical solids of the CURRENT edited geometry — the same boxes
    // the player collides with, the shot ray intersects and the renderer
    // draws. Edge walls stand on their edge; ramp steps are thin slabs open
    // underneath; cones are stepped pyramids; removed edit tiles contribute
    // no volume (an actual opening, not an obstruction).
    for (const { center, halfExtents } of structureCuboids({
      buildType: structure.buildType,
      grid: structure.grid,
      rotation: structure.rotation,
      editGrid: structure.editGrid,
    })) {
      result.push({
        min: [center.x - halfExtents.x, center.y - halfExtents.y, center.z - halfExtents.z],
        max: [center.x + halfExtents.x, center.y + halfExtents.y, center.z + halfExtents.z],
      });
    }
  }

  return result;
}
