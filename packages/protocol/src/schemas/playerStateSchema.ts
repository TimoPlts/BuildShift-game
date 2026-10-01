/**
 * PlayerStateSchema — the Colyseus wire schema for a single player's
 * authoritative movement state broadcast to all clients in the room.
 *
 * This is the Stage 2D two-player movement schema. It is the Colyseus
 * `Schema` class (via the decorator-free `schema()` factory from
 * `@colyseus/schema` v5) that the authoritative server populates each tick
 * and that Colyseus' built-in state synchronisation delivers to clients.
 *
 * Fields:
 *  - x, y, z       — world position in metres, Y-up, capsule-centre semantic.
 *  - yaw           — horizontal facing in radians (0 faces -Z, positive
 *                    rotates toward +X).
 *  - velocityY     — vertical velocity in m/s (positive = upward). Used for
 *                    jump/fall rendering on remote clients.
 *  - grounded      — true when the character is in contact with the ground.
 *  - lastProcessedSequence — the highest input sequence the server has
 *                    authoritatively processed for this player; used by the
 *                    owning client for reconciliation (rollback + replay).
 *
 * Coordinate convention matches `PlayerPositionSemantic` (capsule-centre)
 * and the shared `@buildshift/simulation` movement step.
 */
import { schema, t } from "@colyseus/schema";

export const PlayerStateSchema = schema(
  {
    /** World X, metres, capsule-centre semantic. */
    x: t.number(),
    /** World Y, metres (up), capsule-centre semantic. */
    y: t.number(),
    /** World Z, metres, capsule-centre semantic. */
    z: t.number(),
    /** Horizontal facing, radians (0 faces -Z, positive rotates toward +X). */
    yaw: t.number(),
    /** Vertical velocity, m/s (positive = upward). */
    velocityY: t.number(),
    /** True when the character is grounded. */
    grounded: t.boolean(),
    /**
     * Highest input sequence number the server has authoritatively processed
     * for this player. The client uses this to determine which of its
     * locally-buffered inputs have been acknowledged by the server so it can
     * perform reconciliation (rollback + replay). `-1` means no input has
     * been processed yet.
     */
    lastProcessedSequence: t.number(),
  },
  "PlayerStateSchema",
);

/** Instance type of {@link PlayerStateSchema}. */
export type PlayerStateSchemaInstance = InstanceType<typeof PlayerStateSchema>;
