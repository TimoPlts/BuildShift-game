/** Player-local input: +X is camera-right and -Z is camera-forward. */
export interface LocalMovementInput {
  x: number;
  z: number;
}

/** Movement intent expressed on the fixed world X/Z axes. */
export interface WorldMovementInput {
  x: number;
  z: number;
}

export interface Position2D {
  x: number;
  z: number;
}

export interface HorizontalMovementConfig {
  moveSpeed: number;
}

/** Shared gravity / jump tuning for vertical movement. */
export interface VerticalMovementConfig {
  /** Gravity acceleration in m/s² (negative = downward). */
  gravity: number;
  /** Initial upward velocity applied on a grounded jump, in m/s. */
  jumpSpeed: number;
}

/**
 * Tuning for jump-input timing (buffer + coyote), shared by client prediction
 * and the authoritative server step.
 */
export interface JumpControllerConfig {
  /** How long (s) after a jump press it is kept buffered for a grounded launch. */
  jumpBufferTime: number;
  /** How long (s) after losing ground a jump is still allowed (coyote window). */
  coyoteTime: number;
}
