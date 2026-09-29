/**
 * Shared character physics / character-controller / fixed-timing configuration.
 *
 * These values describe the *local player's physical character* and the fixed
 * simulation timestep. They live here (data only, no engine imports) so the
 * client and the (later) authoritative server simulation use the exact same
 * collider dimensions, controller tuning, and substep duration — the
 * prerequisite for server-authoritative movement in Stage 2C1.
 *
 * The Rapier capsule's total height is `2 * (halfHeight + radius)`. With
 * `halfHeight = 0.55` and `radius = 0.35` that is exactly `1.8` m, so the
 * physical capsule matches the visible mesh (see docs/GAME_DESIGN.md).
 */

/** The local player's physical collider (a Rapier capsule). */
export const PLAYER_COLLIDER = {
  /** Capsule radius, in metres. */
  radius: 0.35,
  /**
   * Capsule half-height, in metres (the cylindrical half-length, excluding the
   * hemispherical caps). The total capsule height is `2 * (halfHeight +
   * radius)`.
   */
  halfHeight: 0.55,
} as const;

/** Half the total capsule height (centre to feet), derived — do not retune. */
export const PLAYER_COLLIDER_HALF_TOTAL_HEIGHT =
  PLAYER_COLLIDER.halfHeight + PLAYER_COLLIDER.radius;

/**
 * Total capsule height (feet to head), derived — do not retune.
 *
 * A Rapier capsule of half-height `h` and radius `r` spans
 * `2 * (h + r)` vertically, which is exactly `2 * PLAYER_COLLIDER_HALF_TOTAL_HEIGHT`.
 */
export const PLAYER_COLLIDER_TOTAL_HEIGHT =
  2 * PLAYER_COLLIDER_HALF_TOTAL_HEIGHT;

/**
 * Character-controller tuning. A small non-zero contact offset keeps the
 * capsule from sitting exactly on a collider's face (avoids precision /
 * contact jitter). The snap-to-ground distance is deliberately well below the
 * jump apex so it stabilises over tiny height transitions without pulling a
 * jumping character back down.
 */
export const PLAYER_CHARACTER_CONTROLLER = {
  /** Contact offset, in metres. */
  contactOffset: 0.02,
  /** Snap-to-ground distance, in metres. */
  snapToGround: 0.1,
  /** Whether the controller auto-steps up small ledges (disabled in Stage 1E). */
  autostepEnabled: false,
} as const;

/**
 * Fixed simulation timestep. The client (and later the server) advance
 * movement/physics in whole steps of this duration, decoupled from the
 * variable render rate, for deterministic collision / gravity / jump.
 */
export const PHYSICS_TIMING = {
  /** Fixed substep duration, in seconds (60 Hz). */
  fixedStepDurationSeconds: 1 / 60,
} as const;
