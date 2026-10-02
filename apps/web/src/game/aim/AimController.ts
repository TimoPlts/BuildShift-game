import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/**
 * Computes the world-space aim direction from the current camera state.
 *
 * The crosshair is screen-centre, so the camera's forward vector IS the aim
 * direction. This class is intentionally simple; it will be extended if a
 * crosshair offset or recoil spread is added later.
 */
export class AimController {
  /**
   * Returns the normalized aim direction in world space for the given camera.
   *
   * @param camera - The active gameplay camera.
   * @param out - Optional output vector to write into (avoids per-frame
   *   allocation). If omitted, a new Vector3 is created.
   * @returns The normalized world-space direction the player is aiming.
   */
  public getAimDirection(camera: Camera, out?: Vector3): Vector3 {
    const result = out ?? new Vector3();
    camera.getDirection(result);
    result.normalize();
    return result;
  }
}
