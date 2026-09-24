/**
 * AuthoritativePlayerState — the minimal shared, plain-TypeScript view of one
 * player that the authoritative server will eventually expose to clients.
 *
 * It is sufficient for:
 * - identifying a player/session (`playerId`),
 * - authoritative world position (`position`),
 * - horizontal facing needed for rendering (`yaw`),
 * - acknowledging the most recently processed input (`acknowledgedSequence`).
 *
 * Deliberately minimal: no health, weapons, building, ranking, energy, ammo,
 * etc. Those belong to later game-mode contracts.
 *
 * NOTE: this is a *contract / plain-data* shape. The future server may
 * implement an equivalent Colyseus `Schema` class that conforms to it; this
 * package intentionally does not depend on `@colyseus/schema`.
 */
export interface AuthoritativePlayerState {
  /**
   * Stable identifier for this player/session within the room. Chosen by the
   * server (e.g. the Colyseus `sessionId`); the client uses it to match remote
   * state to its local rendering entity.
   */
  playerId: string;

  /**
   * Authoritative world position, in **metres**, origin at the world floor
   * (Y = up). **Coordinate semantic: the capsule CENTRE** — the physics body
   * translation. See {@link PlayerPositionSemantic} and the note in
   * `docs/TECHNICAL_ARCHITECTURE.md` §19.
   */
  position: {
    x: number;
    y: number;
    z: number;
  };

  /**
   * Horizontal facing, in **radians** (0 faces -Z, positive rotates toward +X)
   * — the same convention as the input `lookYaw` and the movement math.
   */
  yaw: number;

  /**
   * The highest `PlayerInputFrame.sequence` this player's input the server has
   * authoritatively processed. The client reconciles by reapplying its local
   * inputs with `sequence > acknowledgedSequence` (docs §14/§15). `-1` means
   * "none processed yet" (before the first input round-trip).
   */
  acknowledgedSequence: number;
}

/**
 * Explicit, documented choice of the authoritative network position semantic,
 * so client and server cannot later disagree.
 *
 * The authoritative position is the **capsule centre** (the physics body
 * translation) for these reasons:
 *
 * 1. The physics body (Rapier `RigidBody`) is the source of truth, and its
 *    translation **is** the capsule centre — `PhysicsWorld.getPosition()`
 *    returns exactly that. The authoritative server reproduces this value
 *    directly, with no derivation.
 * 2. It is unambiguous and independent of the collider dimension. The feet
 *    position is a *derived* presentation value (centre − `CHARACTER_HEIGHT_OVER_2`,
 *    see `PlayerController.getFeetPosition()`); a derived value is a weaker
 *    thing to make the wire contract than the source-of-truth value.
 * 3. A single convention keeps the shared `@buildshift/simulation` movement
 *    step (which operates on the body centre) directly reusable by both the
 *    prediction client and the authoritative server.
 *
 * Consumers that need feet (e.g. the camera's "feet + target height" contract)
 * derive them from the centre using the shared character-height constant.
 */
export const PlayerPositionSemantic = {
  kind: "capsule-center",
  /** Metres from the capsule centre down to the feet (collider half-height). */
  centreToFeetOffset: 0.9,
} as const;
