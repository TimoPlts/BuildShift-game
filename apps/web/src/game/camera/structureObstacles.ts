/**
 * structureObstacles — computes world-space AABBs for build structures to
 * feed into the camera obstruction system.
 *
 * This is a pure math module (no Babylon, no networking) that converts the
 * authoritative building state into a list of axis-aligned boxes the camera
 * controller can raycast against. The AABB convention matches the shared
 * build grid: each structure's world-space extent is derived from its grid
 * anchor, footprint, and rotation using the same cell/layer sizes as
 * `@buildshift/game-config`'s `BUILD_GRID`.
 *
 * The AABB for a structure anchored at grid cell `g` with effective
 * extents `(xs, zs)` after rotation covers:
 *   x ∈ [g.x * cellSize, (g.x + xs) * cellSize)
 *   y ∈ [groundY + (g.y - groundLayer) * layerHeight,
 *        groundY + (g.y - groundLayer + h) * layerHeight)
 *   z ∈ [g.z * cellSize, (g.z + zs) * cellSize)
 */
import { BUILD_GRID, VERTICAL_MOVEMENT, getStructureConfig } from "@buildshift/game-config";
import type { BuildingState } from "@buildshift/protocol";
import type { ObstacleAABB } from "./ThirdPersonCameraController";

const GROUND_Y = VERTICAL_MOVEMENT.groundY;
const { cellSize, layerHeight, groundLayer } = BUILD_GRID;

/**
 * Returns the effective X/Z cell counts for a structure after rotation.
 * Rotations 1 and 3 swap the X/Z footprint extents; 0 and 2 keep them.
 */
function effectiveExtents(
  buildType: string,
  rotation: number,
): { xs: number; zs: number; h: number } {
  const config = getStructureConfig(buildType);
  const [w, h, d] = config?.footprint ?? [1, 1, 1];
  return rotation === 1 || rotation === 3
    ? { xs: d, zs: w, h }
    : { xs: w, zs: d, h };
}

/**
 * Computes the world-space obstacle AABBs for every structure in the given
 * building state. Returns an empty array when there are no structures.
 *
 * The returned array is a fresh allocation per call; the caller (the
 * GameRuntime render loop) can pass it directly to
 * `ThirdPersonCameraController.setObstacles` each frame.
 */
export function computeStructureObstacles(
  buildingState: BuildingState,
): ObstacleAABB[] {
  const { structures } = buildingState;
  const result: ObstacleAABB[] = [];

  for (const structureId in structures) {
    const structure = structures[structureId];
    const { xs, zs, h } = effectiveExtents(
      structure.buildType,
      structure.rotation,
    );
    const { grid } = structure;

    const minX = grid.x * cellSize;
    const minY = GROUND_Y + (grid.y - groundLayer) * layerHeight;
    const minZ = grid.z * cellSize;
    const maxX = (grid.x + xs) * cellSize;
    const maxY = GROUND_Y + (grid.y - groundLayer + h) * layerHeight;
    const maxZ = (grid.z + zs) * cellSize;

    result.push({
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });
  }

  return result;
}
