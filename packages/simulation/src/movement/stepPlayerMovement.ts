import type {
  HorizontalMovementConfig,
  WorldMovementInput,
} from "./types.js";
import { stepHorizontalMovement } from "./stepHorizontalMovement.js";

/**
 * Kinematic state of a player for the canonical movement step.
 *
 * This is the plain-data state that `stepPlayerMovement` reads and writes.
 * It is intentionally a flat structure (no nested position/velocity objects)
 * so it maps directly onto the `PlayerNetworkState` wire type and is trivial
 * to serialise / compare / snapshot.
 *
 * Coordinate convention: Y-up, capsule-centre semantic.
 */
export interface PlayerMovementState {
  /** World X position, metres. */
  x: number;
  /** World Y position (up), metres. */
  y: number;
  /** World Z position, metres. */
  z: number;
  /** Velocity X, m/s. */
  vx: number;
  /** Velocity Y, m/s (positive = upward). */
  vy: number;
  /** Velocity Z, m/s. */
  vz: number;
  /** True when the player is in contact with the ground. */
  onGround: boolean;
}

/**
 * Input for one `stepPlayerMovement` call.
 *
 * The horizontal direction is expressed on the fixed world X/Z axes
 * (already rotated from local to world space by the caller via
 * `movementInputToWorld`). The jump flag is a per-tick intent edge.
 */
export interface PlayerMovementInput {
  /** World-space horizontal direction, X component (normalised, -1 to 1). */
  moveX: number;
  /** World-space horizontal direction, Z component (normalised, -1 to 1). */
  moveZ: number;
  /** Jump intent edge (`true` on the tick the player pressed jump). */
  jump: boolean;
}

/**
 * Configuration for `stepPlayerMovement`.
 *
 * Combines the horizontal movement speed with the vertical (gravity / jump /
 * terminal velocity) tuning. All values are in SI units (metres, seconds).
 */
export interface PlayerMovementConfig {
  /** Horizontal movement speed, m/s. */
  moveSpeed: number;
  /** Gravity acceleration, m/s² (negative = pulling down). */
  gravity: number;
  /** Initial upward velocity applied on a grounded jump, m/s (positive). */
  jumpVelocity: number;
  /** Terminal (maximum fall) velocity, m/s (negative). */
  terminalVelocity: number;
  /** Ground reference Y coordinate, metres. */
  groundY: number;
}

/**
 * The canonical, pure player movement step.
 *
 * This is the single deterministic function used by both the authoritative
 * server and the client predictor to advance a player's kinematic state by
 * one fixed simulation step. It:
 *
 * 1. **Jump launch:** if `input.jump` is true AND the player is on the ground,
 *    sets `vy = config.jumpVelocity` and marks the player as airborne.
 * 2. **Gravity:** applies `vy += config.gravity * deltaSeconds`.
 * 3. **Terminal velocity clamp:** if `vy < config.terminalVelocity`, clamps
 *    `vy` to `config.terminalVelocity`.
 * 4. **Vertical integration:** `y += vy * deltaSeconds`.
 * 5. **Ground check:** if `y <= config.groundY`, clamps `y` to `groundY`,
 *    zeros `vy`, and sets `onGround = true`. Otherwise `onGround = false`.
 * 6. **Horizontal movement:** delegates to {@link stepHorizontalMovement}
 *    for the X/Z position update (normalising diagonal input).
 * 7. **Horizontal velocity:** sets `vx` and `vz` to the displacement divided
 *    by `deltaSeconds` (the effective horizontal velocity for this step), so
 *    the returned state is a complete kinematic snapshot.
 *
 * The function is pure: it does not mutate its arguments and returns a fresh
 * result object.
 *
 * @param state - Current player movement state.
 * @param input - Movement input for this step (horizontal direction + jump).
 * @param deltaSeconds - Step duration in seconds.
 * @param config - Movement tuning (speed, gravity, jump, terminal, ground).
 * @returns New player movement state as a fresh object.
 */
export function stepPlayerMovement(
  state: Readonly<PlayerMovementState>,
  input: Readonly<PlayerMovementInput>,
  deltaSeconds: number,
  config: Readonly<PlayerMovementConfig>,
): PlayerMovementState {
  // ── Vertical step ──────────────────────────────────────────────────────
  let vy = state.vy;
  let onGround = state.onGround;

  // 1) Jump launch: only when grounded and jump is pressed.
  if (input.jump && onGround) {
    vy = config.jumpVelocity;
    onGround = false;
  }

  // 2) Apply gravity (config.gravity is negative, so this decelerates upward
  //    motion and accelerates downward motion).
  vy += config.gravity * deltaSeconds;

  // 3) Terminal-velocity clamp.
  if (vy < config.terminalVelocity) {
    vy = config.terminalVelocity;
  }

  // 4) Integrate vertical position.
  let y = state.y + vy * deltaSeconds;

  // 5) Ground check: clamp to ground and zero velocity.
  if (y <= config.groundY) {
    y = config.groundY;
    vy = 0;
    onGround = true;
  }

  // ── Horizontal step ────────────────────────────────────────────────────
  const worldInput: WorldMovementInput = { x: input.moveX, z: input.moveZ };
  const horizontalConfig: HorizontalMovementConfig = {
    moveSpeed: config.moveSpeed,
  };

  const horizontal = stepHorizontalMovement(
    { x: state.x, z: state.z },
    worldInput,
    deltaSeconds,
    horizontalConfig,
  );

  // 7) Compute horizontal velocity (displacement / dt) so the returned
  //    state is a complete kinematic snapshot.
  const vx = deltaSeconds > 0 ? (horizontal.x - state.x) / deltaSeconds : 0;
  const vz = deltaSeconds > 0 ? (horizontal.z - state.z) / deltaSeconds : 0;

  return {
    x: horizontal.x,
    y,
    z: horizontal.z,
    vx,
    vy,
    vz,
    onGround,
  };
}
