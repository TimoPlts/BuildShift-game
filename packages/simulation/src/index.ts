/**
 * Shared game simulation rules.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §7.4 this package contains the movement,
 * physics, combat, building, and energy *math* that can run on both client and
 * server. Keeping it platform-independent is what enables client-side
 * prediction to reuse the exact same step the server uses for authority.
 *
 * No simulation logic is implemented yet — this is the scaffold. It depends
 * only on `@buildshift/game-config` (shared balance values) to keep the
 * platform-specific surface minimal.
 */
import { GAME_CONFIG_VERSION } from "@buildshift/game-config";

/**
 * Version of the simulation rules. Client and server must stay synchronized on
 * this (see docs/TECHNICAL_ARCHITECTURE.md §18 "Physics and Prediction Rule").
 */
export const SIMULATION_VERSION = "0.1.0" as const;

/**
 * Resolves the shared game-config version used by the simulation.
 * Placeholder demonstrating the cross-package dependency; real simulation
 * helpers will be added in a later stage.
 */
export function gameConfigVersion(): string {
  return GAME_CONFIG_VERSION;
}
