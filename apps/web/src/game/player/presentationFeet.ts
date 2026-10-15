import { PLAYER_COLLIDER_HALF_TOTAL_HEIGHT } from "@buildshift/game-config";

/**
 * Feet of the rendered local body — the third-person camera's follow point
 * (the camera adds `targetHeight` − crouch dip on top).
 *
 * The presentation root's meaning depends on who drives it:
 *  - online, the runtime writes the interpolated *predicted* pose in the
 *    server's feet convention (`PlayerController.setMeshTransform`; the
 *    presentation lifts only the visible body into the capsule envelope), so
 *    the root already IS the feet;
 *  - offline, the root mirrors the physics capsule centre, so the feet are
 *    half the collider height below it.
 */
export function presentationFeetInto<T extends { set(x: number, y: number, z: number): T }>(
  out: T,
  root: Readonly<{ x: number; y: number; z: number }>,
  rootAtFeet: boolean,
): T {
  return out.set(root.x, rootAtFeet ? root.y : root.y - PLAYER_COLLIDER_HALF_TOTAL_HEIGHT, root.z);
}
