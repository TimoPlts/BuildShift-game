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

/**
 * Deterministic internal timing state of {@link JumpController}, captured and
 * restored by the snapshot API.
 *
 * This is intentionally a plain-data value: no references, no closures, no
 * physics or rendering types — so it can round-trip through structured-clone
 * or JSON between client prediction and the authoritative server step
 * (see docs/TECHNICAL_ARCHITECTURE.md §7.4 / §18).
 *
 * Both fields are remaining seconds, bounded by the controller's configured
 * `jumpBufferTime` / `coyoteTime` at the moment of capture, and non-negative.
 */
export interface JumpControllerState {
  /** Remaining (s) that the buffered press will stay valid. */
  jumpBufferRemaining: number;
  /** Remaining (s) that the coyote window is active. */
  coyoteRemaining: number;
}
