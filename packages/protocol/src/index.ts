/**
 * Shared network contract between client and server.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §7.3 this package holds input schemas,
 * Colyseus state schemas, event names, and message payload types shared by
 * client and server. It must contain no Babylon, React, database, or
 * Node-only code and must remain dependency-independent.
 *
 * Stage 2B1 introduces the first concrete contract: the authoritative
 * movement-input frame (`PlayerInputFrame` + structural validator), the
 * minimal authoritative player state (`AuthoritativePlayerState`), and the
 * room / event identifiers. Actual Colyseus `Schema` classes are implemented
 * server-side later while conforming to this shared contract — this package
 * stays plain TypeScript.
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

/** Logical game mode identifiers. */
export type GameMode = "box-fight" | "king-of-the-tower";
