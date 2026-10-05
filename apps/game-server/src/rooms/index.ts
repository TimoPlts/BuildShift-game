/**
 * Barrel export for the game server rooms.
 *
 * The canonical authoritative gameplay path is {@link BoxFightRoom}
 * (Energy Box Fight). TwoPlayerMovementRoom has been retired from
 * production registration; its protocol constants remain available
 * for test compatibility.
 */
export {
  TWO_PLAYER_MOVEMENT_ROOM,
  TWO_PLAYER_MOVEMENT_INPUT,
} from "./TwoPlayerMovementRoom.js";
