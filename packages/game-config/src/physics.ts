/**
 * Shared vertical-movement (gravity / jump) tuning used by the client and
 * (later) the server simulation. Kept here so gravity and jump feel are not
 * scattered across PlayerController and PhysicsWorld.
 *
 * These are game-tuned values, not physical constants: action games use
 * stronger-than-real gravity and a snappy jump so vertical movement feels
 * responsive. Tuned in the browser during Stage 1D.
 */
export const PLAYER_PHYSICS = {
  /** Gravity acceleration in m/s² (negative = downward). */
  gravity: -25,
  /** Initial upward velocity applied on a grounded jump, in m/s. */
  jumpSpeed: 9,
} as const;
