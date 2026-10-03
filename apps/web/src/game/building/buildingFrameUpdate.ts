/**
 * buildingFrameUpdate — the per-frame driving step for the building system,
 * called once per render frame by the GameRuntime.
 *
 * Keeps the runtime wiring a single call:
 *
 *   1. recomputes the grid-snapped placement preview from the current aim
 *      ray / player position / selected build type;
 *   2. polls the pending place-press edge and, when the player is connected,
 *      submits the placement intent for the (valid) preview.
 *
 * The place intent is only *submitted* when connected: while disconnected
 * there is no authoritative server to answer it, and the press edge is
 * always consumed (dropped) so a stale click can never fire later.
 */
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { BuildingSystem } from "./index";

/**
 * Drives the building system for one render frame.
 *
 * @param building the wired building system (from `createBuildingSystem`).
 * @param camera the gameplay camera (aim ray origin).
 * @param aimDirection the current normalized world-space aim direction.
 * @param playerFeet the local player's feet position (range check).
 * @param connected whether the canonical network connection is live.
 */
export function updateBuildingFrame(
  building: BuildingSystem,
  camera: Camera,
  aimDirection: Vector3,
  playerFeet: Vector3,
  connected: boolean,
): void {
  const camPos = camera.position;
  building.controller.updateFrame({
    aimOrigin: { x: camPos.x, y: camPos.y, z: camPos.z },
    aimDirection: {
      x: aimDirection.x,
      y: aimDirection.y,
      z: aimDirection.z,
    },
    playerPosition: { x: playerFeet.x, y: playerFeet.y, z: playerFeet.z },
  });

  const placePressed = building.controller.consumePlacePressed();
  if (placePressed && connected) {
    building.requestPlace();
  }
}
