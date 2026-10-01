/**
 * Legacy re-export shim.
 *
 * All two-player networking logic has been consolidated into
 * `../network/twoPlayer/`. This file exists only for backward
 * compatibility with any remaining imports from the old `net/` path.
 *
 * Prefer importing directly from `../network/twoPlayer`.
 */
export * from "../network/twoPlayer";
