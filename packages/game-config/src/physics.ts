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

/**
 * Shared jump-input timing tuning (used by the client's JumpController and,
 * later, the authoritative server step).
 *
 * Both values are deliberately modest so the aids feel responsive without
 * turning into a double-jump. They are expressed in seconds because they are
 * pure timing windows consumed by fixed simulation steps.
 */
export const JUMP_INPUT_TIMING = {
  /**
   * Jump buffer (s): how long a jump press is remembered so a press that lands
   * just before the character becomes grounded still triggers a jump.
   */
  jumpBufferTime: 0.12,
  /**
   * Coyote time (s): how long after leaving the ground a jump is still allowed
   * (e.g. walking off a ledge).
   */
  coyoteTime: 0.1,
} as const;
