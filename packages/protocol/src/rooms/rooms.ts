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
} as const;

/** The foundation room type name (mirrors the server's `FOUNDATION_ROOM`). */
export type RoomType = (typeof ROOMS)[keyof typeof ROOMS];
