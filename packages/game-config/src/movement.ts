/** Shared horizontal movement tuning used by client and server simulation. */
export const PLAYER_MOVEMENT = {
  moveSpeed: 6,
} as const;

/**
 * Shared vertical-movement tuning (gravity + jump) used by the pure
 * {@link integrateVerticalMovement} step and the full-state vertical step in
 * `@buildshift/simulation`.
 *
 * These are game-tuned values, not physical constants. The examples are
 * representative for an action-platformer feel.
 */
export const VERTICAL_MOVEMENT = {
  /** Gravity acceleration in m/s² (negative = pulling down). */
  gravity: -20,
  /** Initial upward velocity applied on a grounded jump, in m/s. */
  jumpVelocity: 8,
  /** Terminal velocity clamp in m/s (negative = maximum downward speed). */
  maxFallSpeed: -30,
  /** Default ground reference Y coordinate (meters). */
  groundY: 0,
  /** Capsule half-height in meters, used for ground-check tolerance. */
  playerHalfHeight: 0.9,
} as const;
