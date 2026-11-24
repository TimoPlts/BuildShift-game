import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { THIRD_PERSON_CAMERA } from "./cameraConfig";
import {
  AIM_EYE_HEIGHT_STANDING,
  AIM_EYE_HEIGHT_CROUCHED,
} from "../aim/authoritativeAim";

/** World up reference (documentation only; the Euler route derives its own). */
const CAMERA_UP = new Vector3(0, 1, 0);
void CAMERA_UP;

/**
 * An axis-aligned bounding box in world space (metres, Y-up).
 * Used for camera obstruction checks against build structures.
 */
export interface ObstacleAABB {
  /** Minimum corner (x, y, z). */
  min: readonly [number, number, number];
  /** Maximum corner (x, y, z). */
  max: readonly [number, number, number];
}

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
 * ## The centred-aim invariant
 *
 * The crosshair is a static, CSS-centred DOM element. For it to be *honest*,
 * the rendered screen-centre ray must equal the server's shot ray. The server
 * (`TwoPlayerMovementRoom.rf`) fires from the eye origin — server feet +
 * {@link AIM_EYE_HEIGHT_STANDING} standing, feet +
 * {@link AIM_EYE_HEIGHT_CROUCHED} crouched — along `ad(yaw, pitch)`. So this
 * controller keeps the camera exactly ON that line:
 *
 * ```
 * eye    = feet + eyeHeight(crouch state)          (the authoritative origin)
 * dir    = ad(rawYaw, rawPitch)                    (the authoritative direction)
 * camPos = eye - dir * t                           (t = tracking distance)
 * camFwd = dir                                     (via setTarget(eye))
 * ```
 *
 * Every per-frame effect therefore only changes the scalar `t`:
 * - **recoil** ({@link setRecoilKickback}) lengthens `t` along the line — it
 *   can never rotate the view off the shot ray (view-rotation recoil was
 *   removed for exactly that reason);
 * - **movement bob** ({@link setTransientVerticalOffset}) is a world-Y nudge;
 *   only its projection onto the line (`offset * dir.y`) is applied, again
 *   keeping the camera on the line;
 * - **crouch** ({@link setCrouched}) moves the pivot between the two exact
 *   server eye heights, discretely, matching the flag the client sends — a
 *   smoothed pivot dip would silently lift the centre ray off the shot ray
 *   mid-blend, so the visual body eases but the camera does not;
 * - **floor / structure guards** only *shrink* `t` (dolly in along the line),
 *   bounded below by `minimumCameraDistance`, so the camera never leaves the
 *   line and never clips below the floor.
 *
 * The over-shoulder feel comes from the local VISUAL body being shifted
 * screen-left (`cameraConfig.localViewOffsetX` via
 * `presentation.setLocalViewOffset`) — never from an offset camera pivot.
 */
export class ThirdPersonCameraController {
  private readonly camera: UniversalCamera;
  private readonly lookTarget = new Vector3();
  /** Scratch vector for the reusable-`out` aim-direction API. */
  private readonly aimScratch = new Vector3();
  private yaw = 0;
  private pitch = 0;
  /**
   * Transient along-line recoil kickback (metres) added to the tracking
   * distance for this frame. Driven by the combat camera-recoil module —
   * set every frame by the runtime and *not* persisted. Because it moves the
   * camera along the shot line, it cannot tilt the view off the ray.
   */
  private recoilKickback = 0;
  /**
   * Transient vertical (world-Y, metres) movement nudge for this frame,
   * driven by the movement-presentation module. Applied as its projection
   * onto the shot line (`offset * dir.y`), i.e. pure along-line camera
   * motion — the rendered centre ray stays exactly on the shot line.
   */
  private transientVerticalOffset = 0;
  /**
   * Whether the local player is crouched (the same discrete flag the client
   * sends to the server). Selects the pivot between the exact server eye
   * heights; deliberately NOT smoothed.
   */
  private crouched = false;
  private disposed = false;
  /**
   * World-space obstacle AABBs (build structures) that block the camera.
   * Updated each frame by the runtime; empty array = no obstruction.
   */
  private obstacles: ReadonlyArray<ObstacleAABB> = [];
  /**
   * Hysteretically-smoothed obstruction limit (metres along the shot line,
   * Infinity = no limit). The limit snaps DOWN instantly when a solid
   * appears in front of the dolly (the camera must never clip), but only
   * releases back toward the nominal tracking distance at
   * `obstructionRecoveryMetersPerSecond`. This is the stable recovery that
   * stops walk-past-a-build-edge / step-up / jump / crouch distance changes
   * from reading as sudden zooms. Purely a scalar on the line — the
   * rendered centre ray is unaffected.
   */
  private smoothedObstructionLimit = Number.POSITIVE_INFINITY;

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
   * Sets the transient along-line recoil kickback (metres, positive = camera
   * pulled further back along the shot line) for the next {@link update}.
   * Defaults to `0`. Purely along-line: the screen-centre ray stays on the
   * shot ray regardless of the value.
   */
  public setRecoilKickback(meters: number): void {
    if (this.disposed) {
      return;
    }
    this.recoilKickback = meters;
  }

  /** The current recoil kickback (for inspection / tests). */
  public getRecoilKickback(): number {
    return this.recoilKickback;
  }

  /**
   * Sets the transient vertical (world-Y) movement nudge for the next
   * {@link update}, in metres (positive = up). Only its projection onto the
   * shot line (`offset * aimDir.y`) is applied, so the camera slides along
   * the line and the aim direction never changes. Defaults to `0`.
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
   * Returns the pure yaw/pitch aim direction (the authoritative direction
   * that matches the server's `ad(yaw, pitch)` computation). The rendered
   * camera forward equals this vector exactly every frame — recoil, bob and
   * the crouch pivot never rotate it. This is the direction the centred
   * reticle represents and the direction the server resolves shots along.
   *
   * @param out - Optional output vector to write into.
   * @returns The normalized aim direction in world space.
   */
  public getAimDirection(out?: Vector3): Vector3 {
    const result = out ?? new Vector3();
    const cosPitch = Math.cos(this.pitch);
    result.x = Math.sin(this.yaw) * cosPitch;
    result.y = Math.sin(this.pitch);
    result.z = -Math.cos(this.yaw) * cosPitch;
    return result;
  }

  /**
   * Sets the world-space obstacle AABBs (build structures) that block the
   * camera. The camera dollies in along the shot line if the line behind the
   * eye passes through an obstacle. Pass an empty array to disable
   * obstruction. Presentation only: the aim direction is never affected.
   */
  public setObstacles(obstacles: ReadonlyArray<ObstacleAABB>): void {
    if (this.disposed) return;
    this.obstacles = obstacles;
  }

  /**
   * Sets the discrete crouch state that selects the camera pivot height for
   * the next {@link update}. `true` lowers the pivot to the exact crouched
   * server eye height; `false` to the standing one. Deliberately unsmoothed
   * (see the class docs): during a smooth blend the rendered centre ray would
   * no longer pass through the authoritative shot origin.
   */
  public setCrouched(crouched: boolean): void {
    if (this.disposed) {
      return;
    }
    this.crouched = crouched;
  }

  /** The current crouch camera state (for inspection / tests). */
  public isCrouchedForCamera(): boolean {
    return this.crouched;
  }

  /** The current camera pivot (eye origin) height this controller targets. */
  public eyeHeight(): number {
    return this.crouched ? AIM_EYE_HEIGHT_CROUCHED : AIM_EYE_HEIGHT_STANDING;
  }

  /**
   * Repositions the camera on the authoritative shot line for the current
   * yaw/pitch. `feetPosition` is the player's ground anchor (server feet
   * convention when connected).
   *
   * The camera sits `t` metres BEHIND the eye origin along `-aimDir` and
   * looks straight at the eye origin, so its forward IS the authoritative
   * shot direction and the CSS screen-centre ray IS the shot line — at every
   * range, weapon and viewport. `t` starts at `distance`, is stretched by the
   * along-line recoil/bob nudges, and may only be *shrunk* by the floor and
   * structure guards below, never clamped back above the guard's limit in a
   * way that leaves the line (see {@link ThirdPersonCameraController}).
   *
   * @param feetPosition - the player's ground anchor (server feet convention
   * when connected).
   * @param deltaSeconds - frame delta used for the obstruction dolly's
   * recovery easing (see {@link smoothedObstructionLimit}); the dolly-in
   * side of the smoothing is dt-independent (instant). Defaults to a 60 Hz
   * frame so existing call sites keep working; clamped to \[0, 0.1\] s.
   */
  public update(feetPosition: Readonly<Vector3>, deltaSeconds = 1 / 60): void {
    if (this.disposed) {
      return;
    }

    const {
      distance,
      minimumCameraHeight,
      minimumCameraDistance,
      buildObstructionGap,
      obstructionSelfMargin,
      obstructionRecoveryMetersPerSecond,
    } = THIRD_PERSON_CAMERA;

    // The authoritative eye origin — the exact point the server `rf` fires
    // from (server feet + eye height, crouch-selecting the same constants).
    const eyeX = feetPosition.x;
    const eyeY = feetPosition.y + this.eyeHeight();
    const eyeZ = feetPosition.z;

    // Shot direction: raw yaw/pitch only. No recoil pitch, no bob, no FOV —
    // this is literally the server's `ad(yaw, pitch)` vector.
    const dir = this.getAimDirection(this.aimScratch);

    // Tracking distance along the line. Transient effects are along-line by
    // construction: recoil pulls straight back; the vertical bob enters only
    // through its projection onto the line (dot with dir).
    let trackingDistance =
      distance +
      this.recoilKickback -
      this.transientVerticalOffset * dir.y;

    // Floor guard (presentation only): looking up, the line trails below the
    // camera floor behind the eye. Dolly IN along the line so
    // eyeY - t*dir.y >= minimumCameraHeight. Keeps the camera ON the line.
    if (dir.y > 0) {
      const maxDistance = (eyeY - minimumCameraHeight) / dir.y;
      if (maxDistance < trackingDistance) {
        trackingDistance = maxDistance;
      }
    }

    // Structure guard: if the shot line behind the eye passes through a
    // solid build structure, dolly in to just before the nearest hit.
    // Two stability rules (build-feel-20261123):
    //  1. Self-surface skip — a box CONTAINING the eye origin is a volume
    //     the player is standing on/inside. The backward ray starts inside
    //     it (t = 0), and dollying to `0 - gap` buries the camera at
    //     minimum distance inside the build (the "world disappears" zoom).
    //     Skipping it cannot strand the camera in a wall the player is NOT
    //     inside — those still obstruct. The obstruction inputs themselves
    //     are the canonical solids (`structureCuboids` via
    //     `computeStructureObstacles`), so walkable support only ever
    //     obstructs as the thin slabs / pyramid levels where they actually
    //     stand, never as a full-volume phantom column.
    //  2. Hysteresis — the combined limit snaps down instantly (never clip)
    //     but releases at `obstructionRecoveryMetersPerSecond`, so walks
    //     past build edges, steps, jumps and crouches ease back out of a
    //     dolly instead of snapping.
    let rawObstructionLimit = Number.POSITIVE_INFINITY;
    if (this.obstacles.length > 0) {
      const ndX = -dir.x;
      const ndY = -dir.y;
      const ndZ = -dir.z;
      const selfMargin = obstructionSelfMargin;
      for (const obs of this.obstacles) {
        if (
          eyeX > obs.min[0] - selfMargin && eyeX < obs.max[0] + selfMargin &&
          eyeY > obs.min[1] - selfMargin && eyeY < obs.max[1] + selfMargin &&
          eyeZ > obs.min[2] - selfMargin && eyeZ < obs.max[2] + selfMargin
        ) {
          continue; // self-surface: the player is inside this solid volume
        }
        const t = rayAABBDistance(
          eyeX, eyeY, eyeZ,
          ndX, ndY, ndZ,
          obs.min[0], obs.min[1], obs.min[2],
          obs.max[0], obs.max[1], obs.max[2],
        );
        if (t !== null) {
          const limit = t - buildObstructionGap;
          if (limit < rawObstructionLimit) {
            rawObstructionLimit = limit;
          }
        }
      }
    }
    if (rawObstructionLimit < this.smoothedObstructionLimit) {
      // Dolly-in: instant, so the camera can never pass through the solid.
      this.smoothedObstructionLimit = rawObstructionLimit;
    } else if (Number.isFinite(this.smoothedObstructionLimit)) {
      // Recovery: finite speed back toward "no limit" (capped at the
      // nominal distance — any limit beyond it is indistinguishable from
      // no obstruction).
      const dt = clamp(deltaSeconds, 0, MAX_SMOOTHING_DELTA);
      this.smoothedObstructionLimit = Math.min(
        rawObstructionLimit,
        distance,
        this.smoothedObstructionLimit + obstructionRecoveryMetersPerSecond * dt,
      );
    }
    if (this.smoothedObstructionLimit < trackingDistance) {
      trackingDistance = this.smoothedObstructionLimit;
    }

    if (trackingDistance < minimumCameraDistance) {
      trackingDistance = minimumCameraDistance;
    }

    // Place the camera on the line and orient it straight down the line by
    // writing the Euler rotation DIRECTLY (Babylon camera convention:
    // rotation.x positive looks DOWN, rotation.y is the LH yaw). Solving
    // rotation.set(-pitch, PI - yaw, 0) reproduces forward ==
    // (sin yaw·cos pitch, sin pitch, -cos yaw·cos pitch) EXACTLY — the
    // server's `ad(yaw, pitch)`. setTarget() is avoided for orientation:
    // re-deriving rotation from position+target loses ~1e-3 rad at steep
    // pitch, which is a silent aim error on a 60 m hitscan.
    this.lookTarget.set(eyeX, eyeY, eyeZ);
    this.camera.position.set(
      eyeX - dir.x * trackingDistance,
      eyeY - dir.y * trackingDistance,
      eyeZ - dir.z * trackingDistance,
    );
    this.camera.rotation.set(-this.pitch, Math.PI - this.yaw, 0);
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

/** Upper bound on the frame delta fed to the obstruction-dolly recovery
 * easing: a paused or backgrounded tab must not instantly unwind a dolly
 * (and recovery must not depend on a huge dt). */
const MAX_SMOOTHING_DELTA = 0.1;

/** Folds an unbounded angle into [-π, π] so long sessions stay bounded. */
function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((((angle + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
}

/**
 * Ray–AABB intersection using the slab method.
 *
 * @param ox,oy,oz - Ray origin.
 * @param dx,dy,dz - Normalized ray direction.
 * @param minx,miny,minz - AABB minimum corner.
 * @param maxx,maxy,maxz - AABB maximum corner.
 * @returns The distance `t` along the ray to the near face of the AABB, or
 *   `null` if the ray does not intersect the box.
 */
function rayAABBDistance(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  minx: number, miny: number, minz: number,
  maxx: number, maxy: number, maxz: number,
): number | null {
  let tmin = 0;
  let tmax = Infinity;

  // X slab
  if (Math.abs(dx) < 1e-12) {
    if (ox < minx || ox > maxx) return null;
  } else {
    const invDx = 1 / dx;
    let t1 = (minx - ox) * invDx;
    let t2 = (maxx - ox) * invDx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  // Y slab
  if (Math.abs(dy) < 1e-12) {
    if (oy < miny || oy > maxy) return null;
  } else {
    const invDy = 1 / dy;
    let t1 = (miny - oy) * invDy;
    let t2 = (maxy - oy) * invDy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  // Z slab
  if (Math.abs(dz) < 1e-12) {
    if (oz < minz || oz > maxz) return null;
  } else {
    const invDz = 1 / dz;
    let t1 = (minz - oz) * invDz;
    let t2 = (maxz - oz) * invDz;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  return tmin;
}
