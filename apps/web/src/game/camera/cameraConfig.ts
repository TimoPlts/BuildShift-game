/**
 * Presentation-only camera tuning for the local third-person camera.
 *
 * These values are purely visual: they do not affect the shared movement
 * simulation and must not be moved into `@buildshift/game-config` or
 * `@buildshift/simulation` (see docs/TECHNICAL_ARCHITECTURE.md §7).
 *
 * Centred-aim invariant: the camera sits ON the authoritative shot line
 * (behind the server eye origin, looking along the raw yaw/pitch direction),
 * so the CSS-centred crosshair *is* the shot ray at every range. Every value
 * here either shrinks the along-line tracking distance or changes the FOV —
 * none of them can move the screen-centre ray off the shot line.
 */
export const THIRD_PERSON_CAMERA = {
  /**
   * Distance from the eye origin (the camera pivot) to the camera, in metres,
   * measured ALONG the shot line. Presentation only: the tracking distance
   * never rotates the view or moves the aim ray, and `minimumCameraDistance`
   * still bounds how far the guards may dolly in.
   */
  distance: 5.2,
  /**
   * Along-line recoil kickback (metres of camera pull-back per radian of
   * {@link CameraRecoil} output). View *rotation* recoil was removed because
   * it would tilt the rendered view off the server shot ray while the shot
   * still flew raw pitch — the crosshair would lie. Motion along the line
   * cannot move the screen-centre ray off the line, so recoil is expressed
   * as this subtle kickback instead. Larger = a more visible shot "shove".
   */
  recoilKickbackMetersPerRadian: 2.0,
  /**
   * Local-view seam (the Fortnite-style shoulder read): the local VISUAL
   * body root is shifted this far in root-local +X, which maps to world
   * screen-left at every yaw (root-local +X = −camera-right under the shared
   * yaw convention). Only the avatar the local player sees moves — logical
   * root, physics, server state and spawns are untouched. Applied through the
   * agreed facade API `presentation.setLocalViewOffset(x, z)` (owned by the
   * character worker).
   */
  localViewOffsetX: 0.8,
  /** Root-local Z component of the local view offset (0 = no fore/aft shift). */
  localViewOffsetZ: 0,
  /** Base camera field of view in radians (≈ 80° — comfortable for 2 m build cells). */
  fieldOfView: 1.4,
  /**
   * Extra field of view in radians while build mode is active, so the build
   * grid and placement preview read better. Presentation only: changing the
   * FOV never rotates the view or moves the aim ray.
   */
  buildModeFieldOfViewDelta: 0.1,
  /** Radians of camera yaw per pixel of pointer-lock mouse movement. */
  mouseSensitivity: 0.0022,
  /** Lowest the camera may look (radians). Negative = looking down. */
  minimumPitch: -Math.PI / 3, // ≈ -60°
  /** Highest the camera may look (radians). Positive = looking up. */
  maximumPitch: Math.PI / 2.6, // ≈ +69°
  /**
   * Camera floor (world-Y metres, ground top is y = 0). When the player
   * looks up steeply, the shot line trails below this height behind the eye;
   * instead of leaving the line, the camera dollies IN along it (shrinking
   * the tracking distance) until `camY >= minimumCameraHeight`. The centred
   * crosshair stays exactly on the shot line throughout.
   */
  minimumCameraHeight: 0.2,
  /**
   * Closest the dolly-in may bring the camera to the eye origin, in metres.
   * Deliberately small (was 1.2): with the pivot at the eye origin (0.9 m
   * standing, crouch half-total crouched), a large floor would strand the
   * camera under `minimumCameraHeight` when looking up steeply; converging
   * toward the eye (near-first-person) keeps the floor guard satisfiable
   * ON the line at every pitch and crouch state.
   */
  minimumCameraDistance: 0.2,
  /**
   * Gap (metres) maintained between the camera and the nearest build
   * structure surface when the shot line behind the eye is obstructed.
   * Prevents the camera from rendering exactly on the structure face
   * (Z-fighting). Only shrinks the along-line distance — aim is untouched.
   */
  buildObstructionGap: 0.1,
} as const;
