import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { THIRD_PERSON_CAMERA } from "./cameraConfig";

/**
 * Stage 1C yaw convention (single source of truth for the camera math):
 *
 * - yaw = 0 faces -Z (world forward)
 * - positive yaw rotates forward toward +X
 * - forward vector at yaw θ is (sin θ, 0, -cos θ)
 *
 * Pitch is measured from the horizontal: positive pitch looks upward.
 *
 * The camera is a plain `UniversalCamera` whose position and target are set
 * manually every frame. Babylon's built-in camera input controls are not
 * attached; raw mouse pixels arrive through `applyLook` and the shared
 * movement simulation stays authoritative for the player.
 *
 * Camera collision is intentionally deferred until Rapier is introduced
 * (Stage 1D+); the camera may clip through arena geometry.
 */
export class ThirdPersonCameraController {
  private readonly camera: UniversalCamera;
  private readonly lookTarget = new Vector3();
  private yaw = 0;
  private pitch = 0;
  private disposed = false;

  public constructor(scene: Scene) {
    this.camera = new UniversalCamera(
      "gameplay-camera",
      new Vector3(0, 1.4, 12),
      scene,
    );
    this.camera.setTarget(new Vector3(0, 1.4, 6));
  }

  /**
   * Applies accumulated pointer-lock mouse movement (pixels) to yaw/pitch.
   * Sensitivity is per pixel — never per frame, so the feel is independent
   * of the frame rate. Vertical movement is inverted in the standard
   * game-camera direction: mouse up looks up, mouse down looks down.
   */
  public applyLook(deltaXPixels: number, deltaYPixels: number): void {
    if (this.disposed) {
      return;
    }

    this.yaw += deltaXPixels * THIRD_PERSON_CAMERA.mouseSensitivity;
    this.pitch -= deltaYPixels * THIRD_PERSON_CAMERA.mouseSensitivity;
    this.pitch = clamp(
      this.pitch,
      THIRD_PERSON_CAMERA.minimumPitch,
      THIRD_PERSON_CAMERA.maximumPitch,
    );
    this.yaw = normalizeAngle(this.yaw);
  }

  /** Current camera yaw in radians (same convention as movement math). */
  public getYaw(): number {
    return this.yaw;
  }

  /**
   * Repositions the camera behind and above the player for the current
   * yaw/pitch. `feetPosition` is the player's ground anchor.
   */
  public update(feetPosition: Readonly<Vector3>): void {
    if (this.disposed) {
      return;
    }

    const { distance, targetHeight } = THIRD_PERSON_CAMERA;
    this.lookTarget.set(
      feetPosition.x,
      feetPosition.y + targetHeight,
      feetPosition.z,
    );

    const horizontalDistance = distance * Math.cos(this.pitch);
    const verticalOffset = distance * Math.sin(this.pitch);
    const forwardX = Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);

    this.camera.position.set(
      this.lookTarget.x - forwardX * horizontalDistance,
      this.lookTarget.y - verticalOffset,
      this.lookTarget.z - forwardZ * horizontalDistance,
    );
    this.camera.setTarget(this.lookTarget);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.camera.dispose();
    this.disposed = true;
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Folds an unbounded angle into [-π, π] so long sessions stay bounded. */
function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((((angle + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
}
