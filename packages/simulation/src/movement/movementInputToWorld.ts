import type {
  LocalMovementInput,
  WorldMovementInput,
} from "./types.js";

/**
 * Rotates player-local movement into world X/Z space.
 * Yaw zero faces -Z; positive yaw rotates forward toward +X.
 *
 * Babylon's yaw-zero third-person camera looks toward world -Z, so its
 * visual camera-right direction is world -X. At yaw θ the matching basis is:
 * forward = (sin θ, -cos θ), right = (-cos θ, -sin θ).
 */
export function movementInputToWorld(
  input: Readonly<LocalMovementInput>,
  yawRadians: number,
): WorldMovementInput {
  const cosine = Math.cos(yawRadians);
  const sine = Math.sin(yawRadians);

  return {
    x: -input.x * cosine - input.z * sine,
    z: -input.x * sine + input.z * cosine,
  };
}
