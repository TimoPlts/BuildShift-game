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
  /**
   * Terminal velocity clamp in m/s (negative = maximum downward speed).
   * This is the canonical name for the fall-speed limit. `maxFallSpeed`
   * below is kept as a legacy alias for backward compatibility.
   */
  terminalVelocity: -40,
  /**
   * Legacy alias for `terminalVelocity`. Kept so existing consumers of
   * `VERTICAL_MOVEMENT.maxFallSpeed` continue to work.
   * @deprecated Use `terminalVelocity` instead.
   */
  maxFallSpeed: -40,
  /** Default ground reference Y coordinate (meters). */
  groundY: 0,
  /**
   * Capsule half-height in meters, used for ground-check tolerance.
   * Matches `PLAYER_COLLIDER.halfHeight + PLAYER_COLLIDER.radius` from
   * `character.ts` (0.55 + 0.35 = 0.9).
   */
  playerHalfHeight: 0.9,
  /**
   * Capsule radius in meters, used for ground snapping and collision
   * tolerance. Matches `PLAYER_COLLIDER.radius` from `character.ts`.
   */
  capsuleRadius: 0.35,
} as const;
