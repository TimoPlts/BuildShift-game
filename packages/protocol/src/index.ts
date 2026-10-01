/**
 * Shared network contract between client and server.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §7.3 this package holds input schemas,
 * Colyseus state schemas, event names, and message payload types shared by
 * client and server. It must contain no Babylon, React, database, or
 * Node-only code and must remain dependency-light (only `@colyseus/schema`
 * for the Schema base classes).
 *
 * Stage 2B1 introduced the first concrete contract: the authoritative
 * movement-input frame (`PlayerInputFrame` + structural validator), the
 * minimal authoritative player state (`AuthoritativePlayerState`), and the
 * room / event identifiers.
 *
 * Stage 2D introduces the Colyseus `Schema` wire types for the two-player
 * movement room: `PlayerStateSchema`, `RoomStateSchema`, and the
 * `MovementInput` message interface.
 */

export { PROTOCOL_VERSION } from "./version.js";

export {
  PLAYER_INPUT_LIMITS,
  type PlayerInputFrame,
} from "./inputs/playerInputFrame.js";

export {
  type ProtocolValidation,
  validatePlayerInputFrame,
} from "./inputs/validatePlayerInputFrame.js";

export {
  PlayerPositionSemantic,
  type AuthoritativePlayerState,
} from "./state/playerState.js";

export { ROOMS, type RoomType } from "./rooms/rooms.js";

export { EVENTS, type EventName } from "./messages/events.js";

// ─── Stage 2D: Colyseus wire schemas ────────────────────────────────────────

export {
  PlayerStateSchema,
  type PlayerStateSchemaInstance,
  type MovementInput,
  RoomStateSchema,
  type RoomStateSchemaInstance,
} from "./schemas/index.js";

/** Logical game mode identifiers. */
export type GameMode = "box-fight" | "king-of-the-tower";
