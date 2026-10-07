/**
 * Shared game-mode identifiers.
 *
 * A single source of truth so the client and server reference the same
 * mode identifier rather than independently inventing magic strings.
 *
 * The `GAME_MODES` constant maps each mode to a stable string id that
 * the room registry (server) and the client's room joiner both use.
 */
export const GAME_MODES = {
  /** The canonical Energy Box Fight mode. */
  BOX_FIGHT: "box-fight",
  /** Legacy king-of-the-tower mode (placeholder for future content). */
  KING_OF_THE_TOWER: "king-of-the-tower",
} as const;

/** A valid game-mode identifier string. */
export type GameModeId = (typeof GAME_MODES)[keyof typeof GAME_MODES];

/**
 * The set of all valid game-mode identifiers as a tuple (for runtime
 * membership checks).
 */
export const GAME_MODE_IDS = Object.values(GAME_MODES) as readonly GameModeId[];
