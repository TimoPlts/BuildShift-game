/**
 * Reticle projection — maps a world-space point (the resolved authoritative aim
 * point, see `authoritativeAim.ts`) into screen pixels for the crosshair.
 *
 * The camera basis is reconstructed from the third-person controller's own
 * conventions (see `ThirdPersonCameraController` / Stage 1C yaw doc):
 *
 * - forward at yaw θ, pitch φ: `(sinθ·cosφ, sinφ, −cosθ·cosφ)` — the *effective*
 *   pitch (user pitch + the transient recoil nudge) is what the camera actually
 * *   renders, so the caller passes that;
 * - screen-right: `(−cosθ, 0, −sinθ)` — world −X at yaw 0 (matches
 *   `movementInputToWorld`; verified against Babylon's own projection by tests);
 * - up: `forward × right` (world +Y at level);
 * - `camera.fov` is the vertical field of view (radians, Babylon vertical ref),
 *   so the focal length in CSS pixels is `(viewportHeight / 2) / tan(fov / 2)`.
 *
 * The returned offsets are CSS pixels from the viewport centre (x right, y down)
 * — exactly the `translate(...)` delta the centred `.crosshair` element needs.
 * Invalid projections (point behind / on the camera plane, degenerate viewport)
 * return `null`: the caller must then *suppress* the weapon reticle for the
 * frame rather than fake a clamped position.
 */
import type { AimVec3 } from "./authoritativeAim";

/** The rendered camera state needed to project world points to the viewport. */
export interface ReticleCameraState {
  /** Camera position (world metres). */
  position: AimVec3;
  /** Camera yaw (radians, Stage 1C convention). */
  yaw: number;
  /** Effective camera pitch (radians) — user pitch plus any transient recoil. */
  pitch: number;
  /** Vertical field of view in radians (matches `camera.fov`). */
  fieldOfView: number;
}

/** Screen placement of a projected world point, in CSS pixels. */
export interface ReticleScreenOffset {
  /** Pixels from viewport centre, positive = right. */
  dxPx: number;
  /** Pixels from viewport centre, positive = down. */
  dyPx: number;
  /** Camera-space depth of the point along the camera forward (> 0 always). */
  depth: number;
}

/**
 * Project `point` into screen offsets from the viewport centre.
 *
 * @returns the offsets (see {@link ReticleScreenOffset}), or `null` when the
 *   point is not in front of the camera or the viewport is degenerate — the
 *   reticle must be hidden that frame.
 */
export function projectPointToScreenOffset(
  point: AimVec3,
  camera: ReticleCameraState,
  viewportWidthPx: number,
  viewportHeightPx: number,
): ReticleScreenOffset | null {
  if (!(viewportWidthPx > 0) || !(viewportHeightPx > 0)) return null;
  const halfFov = camera.fieldOfView / 2;
  // Defensive: a non-positive tan would invert/blur the projection; the live
  // config never approaches ±90° FOV, but a bad frame must not produce garbage.
  const tanHalf = Math.tan(halfFov);
  if (!(tanHalf > 1e-6) || !(viewportHeightPx / 2 / tanHalf > 0)) return null;

  const sinYaw = Math.sin(camera.yaw);
  const cosYaw = Math.cos(camera.yaw);
  const sinPitch = Math.sin(camera.pitch);
  const cosPitch = Math.cos(camera.pitch);

  // forward = (sinθ·cosφ, sinφ, −cosθ·cosφ)
  const fx = sinYaw * cosPitch;
  const fy = sinPitch;
  const fz = -cosYaw * cosPitch;
  // right = (−cosθ, 0, −sinθ)   (⊥ forward at every pitch)
  const rx = -cosYaw;
  const rz = -sinYaw;
  // up = forward × right
  const ux = fy * rz;
  const uy = fz * rx - fx * rz;
  const uz = -fy * rx;

  const px = point.x - camera.position.x;
  const py = point.y - camera.position.y;
  const pz = point.z - camera.position.z;

  const depth = px * fx + py * fy + pz * fz;
  // Behind or on the camera plane: no truthful screen position exists — suppress.
  if (!(depth > 1e-4)) return null;

  const focalPx = viewportHeightPx / 2 / tanHalf;
  const lateral = px * rx + pz * rz;
  const vertical = px * ux + py * uy + pz * uz;

  return {
    dxPx: (lateral / depth) * focalPx,
    // Screen Y grows downward; world up is positive.
    dyPx: (-vertical / depth) * focalPx,
    depth,
  };
}
