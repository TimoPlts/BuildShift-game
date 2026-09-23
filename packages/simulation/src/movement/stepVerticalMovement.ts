import type { VerticalMovementConfig } from "./types.js";

/**
 * Integrates vertical motion under gravity for a single fixed step.
 *
 * The input is the *previous* frame's grounded state (ground contact is
 * reported by the physics layer after the step, so it lags by one step). The
 * jump decision and the grounded downward-velocity clamp both use that lagged
 * value, which is the standard kinematic-character pattern.
 *
 * Rules:
 * - A grounded character that requests a jump starts the step at `jumpSpeed`.
 * - Gravity is then integrated: `verticalVelocity += gravity * deltaSeconds`.
 * - A grounded character never accumulates downward velocity into the floor,
 *   so standing still reads as `verticalVelocity = 0`.
 *
 * The returned velocity is what the caller turns into a vertical displacement
 * (`velocity * deltaSeconds`) and hands to the physics layer; it is *not* a
 * world position.
 */
export function stepVerticalMovement(
  verticalVelocity: number,
  jumpRequested: boolean,
  grounded: boolean,
  deltaSeconds: number,
  config: Readonly<VerticalMovementConfig>,
): number {
  let velocity = verticalVelocity;

  if (jumpRequested && grounded) {
    velocity = config.jumpSpeed;
  }

  velocity += config.gravity * deltaSeconds;

  if (grounded && velocity < 0) {
    velocity = 0;
  }

  return velocity;
}
