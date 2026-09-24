/**
 * Centralized gameplay configuration.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §7.5, shared balance values (movement,
 * energy, weapons, modes, networking) will live in this package so they are
 * not scattered across the codebase.
 */
export { PLAYER_MOVEMENT } from "./movement.js";
export { JUMP_INPUT_TIMING, PLAYER_PHYSICS } from "./physics.js";

export const GAME_CONFIG_VERSION = "0.1.0" as const;
