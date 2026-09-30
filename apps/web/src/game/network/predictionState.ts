import type { JumpControllerState } from "@buildshift/simulation";

/**
 * A plain 3D position (world X/Z, Y up). Deliberately a structural type (no
 * Babylon `Vector3`) so this module stays pure and node-testable.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * The deterministic local prediction state — the complete LOCAL state required
 * to resume prediction from a checkpoint (Stage 2C2B).
 *
 * It is captured once per completed two-substep prediction batch (i.e. *after*
 * both 1/60 substeps for one input sample) and stored in {@link PredictionHistory}
 * keyed by the input sequence.
 *
 * Authority limitation (documented in `reconciliation.ts`): the authoritative
 * wire contract carries only `position`, `yaw`, and `acknowledgedSequence`. It
 * deliberately does NOT carry `verticalVelocity`, `lastGrounded`, or the
 * `JumpController` timers. So when correcting at an acknowledged sequence the
 * authoritative POSITION and YAW come from the server, while the remaining
 * deterministic internal state comes from the client's stored checkpoint. This
 * is valid because client and server share the same movement / jump / timing /
 * arena / Rapier configuration (docs/TECHNICAL_ARCHITECTURE.md §18).
 *
 * `jump` reuses the shared `JumpControllerState` snapshot type and is restored
 * through `JumpController.restoreState`, which validates it against the
 * controller's configured bounds.
 */
export interface PredictionState {
  /** Capsule-centre position (the physics body translation). */
  position: Vec3;
  /** Vertical (world-Y) velocity carried between fixed steps, in m/s. */
  verticalVelocity: number;
  /** Grounded from the previous fixed step — used for jump eligibility. */
  lastGrounded: boolean;
  /** JumpController buffer / coyote timing (shared snapshot type). */
  jump: JumpControllerState;
  /** Facing yaw (radians) for presentation restoration (yaw 0 faces -Z). */
  facingYaw: number;
}

/**
 * Deep-copies a {@link PredictionState} so a stored checkpoint can never be
 * mutated by later simulation. Every nested object (`position`, `jump`) is
 * copied by value; scalar fields are copied directly.
 */
export function clonePredictionState(
  state: Readonly<PredictionState>,
): PredictionState {
  return {
    position: { x: state.position.x, y: state.position.y, z: state.position.z },
    verticalVelocity: state.verticalVelocity,
    lastGrounded: state.lastGrounded,
    jump: {
      jumpBufferRemaining: state.jump.jumpBufferRemaining,
      coyoteRemaining: state.jump.coyoteRemaining,
    },
    facingYaw: state.facingYaw,
  };
}
