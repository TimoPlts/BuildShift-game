/**
 * buildingFrameUpdate — the per-frame driving step for the building system,
 * called once per render frame by the GameRuntime.
 *
 * Keeps the runtime wiring a single call:
 *
 *   1. recomputes the grid-snapped placement preview from the current aim
 *      ray / player position / selected build type (the current
 *      camera/grid target);
 *   2. drives held-primary rapid placement ("turbo building"): when the
 *      routed build-owned primary is held (or just pressed) and the player is
 *      connected **and in an active round**, submits a placement intent for
 *      the (valid) preview, rate-limited to one request per
 *      `PLACEMENT_REQUEST_INTERVAL_MS`. The press edge rides the same
 *      rate-limited path, so a quick click places exactly once and can
 *      never double the held stream.
 *
 * The primary button's browser state is owned by the centralized
 * `InputManager`; the runtime hands over the *routed* build values
 * (from `routePrimaryAction`), so the weapon path and the building path
 * never see the same press/hold as theirs. Placement requests are only
 * *sent* when connected and the round is `IN_PROGRESS`: while disconnected
 * or outside the round there is no authoritative server to accept them
 * (the server rejects placement outside `IN_PROGRESS`), and the server's
 * validation (overlap / rate / energy) remains the final authority on
 * acceptance.
 */
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { BuildingController } from "./buildingController";

/**
 * The narrow building-system surface the frame driver needs. The full
 * {@link BuildingSystem} satisfies it structurally; tests can pass a bare
 * controller.
 */
export interface BuildingFrameDriver {
  readonly controller: BuildingController;
}

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
 * @param primaryHeld the routed build-owned primary hold (from
 *        `routePrimaryAction` over the centralized `InputManager` state).
 * @param nowMs the monotonic frame clock in ms (defaults to
 *        `performance.now()`); injectable for deterministic tests.
 * @param inRound whether the match phase is `IN_PROGRESS` (default `true`):
 *        placement intents are only submitted while the server can accept
 *        them. The preview/ghost keeps updating regardless, so the HUD stays
 *        live outside the round.
 * @param primaryPressed the routed build-owned primary press edge (from
 *        `routePrimaryAction`); it joins the same rate-limited submission
 *        path as the hold, so single-click placement is reliable.
 */
export function updateBuildingFrame(
  building: BuildingFrameDriver,
  camera: Camera,
  aimDirection: Vector3,
  playerFeet: Vector3,
  connected: boolean,
  primaryHeld: boolean,
  nowMs?: number,
  inRound = true,
  primaryPressed = false,
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

  if (connected && inRound) {
    building.controller.pollHeldPlacement(
      nowMs ?? performance.now(),
      primaryHeld || primaryPressed,
    );
  }
}
