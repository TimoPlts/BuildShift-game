import type {
  FullMovementState,
  HorizontalMovementConfig,
  VerticalInput,
  VerticalMovementConfig,
  VerticalState,
  VerticalStepResult,
  WorldMovementInput,
} from "./types.js";
import { stepHorizontalMovement } from "./stepHorizontalMovement.js";

/**
 * Pure full-state vertical movement step (gravity, jump, land).
 *
 * This is the single, deterministic vertical step used by both the
 * authoritative server and the client predictor (per
 * docs/TECHNICAL_ARCHITECTURE.md §7.4 / §18). It operates on a
 * position + velocity + grounded-flag state object, so it can be composed
 * with horizontal stepping into a full movement step.
 *
 * Rules (in order):
 * 1. Jump launch: if `input.jump` is true AND the entity is grounded,
 *    set `velocityY = config.jumpVelocity` (or `config.jumpSpeed` fallback)
 *    and mark the entity as airborne.
 * 2. Apply gravity: `velocityY += config.gravity * deltaSeconds`.
 * 3. Terminal-velocity clamp: if `velocityY < config.maxFallSpeed`,
 *    set `velocityY = config.maxFallSpeed`.
 * 4. Integrate position: `y += velocityY * deltaSeconds`.
 * 5. Ground check: if `y <= config.groundY`, clamp `y` to `groundY`,
 *    zero `velocityY`, and set `grounded = true`.
 * 6. Otherwise `grounded = false`.
 *
 * The function is pure: it does not mutate its arguments and returns a fresh
 * result object.
 *
 * @param state - Current vertical state (y, velocityY, grounded).
 * @param input - Vertical input for this step (jump).
 * @param deltaSeconds - Step duration in seconds.
 * @param config - Gravity, jump velocity, terminal velocity, and ground
 *   reference tuning.
 * @returns New vertical state as a fresh object.
 */
export function stepVerticalMovement(
  state: Readonly<VerticalState>,
  input: Readonly<VerticalInput>,
  deltaSeconds: number,
  config: Readonly<VerticalMovementConfig>,
): VerticalStepResult {
  // Resolve config fields with sensible fallbacks for backward-compatible
  // configs that only have `jumpSpeed` but not the newer optional fields.
  const jumpVelocity = config.jumpVelocity ?? config.jumpSpeed;
  const maxFallSpeed = config.maxFallSpeed ?? -Infinity;
  const groundY = config.groundY ?? 0;

  let velocityY = state.velocityY;
  let grounded = state.grounded;

  // 1) Jump launch.
  if (input.jump && grounded) {
    velocityY = jumpVelocity;
    grounded = false;
  }

  // 2) Apply gravity.
  velocityY += config.gravity * deltaSeconds;

  // 3) Terminal-velocity clamp.
  if (velocityY < maxFallSpeed) {
    velocityY = maxFallSpeed;
  }

  // 4) Integrate position.
  const y = state.y + velocityY * deltaSeconds;

  // 5) Ground check.
  if (y <= groundY) {
    return { y: groundY, velocityY: 0, grounded: true };
  }

  // 6) Airborne.
  return { y, velocityY, grounded: false };
}

/**
 * Convenience function that steps both horizontal and vertical movement in
 * one call, producing a full movement state update.
 *
 * This composes {@link stepHorizontalMovement} (x/z) with
 * {@link stepVerticalMovement} (y) and passes `yaw` through unchanged.
 * The same deterministic stepping logic runs on both the authoritative server
 * and the client predictor.
 *
 * @param state - Current full movement state.
 * @param worldInput - World-space horizontal movement input.
 * @param verticalInput - Vertical input (jump).
 * @param deltaSeconds - Step duration in seconds.
 * @param horizontalConfig - Horizontal movement tuning (moveSpeed).
 * @param verticalConfig - Vertical movement tuning (gravity, jump, etc.).
 * @returns New full movement state as a fresh object.
 */
export function stepFullMovement(
  state: Readonly<FullMovementState>,
  worldInput: Readonly<WorldMovementInput>,
  verticalInput: Readonly<VerticalInput>,
  deltaSeconds: number,
  horizontalConfig: Readonly<HorizontalMovementConfig>,
  verticalConfig: Readonly<VerticalMovementConfig>,
): FullMovementState {
  const horizontal = stepHorizontalMovement(
    { x: state.x, z: state.z },
    worldInput,
    deltaSeconds,
    horizontalConfig,
  );

  const vertical = stepVerticalMovement(
    { y: state.y, velocityY: state.velocityY, grounded: state.grounded },
    verticalInput,
    deltaSeconds,
    verticalConfig,
  );

  return {
    x: horizontal.x,
    y: vertical.y,
    z: horizontal.z,
    yaw: state.yaw,
    velocityY: vertical.velocityY,
    grounded: vertical.grounded,
  };
}
