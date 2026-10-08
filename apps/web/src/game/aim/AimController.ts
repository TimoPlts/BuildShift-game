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
    // `getDirection` returns a vector for the *local axis passed to it*; it
    // does not write a camera forward vector into an output parameter.  Using
    // `result` for that argument therefore asked for the direction of the
    // zero vector and left the build preview with no downward aim ray.
    camera.getDirectionToRef(Vector3.Forward(), result);
    result.normalize();
    return result;
  }
}
