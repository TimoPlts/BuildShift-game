/**
 * Room identifiers shared by client and server.
 *
 * These are the single source of truth so the client and server never
 * independently invent the same string. The `ROOMS` constant maps each
 * registered Colyseus room to its stable route name.
 */
export const ROOMS = {
  /** The single Stage 2 foundation room (stateless join/leave lifecycle). */
  FOUNDATION: "foundation",
  /**
   * The Stage 2D two-player authoritative movement room. Clients join via
   * `joinOrCreate("two-player-movement")` and are routed to the
   * `TwoPlayerMovementRoom` registered on the server.
   */
  TWO_PLAYER_MOVEMENT: "two-player-movement",
} as const;

/** The foundation room type name (mirrors the server's `FOUNDATION_ROOM`). */
export type RoomType = (typeof ROOMS)[keyof typeof ROOMS];
