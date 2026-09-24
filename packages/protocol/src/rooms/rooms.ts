/**
 * Room identifiers shared by client and server.
 *
 * These are the single source of truth so the client and server never
 * independently invent the same string. The current Stage 2 foundation exposes
 * exactly one room (`FOUNDATION_ROOM`); it is named after the server's
 * `FoundationRoom` (see `apps/game-server/src/server.ts`, which already
 * registers `"foundation"`).
 *
 * Naming is forward-compatible but minimal: only the room that exists today is
 * declared. Future game-mode rooms are intentionally *not* pre-declared here.
 */
export const ROOMS = {
  /** The single Stage 2 foundation room (stateless join/leave lifecycle). */
  FOUNDATION: "foundation",
} as const;

/** The foundation room type name (mirrors the server's `FOUNDATION_ROOM`). */
export type RoomType = (typeof ROOMS)[keyof typeof ROOMS];
