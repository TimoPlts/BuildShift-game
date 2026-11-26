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
   *
   * Tuned for over-shoulder framing (framing-20261119): at the previous 5.2 m
   * the visible 1.8 m body occupied only ~20 % of screen height (≈148 px at
   * 720p) and read as a distant mannequin beside its own builds. 3.7 m puts
   * the body at a Fortnite-order foreground share while the along-line-only
   * contract below keeps every aim guarantee exact.
   */
  distance: 3.7,
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
   * Local-view seam (FEET ANCHOR, anchored-turn 20261126): must stay 0.
   *
   * This value is applied as a root-LOCAL translation on the rendered body
   * (`presentation.setLocalViewOffset`), i.e. UNDER the body's yaw rotation.
   * Any non-zero value makes the rendered body's world position
   * `colliderFeet + Ryaw·(x, 0, z)`, so a yaw-only mouse sweep drags the
   * rendered feet around a circle of radius √(x²+z²) (was 0.8 m) around the
   * collider feet — the reported "stationary mouse turn swings the character
   * through space / floating off the platform" drift. With the camera pinned
   * ON the authoritative shot line that passes through the feet, a screen-
   * side body offset and a world-anchored body are geometrically mutually
   * exclusive; the user's feet-anchor requirement takes priority. Close
   * third-person framing is carried by `distance` alone.
   */
  localViewOffsetX: 0,
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
  /**
   * Self-surface guard (build-feel-20261123): an obstacle AABB containing
   * the eye origin (inflated by this margin, metres) is a *self-surface*
   * hit — the player is standing on/inside that volume, so dollying the
   * camera toward `t ≈ 0` cannot free it and instead buries the camera at
   * `minimumCameraDistance` inside the build (the reported "whole world
   * disappears" zoom). Such boxes are skipped; every box the eye is NOT
   * inside still obstructs exactly as before, so real wall/ceiling safety
   * is untouched. Small on purpose (2 cm): only genuine containment (or
   * surface contact within the margin) counts as self-surface.
   */
  obstructionSelfMargin: 0.02,
  /**
   * Obstruction dolly recovery speed (metres/second along the shot line).
   * Hysteresis: the guard dollies IN instantly when a solid appears (never
   * clips), but RELEASES back toward the nominal distance only at this
   * rate. Walking past build edges, ramps/cones or over step-ups therefore
   * eases back out instead of snapping — the "sudden zoom" read is gone
   * while the along-line-only contract (and so the centred crosshair) is
   * unchanged: this smooths the scalar `t`, never the ray.
   */
  obstructionRecoveryMetersPerSecond: 5,
} as const;
