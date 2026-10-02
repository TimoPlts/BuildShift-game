/**
 * Barrel export for the game server rooms.
 *
 * The canonical authoritative gameplay path is {@link TwoPlayerMovementRoom},
 * which drives movement AND hitscan combat in a single 30 Hz tick loop.
 *
 * The legacy {@link CombatRoom} is retained in its own module
 * (`./CombatRoom.js`) for the `combatRoom.test.ts` suite but is NOT
 * re-exported here and is NOT registered by the production server.
 */
export {
  TwoPlayerMovementRoom,
  TWO_PLAYER_MOVEMENT_ROOM,
  TWO_PLAYER_MOVEMENT_INPUT,
} from "./TwoPlayerMovementRoom.js";
