/**
 * Barrel export for the game server rooms.
 *
 * The canonical authoritative gameplay path is {@link TwoPlayerMovementRoom},
 * which drives movement AND hitscan combat in a single 30 Hz tick loop.
 */
export {
  TwoPlayerMovementRoom,
  TWO_PLAYER_MOVEMENT_ROOM,
  TWO_PLAYER_MOVEMENT_INPUT,
} from "./TwoPlayerMovementRoom.js";
