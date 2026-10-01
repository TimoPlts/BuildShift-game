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

/**
 * Shared gravity / jump tuning for vertical movement.
 *
 * The first two fields (`gravity`, `jumpSpeed`) are required and used by the
 * legacy velocity-only `stepVerticalMovement`. The optional fields
 * (`jumpVelocity`, `maxFallSpeed`, `groundY`, `playerHalfHeight`) are used by
 * the full-state `stepVerticalMovement` in `verticalMovement.ts` and are
 * expected to be provided by the shared `VERTICAL_MOVEMENT` config.
 */
export interface VerticalMovementConfig {
  /** Gravity acceleration in m/s² (negative = downward). */
  gravity: number;
  /** Initial upward velocity applied on a grounded jump (legacy, m/s). */
  jumpSpeed: number;
  /** Initial upward velocity (preferred name for the full-state step, m/s). */
  jumpVelocity?: number;
  /** Terminal velocity clamp in m/s (negative = maximum downward speed). */
  maxFallSpeed?: number;
  /** Ground reference Y coordinate (meters). */
  groundY?: number;
  /** Capsule half-height in meters, used for ground-check tolerance. */
  playerHalfHeight?: number;
}

/**
 * Configuration for the full vertical-position integrator
 * ({@link integrateVerticalMovement}). Unlike {@link VerticalMovementConfig}
 * (velocity-only step), this includes a ground reference so the integrator
 * can clamp position and report landing.
 */
export interface IntegrateVerticalConfig {
  /** Gravity acceleration in m/s² (negative = downward). */
  gravity: number;
  /** Initial upward velocity applied on a grounded jump, in m/s. */
  jumpVelocity: number;
  /** Ground reference Y coordinate (meters). */
  groundY: number;
}

/** Result of a single vertical position-velocity integration step. */
export interface IntegrateVerticalResult {
  /** New Y position (meters) after the step. */
  y: number;
  /** New Y velocity (m/s) after the step. */
  velocity: number;
  /** True if the entity is on (or was clamped to) the ground at end of step. */
  landed: boolean;
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

/** Vertical kinematic state (position + velocity + ground contact). */
export interface VerticalState {
  y: number;
  velocityY: number;
  grounded: boolean;
}

/** Vertical input for one simulation step. */
export interface VerticalInput {
  jump: boolean;
}

/** Result of a single full-state vertical movement step. */
export interface VerticalStepResult {
  y: number;
  velocityY: number;
  grounded: boolean;
}

/**
 * Full player movement state combining horizontal position, orientation,
 * and vertical kinematics. Used by {@link stepFullMovement} to step both
 * horizontal and vertical axes in one call.
 */
export interface FullMovementState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  velocityY: number;
  grounded: boolean;
}
