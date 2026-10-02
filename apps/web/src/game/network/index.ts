/**
 * RETIRED: The original combat milestone's browser-side network layer.
 *
 * The canonical multiplayer networking path is now in `network/twoPlayer/`.
 * The `NetworkClient` (which joined the legacy "combat" room) and the
 * `RemotePlayerManager` (which rendered combat-room remote players) are
 * superseded by `TwoPlayerClient` and the two-player interpolation/mesh
 * system in `GameRuntime`.
 *
 * `HealthHud` is retained here because `GameRuntime` still uses it for
 * the combat HUD.
 *
 * ⚠️ RETIRED — do not import NetworkClient or the old RemotePlayerManager
 * for new code. Use `network/twoPlayer` instead.
 */
// @retired: NetworkClient — superseded by TwoPlayerClient
export {
  NetworkClient,
  COMBAT_ROOM_TYPE,
  COMBAT_INPUT_MESSAGE,
  type CombatRoomLike,
} from "./NetworkClient";
// @retired: RemotePlayerManager — superseded by the two-player mesh system
export { RemotePlayerManager } from "./RemotePlayerManager";
// Active: the combat HUD is still used by GameRuntime.
export { HealthHud } from "./HealthHud";
