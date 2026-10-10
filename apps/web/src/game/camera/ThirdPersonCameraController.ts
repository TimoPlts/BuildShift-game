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
 * Because the camera-right direction at yaw 0 is world -X (not +X),
 * **decreasing** yaw turns the camera visually right. This matches the
 * movement math in `movementInputToWorld` where camera-right maps to
 * world -X at yaw 0.
 *
 * Pitch is measured from the horizontal: positive pitch looks upward.
 *
 * The camera is a plain `UniversalCamera` whose position and target are set
 * manually every frame. Babylon's built-in camera input controls are not
 * attached; raw mouse pixels arrive through `applyLook` and the shared
 * movement simulation stays authoritative for the player.
 *
 * Presentation feel (all values live in `cameraConfig.ts`):
 * - the camera orbits a pivot that is `shoulderOffset` metres screen-right of
 *   the player's look point (over-the-shoulder), so the player reads slightly
 *   left of screen centre while the crosshair still aims down the camera's
 *   forward vector;
 * - the field of view is `fieldOfView`, widened by
 *   `buildModeFieldOfViewDelta` while build mode is active
 *   ({@link setBuildMode});
 * - looking up steeply, the camera dollies in along the aim ray instead of
 *   clipping below `minimumCameraHeight` (see {@link update}).
 *
 * Camera collision is intentionally deferred until Rapier is introduced
 * (Stage 1D+); the only presentation guard is the ground dolly above, and
 * the camera may otherwise clip through arena geometry.
 */
export class ThirdPersonCameraController {
  private readonly camera: UniversalCamera;
  private readonly lookTarget = new Vector3();
  private yaw = 0;
  private pitch = 0;
  /**
   * Transient vertical pitch nudge (radians) applied on top of the user's
   * aim pitch for this frame. Driven by the combat camera-recoil module —
   * it is set every frame by the runtime and is *not* persisted into
   * {@link pitch}, so recoil never disturbs the player's aim state.
   */
  private pitchOffset = 0;
  /**
   * Transient vertical (world-Y, metres) nudge applied on top of the tracked
   * look target for this frame. Driven by the movement-presentation module —
   * it is set every frame by the runtime and is *not* persisted. Because the
   * same offset is applied to BOTH the camera position and the look target,
   * the camera's aim direction is never changed: this is pure camera motion,
   * unlike the pitch nudge which rotates the view.
   */
  private transientVerticalOffset = 0;
  private disposed = false;

  public constructor(scene: Scene) {
    this.camera = new UniversalCamera(
      "gameplay-camera",
      new Vector3(0, 1.4, 12),
      scene,
    );
    this.camera.setTarget(new Vector3(0, 1.4, 6));
    this.camera.fov = THIRD_PERSON_CAMERA.fieldOfView;
  }

  /**
   * Toggles the build-mode readability field of view. While `active` the
   * camera uses `fieldOfView + buildModeFieldOfViewDelta` so the build grid
   * and the placement preview read better. Presentation only: the FOV never
   * rotates the view, moves the camera, or disturbs the aim ray. Idempotent
   * (safe to call every frame); no-op after dispose.
   */
  public setBuildMode(active: boolean): void {
    if (this.disposed) {
      return;
    }
    this.camera.fov =
      THIRD_PERSON_CAMERA.fieldOfView +
      (active ? THIRD_PERSON_CAMERA.buildModeFieldOfViewDelta : 0);
  }

  /**
   * Applies accumulated pointer-lock mouse movement (pixels) to yaw/pitch.
   * Sensitivity is per pixel — never per frame, so the feel is independent
   * of the frame rate.
   *
   * **Horizontal:** positive `deltaXPixels` (mouse right) decreases yaw,
   * turning the camera visually right. This is because the camera-right
   * direction at yaw 0 is world -X (see `movementInputToWorld`), so
   * decreasing yaw rotates the forward vector toward -X.
   *
   * **Vertical:** positive `deltaYPixels` (mouse down) decreases pitch
   * (looks down). The minus sign inverts the raw pointer value so that
   * mouse up looks up and mouse down looks down (standard game-camera
   * convention).
   */
  public applyLook(deltaXPixels: number, deltaYPixels: number): void {
    if (this.disposed) {
      return;
    }

    // Mouse right (positive deltaX) → decrease yaw → turn visually right.
    this.yaw -= deltaXPixels * THIRD_PERSON_CAMERA.mouseSensitivity;
    // Mouse up (negative deltaY) → increase pitch → look up.
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

  /** Current camera pitch in radians. */
  public getPitch(): number {
    return this.pitch;
  }

  /**
   * Sets the transient vertical pitch nudge for the next {@link update}. The
   * value is added to the aim pitch when the camera is positioned and does
   * not modify the player's aim pitch itself. Defaults to `0` (no nudge).
   */
  public setPitchOffset(offset: number): void {
    if (this.disposed) {
      return;
    }
    this.pitchOffset = offset;
  }

  /** The current transient pitch nudge (for inspection / tests). */
  public getPitchOffset(): number {
    return this.pitchOffset;
  }

  /**
   * Sets the transient vertical (world-Y) camera nudge for the next
   * {@link update}, in metres (positive = up). The offset translates both
   * the look target and the camera position by the same amount, so the aim
   * direction is untouched. Defaults to `0` (no nudge).
   */
  public setTransientVerticalOffset(offsetMeters: number): void {
    if (this.disposed) {
      return;
    }
    this.transientVerticalOffset = offsetMeters;
  }

  /** The current transient vertical nudge (for inspection / tests). */
  public getTransientVerticalOffset(): number {
    return this.transientVerticalOffset;
  }

  /**
   * Repositions the camera behind and above the player for the current
   * yaw/pitch. `feetPosition` is the player's ground anchor.
   *
   * The camera orbits a pivot that is `shoulderOffset` metres screen-right of
   * the player's look point (over-the-shoulder feel). The camera forward is
   * always the pure yaw/pitch direction (plus the transient pitch nudge), so
   * the shoulder offset, FOV, and the ground dolly below never change what
   * the crosshair aims at — aiming stays a function of the user's yaw/pitch
   * only, matching the values sent to the authoritative server.
   */
  public update(feetPosition: Readonly<Vector3>): void {
    if (this.disposed) {
      return;
    }

    const {
      distance,
      targetHeight,
      shoulderOffset,
      minimumCameraHeight,
      minimumCameraDistance,
    } = THIRD_PERSON_CAMERA;

    // Screen-right direction at the current yaw. With forward =
    // (sin θ, 0, -cos θ), the right-handed screen-right vector is
    // (-cos θ, 0, -sin θ) (world -X at yaw 0 — see the yaw convention above).
    const rightX = -Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    // Over-the-shoulder pivot: the look point shifted screen-right of the
    // player. The transient vertical movement nudge is folded in here so it
    // stays a pure translation shared by the pivot (look target) and the
    // camera position — the aim direction is unchanged.
    const pivotX = feetPosition.x + rightX * shoulderOffset;
    const pivotY = feetPosition.y + targetHeight + this.transientVerticalOffset;
    const pivotZ = feetPosition.z + rightZ * shoulderOffset;

    // Fold in the transient (recoil) nudge without touching aim pitch.
    const effectivePitch = this.pitch + this.pitchOffset;
    const forwardX = Math.sin(this.yaw) * Math.cos(effectivePitch);
    const forwardY = Math.sin(effectivePitch);
    const forwardZ = -Math.cos(this.yaw) * Math.cos(effectivePitch);

    // Ground obstruction guard (presentation only): looking up, the orbit
    // circle would push the camera below `minimumCameraHeight`. Dolly in
    // along the aim ray instead — the look target stays put and the camera
    // forward (the aim direction) is untouched.
    let trackingDistance: number = distance;
    if (forwardY > 0) {
      const maxDistance = (pivotY - minimumCameraHeight) / forwardY;
      if (maxDistance < trackingDistance) {
        trackingDistance = maxDistance;
      }
    }
    if (trackingDistance < minimumCameraDistance) {
      trackingDistance = minimumCameraDistance;
    }

    this.lookTarget.set(pivotX, pivotY, pivotZ);
    this.camera.position.set(
      pivotX - forwardX * trackingDistance,
      pivotY - forwardY * trackingDistance,
      pivotZ - forwardZ * trackingDistance,
    );
    this.camera.setTarget(this.lookTarget);
  }

  /** Exposes the underlying Babylon camera for aim/combat systems. */
  public getCamera(): UniversalCamera {
    return this.camera;
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
