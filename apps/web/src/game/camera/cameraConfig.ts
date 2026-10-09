/**
 * Presentation-only camera tuning for the local third-person camera.
 *
 * These values are purely visual: they do not affect the shared movement
 * simulation and must not be moved into `@buildshift/game-config` or
 * `@buildshift/simulation` (see docs/TECHNICAL_ARCHITECTURE.md §7).
 *
 * The tuning targets comfortable building/shooter play at the canonical
 * build scale (2 m cells, see `BUILD_GRID`): the camera sits far enough
 * back that a player next to a 2 m wall does not fill the screen, while the
 * over-the-shoulder offset and FOV keep the crosshair (screen centre) a
 * reliable aim reference.
 */
export const THIRD_PERSON_CAMERA = {
  /** Distance from the orbit pivot to the camera, in metres. */
  distance: 7.0,
  /** Height of the orbit pivot above the player's feet, in metres. */
  targetHeight: 1.6,
  /**
   * Over-the-shoulder lateral offset, in metres. The orbit pivot is shifted
   * this far screen-right of the player, so the player renders slightly
   * left of screen centre while the crosshair still aims along the camera's
   * forward vector. Aim accuracy is unaffected (the aim direction is the
   * camera forward, independent of this offset).
   */
  shoulderOffset: 0.8,
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
   * looks up steeply, the orbit circle would push the camera below this
   * height; instead the camera dollies in along the aim ray (shrinking the
   * tracking distance) so it never clips under the floor. The look target
   * and the aim direction are untouched by this guard.
   */
  minimumCameraHeight: 0.2,
  /** Closest the dolly-in may bring the camera to the orbit pivot, in metres. */
  minimumCameraDistance: 1.2,
} as const;
