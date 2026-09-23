import type {
  LocalMovementInput,
  WorldMovementInput,
} from "./types.js";

/**
 * Rotates player-local movement into world X/Z space.
 * Yaw zero faces -Z; positive yaw rotates forward toward +X.
 */
export function movementInputToWorld(
  input: Readonly<LocalMovementInput>,
  yawRadians: number,
): WorldMovementInput {
  const cosine = Math.cos(yawRadians);
  const sine = Math.sin(yawRadians);

  return {
    x: input.x * cosine - input.z * sine,
    z: input.x * sine + input.z * cosine,
  };
}
