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
 *
 * Stage 2D (consolidated) introduces the canonical two-player multiplayer
 * movement contract: `PlayerNetworkInput`, `PlayerNetworkState`,
 * `GameStateSchema`, and the `GAME_MODES` / `GameModeId` identifiers.
 *
 * The first combat milestone adds the server-authoritative hitscan contract:
 * the `PlayerInput` per-tick input payload, the combat `EVENTS`
 * (`HIT` / `ELIMINATED` / `HEALTH_UPDATE`) and the `HitEventPayload` message
 * type, and the authoritative `health` / `alive` fields on
 * `PlayerStateSchema`.
 */

export { PROTOCOL_VERSION } from "./version.js";

export {
  PLAYER_INPUT_LIMITS,
  type PlayerInputFrame,
} from "./inputs/playerInputFrame.js";

export {
  type PlayerNetworkInput,
  PLAYER_NETWORK_INPUT_LIMITS,
} from "./inputs/playerNetworkInput.js";

export { type PlayerInput } from "./inputs/playerInput.js";

export {
  type ProtocolValidation,
  validatePlayerInputFrame,
} from "./inputs/validatePlayerInputFrame.js";

export {
  validatePlayerNetworkInput,
} from "./inputs/validatePlayerNetworkInput.js";

export {
  PlayerPositionSemantic,
  type AuthoritativePlayerState,
} from "./state/playerState.js";

export { ROOMS, type RoomType } from "./rooms/rooms.js";

// ─── Event identifiers + combat payloads (single source of truth) ────────
export {
  EVENTS,
  type EventName,
  type HitEventPayload,
} from "./events/index.js";

// ─── Stage 2D: Colyseus wire schemas ───────────────────────────────────────

export {
  PlayerStateSchema,
  type PlayerStateSchemaInstance,
  type MovementInput,
  RoomStateSchema,
  type RoomStateSchemaInstance,
} from "./schemas/index.js";

// ─── Stage 2D (consolidated): canonical movement contract ─────────────────

export {
  type PlayerNetworkState,
} from "./schemas/playerNetworkState.js";

export {
  type GameStateSchema,
} from "./schemas/gameStateSchema.js";

export {
  GAME_MODES,
  GAME_MODE_IDS,
  type GameModeId,
} from "./gameModes.js";

/** Logical game mode identifiers (legacy union type, kept for compat). */
export type GameMode = "box-fight" | "king-of-the-tower";
