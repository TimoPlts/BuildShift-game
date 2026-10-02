/**
 * @deprecated REMOVED — The duplicate RemotePlayerManager module path has
 * been resolved.
 *
 * The canonical RemotePlayerManager (interpolation buffer) lives at:
 *   `apps/web/src/game/network/RemotePlayerManager.ts`
 *
 * This Babylon-mesh-lifecycle variant was never wired into the production
 * runtime. The `GameRuntime` inlines its remote-mesh creation/disposal
 * directly and uses the network-layer interpolation buffer for position
 * smoothing.
 *
 * This file is intentionally left as an empty module so that the
 * companion `remotePlayerSet.ts` (and its tests) remain compilable.
 */
export {};
