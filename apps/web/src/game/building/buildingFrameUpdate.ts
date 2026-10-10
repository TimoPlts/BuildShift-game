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
 * Reusable per-frame context buffer. `updateBuildingFrame` runs once per
 * render frame, so the three `Vec3Like` payloads are written into one
 * module-level object instead of allocating three new objects every frame.
 * This is safe because `BuildingController.updateFrame` (and the
 * `computePlacementPreview` it calls) only reads the context synchronously
 * and never retains a reference to it.
 */
const _frameContext = {
  aimOrigin: { x: 0, y: 0, z: 0 },
  aimDirection: { x: 0, y: 0, z: 0 },
  playerPosition: { x: 0, y: 0, z: 0 },
};

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
  const aimOrigin = _frameContext.aimOrigin;
  aimOrigin.x = camPos.x;
  aimOrigin.y = camPos.y;
  aimOrigin.z = camPos.z;

  const dir = _frameContext.aimDirection;
  dir.x = aimDirection.x;
  dir.y = aimDirection.y;
  dir.z = aimDirection.z;

  const pos = _frameContext.playerPosition;
  pos.x = playerFeet.x;
  pos.y = playerFeet.y;
  pos.z = playerFeet.z;

  building.controller.updateFrame(_frameContext);

  const placePressed = building.controller.consumePlacePressed();
  if (placePressed && connected) {
    building.requestPlace();
  }
}
