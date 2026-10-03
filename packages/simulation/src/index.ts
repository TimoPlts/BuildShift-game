/**
 * Shared game simulation rules.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §7.4 this package contains the movement,
 * physics, combat, building, and energy *math* that can run on both client and
 * server. Keeping it platform-independent is what enables client-side
 * prediction to reuse the exact same step the server uses for authority.
 *
 * It depends only on `@buildshift/game-config` (shared balance values) to keep
 * the platform-specific surface minimal.
 */
import { GAME_CONFIG_VERSION } from "@buildshift/game-config";

export { movementInputToWorld } from "./movement/movementInputToWorld.js";
export { stepHorizontalMovement } from "./movement/stepHorizontalMovement.js";
export { stepVerticalMovement } from "./movement/stepVerticalMovement.js";
export { integrateVerticalMovement } from "./movement/integrateVerticalMovement.js";
export { JumpController } from "./movement/jumpController.js";
export { stepFullMovement } from "./movement/verticalMovement.js";
// The full-state vertical step is aliased to avoid a name collision with the
// legacy velocity-only `stepVerticalMovement` (kept for the existing
// game-server / web-app integrations).
export { stepVerticalMovement as stepVerticalState } from "./movement/verticalMovement.js";

// ───── Canonical player movement step (Stage 2D consolidated) ─────

export {
  stepPlayerMovement,
  type PlayerMovementState,
  type PlayerMovementInput,
  type PlayerMovementConfig,
} from "./movement/stepPlayerMovement.js";

export type {
  FullMovementState,
  HorizontalMovementConfig,
  IntegrateVerticalConfig,
  IntegrateVerticalResult,
  JumpControllerConfig,
  JumpControllerState,
  LocalMovementInput,
  Position2D,
  VerticalInput,
  VerticalMovementConfig,
  VerticalState,
  VerticalStepResult,
  WorldMovementInput,
} from "./movement/types.js";

// ───── Combat (canonical hitscan contract) ─────

export {
  rayIntersectsCapsule,
  distance3d,
  hitscan,
  DEFAULT_TARGET_RADIUS,
  type Vec3,
  type RayIntersectionResult,
  type HitscanTarget,
  type HitscanWeapon,
  type HitscanHit,
} from "./combat/hitscan.js";

export {
  canFire,
  fireGate,
  type CanFireConfig,
  type FireGateInput,
  type FireGateResult,
  type FireGateRejectionReason,
} from "./combat/fireGate.js";

// ───── Round / match lifecycle state machine ─────

export {
  advanceRoundState,
  type RoundEvent,
  type RoundTransition,
} from "./round-state-machine.js";

/**
 * Version of the simulation rules. Client and server must stay synchronized on
 * this (see docs/TECHNICAL_ARCHITECTURE.md §18 "Physics and Prediction Rule").
 */
export const SIMULATION_VERSION = "0.2.0" as const;

/**
 * Resolves the shared game-config version used by the simulation.
 * Placeholder demonstrating the cross-package dependency; real simulation
 * helpers will be added in a later stage.
 */
export function gameConfigVersion(): string {
  return GAME_CONFIG_VERSION;
}
