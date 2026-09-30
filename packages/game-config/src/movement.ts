/** Shared horizontal movement tuning used by client and server simulation. */
export const PLAYER_MOVEMENT = {
  moveSpeed: 6,
} as const;

/**
 * Shared vertical-movement tuning (gravity + jump) used by the pure
 * {@link integrateVerticalMovement} step in `@buildshift/simulation`.
 *
 * These are game-tuned values, not physical constants. The examples are
 * representative for an action-platformer feel.
 */
export const VERTICAL_MOVEMENT = {
  /** Gravity acceleration in m/s² (negative = pulling down). */
  gravity: -20,
  /** Initial upward velocity applied on a grounded jump, in m/s. */
  jumpVelocity: 8,
  /** Default ground reference Y coordinate (meters). */
  groundY: 0,
} as const;
