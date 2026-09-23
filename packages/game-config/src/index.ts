/**
 * Centralized gameplay configuration.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §7.5, shared balance values (movement,
 * energy, weapons, modes, networking) will live in this package so they are
 * not scattered across the codebase. No gameplay values are defined yet —
 * this package is the scaffold where they will be added in a later stage.
 */
export const GAME_CONFIG_VERSION = "0.1.0" as const;
