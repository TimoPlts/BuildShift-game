import { PLAYER_MOVEMENT } from "@buildshift/game-config";
import { movementInputToWorld } from "@buildshift/simulation";

/**
 * The explicit, camera-relative movement intent for one prediction substep —
 * the local (normalised) axes plus the facing yaw. This is the same intent the
 * batcher captures once per prediction batch and reuses for both substeps.
 */
export interface PredictionMovementIntent {
  moveX: number;
  moveZ: number;
  lookYaw: number;
}

/**
 * Computes the *desired* world-space translation for one fixed prediction
 * substep from an explicit movement intent, using the shared simulation math
 * — the exact same `movementInputToWorld` the authoritative server uses.
 *
 * Extracted from `PlayerController.update` as a pure function so the
 * explicit-input boundary (the controller no longer reads the browser
 * `InputManager`) is unit-testable without a Babylon scene, Rapier world, or
 * `InputManager`. Diagonal input is normalised to unit length, matching both
 * the local player and the server.
 *
 * `lookYaw` uses the shared convention: yaw 0 faces -Z, positive rotates
 * toward +X.
 */
export function computePredictionTranslation(
  intent: PredictionMovementIntent,
  deltaSeconds: number,
): { x: number; z: number } {
  const worldInput = movementInputToWorld(
    { x: intent.moveX, z: intent.moveZ },
    intent.lookYaw,
  );
  const inputLength = Math.hypot(worldInput.x, worldInput.z);
  const normalization = inputLength > 1 ? 1 / inputLength : 1;
  const distance = PLAYER_MOVEMENT.moveSpeed * deltaSeconds;
  return {
    x: worldInput.x * normalization * distance,
    z: worldInput.z * normalization * distance,
  };
}
