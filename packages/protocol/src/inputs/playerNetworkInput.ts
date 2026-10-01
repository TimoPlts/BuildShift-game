/**
 * PlayerNetworkInput — the full network input frame for the canonical
 * two-player movement system.
 *
 * This is a plain TypeScript interface suitable for Colyseus 0.18+ JSON
 * serialization or as a direct Schema field mapping. It is the canonical
 * input contract for the TWO_PLAYER_MOVEMENT game mode.
 *
 * Conventions (single source of truth — client and server must agree):
 * - `sequence` is a monotonically increasing, non-negative safe integer
 *   identity used for reconciliation.
 * - `moveX` / `moveZ` are the normalised local movement axes in [-1, 1].
 * - `lookYaw` / `lookPitch` are in radians.
 *     - `lookYaw`: 0 faces -Z; positive rotates toward +X.
 *     - `lookPitch`: 0 = horizontal; positive = looking up.
 * - All boolean fields are per-tick intent flags (edges or holds).
 */
export interface PlayerNetworkInput {
  /** Monotonically increasing input identity (non-negative safe integer). */
  sequence: number;
  /** Local movement, X axis, normalised to [-1, 1] (+X is right). */
  moveX: number;
  /** Local movement, Z axis, normalised to [-1, 1] (-Z is forward). */
  moveZ: number;
  /** Camera yaw, radians (0 faces -Z, positive rotates toward +X). */
  lookYaw: number;
  /** Camera pitch, radians (0 = horizontal, positive = looking up). */
  lookPitch: number;
  /** Jump intent edge (`true` on the tick the player pressed jump). */
  jump: boolean;
  /** Sprint hold (`true` while the player is holding sprint). */
  sprint: boolean;
  /** Crouch hold (`true` while the player is holding crouch). */
  crouch: boolean;
  /** Primary fire intent edge (`true` on the tick the player fired). */
  primaryFire: boolean;
  /** Secondary fire intent edge (`true` on the tick the player fired). */
  secondaryFire: boolean;
}

/**
 * Inclusive protocol bounds for `PlayerNetworkInput` fields.
 * Shared by validators and kept here so the ranges are documented in one place.
 */
export const PLAYER_NETWORK_INPUT_LIMITS = {
  /** Lowest valid `sequence` value. */
  sequenceMin: 0,
  /** Inclusive lower bound for `moveX` / `moveZ`. */
  movementMin: -1,
  /** Inclusive upper bound for `moveX` / `moveZ`. */
  movementMax: 1,
  /** Inclusive lower bound for `lookPitch` (radians). */
  pitchMin: -Math.PI,
  /** Inclusive upper bound for `lookPitch` (radians). */
  pitchMax: Math.PI,
} as const;
