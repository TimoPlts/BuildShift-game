/**
 * PlayerNetworkState — the plain-TypeScript wire representation of one
 * player's authoritative movement state for the two-player movement system.
 *
 * This is the JSON-serialisable contract that mirrors what the Colyseus
 * `PlayerStateSchema` carries on the wire, but as a plain interface for
 * consumers that need the state as a plain object (e.g. for testing,
 * logging, reconciliation, or non-Colyseus transports).
 *
 * It carries the full 3D position and velocity so both the client and
 * server can reconstruct the complete kinematic state.
 *
 * Coordinate convention: Y-up, capsule-centre semantic (matches
 * `PlayerPositionSemantic` in `state/playerState.ts`).
 */
export interface PlayerNetworkState {
  /** World X, metres, capsule-centre semantic. */
  x: number;
  /** World Y, metres (up), capsule-centre semantic. */
  y: number;
  /** World Z, metres, capsule-centre semantic. */
  z: number;
  /** Velocity X, m/s. */
  vx: number;
  /** Velocity Y, m/s (positive = upward). */
  vy: number;
  /** Velocity Z, m/s. */
  vz: number;
  /**
   * Highest input sequence the server has authoritatively processed for
   * this player. `-1` means no input has been processed yet. The client
   * reconciles by re-applying local inputs with sequence > this value.
   */
  sequence: number;
  /** Horizontal facing, radians (0 faces -Z, positive rotates toward +X). */
  yaw: number;
  /** Vertical look, radians (0 = horizontal, positive = looking up). */
  pitch: number;
}
