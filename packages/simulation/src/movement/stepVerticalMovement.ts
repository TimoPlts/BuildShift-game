import type { VerticalMovementConfig } from "./types.js";

/**
 * Integrates vertical motion under gravity for a single fixed step.
 *
 * The jump *decision* is now made by the caller (see {@link JumpController}),
 * which owns the jump-buffer / coyote-time timing. `jumpRequested` therefore
 * means "a jump should launch on this step", not merely "a key was pressed".
 * The `grounded` flag is the *previous* step's ground-contact state (reported
 * by the physics layer after each step, so it lags by one step) and is used
 * only for the grounded downward-velocity clamp.
 *
 * Rules:
 * - When a jump launches this step, the velocity starts at `jumpSpeed`.
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

  if (jumpRequested) {
    velocity = config.jumpSpeed;
  }

  velocity += config.gravity * deltaSeconds;

  if (grounded && velocity < 0) {
    velocity = 0;
  }

  return velocity;
}
