import type { IntegrateVerticalConfig, IntegrateVerticalResult } from "./types.js";

/**
 * Tolerance (meters) for detecting ground contact. Positions within this
 * distance of the ground reference are treated as "on the ground".
 */
const GROUND_EPSILON = 1e-6;

/**
 * Integrates vertical position and velocity under gravity for a single fixed
 * time step. This is a pure function: it does not mutate its inputs or produce
 * any side effects.
 *
 * Semantics:
 * 1. If `jumpPressed` is true and the entity is grounded, launch with
 *    `config.jumpVelocity`.
 * 2. Apply gravity: `velocity += config.gravity * dt`.
 * 3. Integrate position: `y += velocity * dt`.
 * 4. If the new position is at or below `config.groundY`, clamp to ground,
 *    zero velocity, and report `landed = true`.
 *
 * @param y - Current Y position (meters).
 * @param velocity - Current Y velocity (m/s, positive = upward).
 * @param jumpPressed - True if a jump input is active this frame.
 * @param dt - Delta time in seconds.
 * @param config - Gravity, jump velocity, and ground reference.
 * @returns New Y position, new Y velocity, and whether the entity landed.
 */
export function integrateVerticalMovement(
  y: number,
  velocity: number,
  jumpPressed: boolean,
  dt: number,
  config: Readonly<IntegrateVerticalConfig>,
): IntegrateVerticalResult {
  let v = velocity;

  // Determine if grounded: position is at or very near ground level.
  const isGrounded = y <= config.groundY + GROUND_EPSILON;

  // Launch if jump is pressed and we're grounded.
  if (jumpPressed && isGrounded) {
    v = config.jumpVelocity;
  }

  // Apply gravity (config.gravity is negative, so this decelerates upward
  // motion and accelerates downward motion).
  v += config.gravity * dt;

  // Integrate position.
  const newY = y + v * dt;

  // Ground contact: if the position is at or below the ground reference (with
  // a small tolerance for floating-point) AND we are not moving upward, clamp
  // to ground and zero velocity.
  if (newY <= config.groundY + GROUND_EPSILON && v <= 0) {
    return { y: config.groundY, velocity: 0, landed: true };
  }

  return { y: newY, velocity: v, landed: false };
}
