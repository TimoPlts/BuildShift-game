/**
 * PlayerInput — the plain-TypeScript per-tick player input for the combat
 * milestone.
 *
 * This is a one-shot client → server message payload sent via Colyseus
 * `client.send()`. It is deliberately a plain TypeScript interface (Colyseus
 * send payloads are JSON) and NOT a `@colyseus/schema` `Schema` class — it is
 * not stored in room state, so it needs no Schema field tracking.
 *
 * Conventions (single source of truth — client and server must agree):
 * - `sequence` is a monotonically increasing, non-negative safe integer used
 *   for reconciliation (rollback + replay).
 * - `moveX` / `moveZ` are the normalised local movement axes in [-1, 1].
 * - `lookYaw` / `lookPitch` are in radians.
 *     - `lookYaw`: 0 faces -Z; positive rotates toward +X.
 *     - `lookPitch`: 0 = horizontal; positive = looking up.
 * - `jump` / `primaryFire` are per-tick intent edges (`true` on the tick the
 *   player acted).
 */
export interface PlayerInput {
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
  /** Primary fire intent edge (`true` on the tick the player fired). */
  primaryFire: boolean;
}
