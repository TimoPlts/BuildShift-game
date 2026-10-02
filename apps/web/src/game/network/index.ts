/**
 * Public entry point for the combat milestone's browser-side network layer.
 *
 * Re-exports the three building blocks the `GameRuntime` composes:
 *  - {@link NetworkClient}        — the Colyseus client (join / input / state /
 *                                   events);
 *  - {@link RemotePlayerManager}  — renders remote players as Babylon meshes;
 *  - {@link HealthHud}            — the minimal DOM health + elimination HUD.
 */
export {
  NetworkClient,
  COMBAT_ROOM_TYPE,
  COMBAT_INPUT_MESSAGE,
  type CombatRoomLike,
} from "./NetworkClient";
export { RemotePlayerManager } from "./RemotePlayerManager";
export { HealthHud } from "./HealthHud";
