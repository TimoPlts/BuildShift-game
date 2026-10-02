/**
 * RETIRED: The original combat milestone's browser-side network layer.
 *
 * The canonical multiplayer networking path is now in `network/twoPlayer/`.
 * The old `NetworkClient` (which joined the legacy "combat" room) has been
 * removed. The `RemotePlayerManager` (which rendered combat-room remote
 * players) is superseded by the two-player interpolation/mesh system in
 * `GameRuntime`.
 *
 * `HealthHud` is retained here because `GameRuntime` still uses it for
 * the combat HUD.
 *
 * ⚠️ Use `network/twoPlayer` for all new networking code.
 */
// @retired: RemotePlayerManager — superseded by the two-player mesh system
export { RemotePlayerManager } from "./RemotePlayerManager";
// Active: the combat HUD is still used by GameRuntime.
export { HealthHud } from "./HealthHud";
