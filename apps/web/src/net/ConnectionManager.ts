/**
 * Legacy re-export shim for ConnectionManager.
 *
 * Connection management has been consolidated into `TwoPlayerClient` in
 * `../network/twoPlayer/TwoPlayerClient`. This shim re-exports it under
 * the old name for backward compatibility.
 *
 * This file adds zero logic — it only re-exports the same bindings.
 */
export {
  TwoPlayerClient as ConnectionManager,
  TWO_PLAYER_ROOM_NAME,
  MOVEMENT_INPUT_TYPE,
  type TwoPlayerClientOptions,
  type RoomLike,
  type ParsedRoomState,
  type ParsedPlayerState,
} from "../network/twoPlayer/TwoPlayerClient";
