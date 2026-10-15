/**
 * structureObstacles — computes world-space AABBs for build structures to
 * feed into the camera obstruction system.
 *
 * This is a pure math module (no Babylon, no networking) that converts the
 * authoritative building state into a list of axis-aligned boxes the camera
 * controller can raycast against: the bounds of each structure's canonical
 * geometry (shared `structureBounds`), so edge walls and thin one-tile ramps
 * obstruct exactly where they stand.
 */
import { structureBounds } from "@buildshift/game-config";
import type { BuildingState } from "@buildshift/protocol";
import type { ObstacleAABB } from "./ThirdPersonCameraController";

export function computeStructureObstacles(
  buildingState: BuildingState,
): ObstacleAABB[] {
  const { structures } = buildingState;
  const result: ObstacleAABB[] = [];

  for (const structureId in structures) {
    const structure = structures[structureId];
    // The canonical geometry's bounds (edge walls on their edge, one-tile
    // ramps on their tile) — the same solids the player collides with.
    const { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] } = structureBounds(structure);
    result.push({
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });
  }

  return result;
}
