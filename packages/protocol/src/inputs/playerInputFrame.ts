/**
 * PlayerInputFrame — a single **sequenced authoritative input sample** that a
 * client reports.
 *
 * This is player **intent**, never a claimed position or velocity
 * (docs/TECHNICAL_ARCHITECTURE.md §10, §13): the server is the only authority
 * on world position and velocity. The client predicts locally using the same
 * `@buildshift/simulation` step the server uses, but it never tells the server
 * "I am here".
 *
 * Timing / cadence: a `PlayerInputFrame` is one *authoritative input sample* —
 * it is **not** one frame per physics substep. The architecture distinguishes
 * the authoritative input/simulation tick (initially 30 Hz) from the physics
 * substeps (2) and the resulting effective physics stepping (60 Hz). Which
 * simulation tick a frame belongs to, and how many physics substeps consume a
 * given input, is decided by the networking/simulation layer; that cadence is
 * deliberately **not** encoded in the wire type. There are no tick-rate fields
 * on this frame.
 *
 * Wire shape: compact primitives only, so a frame is directly serialisable by
 * Colyseus and sendable over the network with no conversion.
 *
 * Conventions (single source of truth — client and server must agree):
 * - `moveX` / `moveZ` are the *normalised local* movement axes. The current
 *   client emits -1, 0 or +1 per axis (WASD); diagonal input is normalised
 *   downstream by the simulation. Valid range is **[-1, 1]** (closed).
 * - `lookYaw` / `lookPitch` are in **radians**.
 *     - `lookYaw`: 0 faces -Z; positive rotates toward +X (the camera /
 *       movement-math convention). Unbounded — the consumer normalises.
 *     - `lookPitch`: 0 = horizontal; positive = looking up. The client keeps
 *       pitch within its presentation clamps, but the protocol range here is
 *       the wider symmetric **[-π, π]** so the contract stays valid as the
 *       presentation clamps are tuned.
 * - `jump` is a boolean **intent edge**: `true` on the tick the player
 *   requested a jump, `false` otherwise. The server's jump-buffer / coyote
 *   logic (`@buildshift/simulation` `JumpController`) consumes this edge; the
 *   client never claims the jump resolved.
 * - `sequence` is a monotonically increasing, **non-negative safe integer**
 *   identity used for reconciliation (docs §14). It must stay within
 *   JavaScript's safe-integer range so distinct identities never lose numeric
 *   precision. The client assigns 0, 1, 2, ...; the server acknowledges the
 *   highest `sequence` it has authoritatively processed (see
 *   `AuthoritativePlayerState`).
 *
 * Deliberately absent (not yet required by implemented gameplay): combat
 * (primary/secondary fire), build, edit, energy, health, ammo, sprint, crouch.
 */
export interface PlayerInputFrame {
  /** Monotonically increasing input identity (non-negative safe integer). */
  sequence: number;
  /** Local movement, X axis, normalised to [-1, 1] (+X is right). */
  moveX: number;
  /** Local movement, Z axis, normalised to [-1, 1] (-Z is forward). */
  moveZ: number;
  /** Camera yaw, in radians (0 faces -Z, positive rotates toward +X). */
  lookYaw: number;
  /** Camera pitch, in radians (0 = horizontal, positive = looking up). */
  lookPitch: number;
  /** Jump intent edge for this tick (`true` once on the press tick). */
  jump: boolean;
}

/**
 * Inclusive protocol bounds for `PlayerInputFrame` fields. Shared by the
 * validator and kept here so the ranges are documented in one place.
 *
 * These are *protocol-level structural* bounds (shape / range), NOT
 * anti-cheat thresholds. Authoritative rate/semantic validation belongs later
 * to `apps/game-server/src/validation`.
 */
export const PLAYER_INPUT_LIMITS = {
  /**
   * Lowest valid `sequence` value. The upper bound is JavaScript's
   * `Number.MAX_SAFE_INTEGER` (enforced by the validator via
   * `Number.isSafeInteger`), so no arbitrary smaller ceiling is imposed.
   */
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
