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
 *  - lastInputSequence — the highest input sequence the server has processed
 *                    for this player; used by the owning client for
 *                    reconciliation (re-apply inputs with sequence > this).
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
     * Highest input sequence the server has authoritatively processed for
     * this player. `-1` means no input has been processed yet. The client
     * reconciles by re-applying local inputs with sequence > this value.
     */
    lastInputSequence: t.number(),
  },
  "PlayerStateSchema",
);

/** Instance type of {@link PlayerStateSchema}. */
export type PlayerStateSchemaInstance = InstanceType<typeof PlayerStateSchema>;
