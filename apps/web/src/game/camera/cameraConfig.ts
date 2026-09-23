/**
 * Presentation-only camera tuning for the local third-person camera.
 *
 * These values are purely visual: they do not affect the shared movement
 * simulation and must not be moved into `@buildshift/game-config` or
 * `@buildshift/simulation` (see docs/TECHNICAL_ARCHITECTURE.md §7).
 */
export const THIRD_PERSON_CAMERA = {
  /** Distance from the look target to the camera, in metres. */
  distance: 5.5,
  /** Height of the look target above the player's feet, in metres. */
  targetHeight: 1.4,
  /** Radians of camera yaw per pixel of pointer-lock mouse movement. */
  mouseSensitivity: 0.0022,
  /** Lowest the camera may look (radians). Negative = looking down. */
  minimumPitch: -Math.PI / 3, // ≈ -60°
  /** Highest the camera may look (radians). Positive = looking up. */
  maximumPitch: Math.PI / 2.6, // ≈ +69°
} as const;
