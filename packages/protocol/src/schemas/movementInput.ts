/**
 * MovementInput — the plain-TypeScript input message sent client → server
 * via Colyseus `client.send()` / `room.send()`.
 *
 * This is NOT a Colyseus `Schema` class: it is a one-shot message payload
 * that the server consumes to drive the authoritative simulation tick. It
 * is not stored in room state, so it does not need Schema field tracking.
 *
 * The server treats this as the authoritative input intent for one
 * simulation tick. The client predicts locally using the same
 * `@buildshift/simulation` step and reconciles when the authoritative
 * state (carrying `lastInputSequence`) arrives.
 *
 * Conventions:
 *  - `moveX` / `moveZ` are normalised local movement axes in [-1, 1].
 *  - `yaw` is the absolute camera yaw in radians (0 faces -Z, positive
 *    rotates toward +X).
 *  - `pitch` is the absolute camera pitch in radians (0 = horizontal,
 *    positive = looking up). Informational — the server stores it for aim
 *    purposes but does not use it for movement.
 *  - `sequence` is a monotonically increasing non-negative safe integer
 *    used for reconciliation.
 */
export interface MovementInput {
  /** Monotonically increasing input identity (non-negative safe integer). */
  sequence: number;
  /** Local movement, X axis, normalised to [-1, 1] (+X is right). */
  moveX: number;
  /** Local movement, Z axis, normalised to [-1, 1] (-Z is forward). */
  moveZ: number;
  /** Absolute camera yaw, radians (0 faces -Z, positive rotates toward +X). */
  yaw: number;
  /**
   * Absolute camera pitch, radians (0 = horizontal, positive = looking up).
   * Informational: the server stores it for aim; it does not affect movement.
   */
  pitch: number;
  /** Jump intent edge (`true` on the tick the player pressed jump). */
  jump: boolean;
  /** Crouch intent (`true` while the player is holding crouch). */
  crouch: boolean;
}
