/**
 * Stage 2B2 server-side room state — the minimal authoritative `players`
 * collection.
 *
 * This is the first `@colyseus/schema` state this project ships. It is a
 * deliberately minimal wire schema (see docs/TECHNICAL_ARCHITECTURE.md §6):
 *
 *  - one entry per connected player, keyed by the Colyseus client `sessionId`;
 *  - each entry carries the minimal data the accepted Stage 2B1 contract
 *    (`AuthoritativePlayerState`, `@buildshift/protocol`) describes:
 *      * `playerId`           — stable id (the `sessionId`),
 *      * `x` / `y` / `z`      — world position in **metres**, origin at the
 *                               world floor, Y-up, **capsule CENTRE** semantic
 *                               (see `PlayerPositionSemantic`),
 *      * `yaw`                — horizontal facing in **radians** (0 faces -Z,
 *                               positive rotates toward +X),
 *      * `acknowledgedSequence` — highest input sequence the server has
 *                               authoritatively processed (`-1` = none yet).
 *
 * Wire-shape note: the protocol *contract* expresses position as a nested
 * `position: { x, y, z }` object. This wire schema keeps the coordinate
 * scalars FLAT (Colyseus serializes scalar fields directly), which is the
 * lighter, canonical form for the wire. `toAuthoritativePlayerState` below
 * performs the explicit mapping back to the contract shape so the two can
 * never silently drift.
 *
 * Deliberately minimal: no health, energy, weapons, ammo, building, teams,
 * rank, velocity, or pitch. Those belong to later game-mode stages.
 *
 * `@colyseus/schema` v5 is used in its decorator-free `schema()` / `t.*`
 * factory form (see the package docs), so no `experimentalDecorators` /
 * `emitDecoratorMetadata` is required — this file compiles under the
 * repo's current `tsconfig.base.json` as-is.
 */
import { schema, t, MapSchema } from "@colyseus/schema";

import type { AuthoritativePlayerState } from "@buildshift/protocol";

/**
 * Neutral, non-gameplay spawn used for bootstrap transport state.
 *
 * This is a documented placeholder, NOT an authoritative gameplay spawn.
 * Authoritative spawn/movement is out of scope for Stage 2B2 and arrives in a
 * later stage (Stage 2C). The origin is chosen so a freshly-joined player has
 * a well-defined, finite capsule-centre position before any movement input is
 * processed.
 */
export const NEUTRAL_SPAWN = { x: 0, y: 0, z: 0 } as const;

/**
 * Initial `acknowledgedSequence` for a player that has not processed any input
 * yet — matches the contract's "none processed" sentinel.
 */
export const NO_SEQUENCE_ACKNOWLEDGED = -1;

/**
 * Per-player authoritative state synced to clients (Stage 2B2 minimal).
 */
export const PlayerState = schema(
  {
    /** Stable player/session id (the Colyseus client `sessionId`). */
    playerId: t.string(),
    /** World X, metres, capsule-centre semantic. */
    x: t.number(),
    /** World Y, metres (up), capsule-centre semantic. */
    y: t.number(),
    /** World Z, metres, capsule-centre semantic. */
    z: t.number(),
    /** Horizontal facing, radians (0 faces -Z, positive toward +X). */
    yaw: t.number(),
    /** Highest input sequence processed authoritatively; -1 = none yet. */
    acknowledgedSequence: t.number(),
  },
  "PlayerState",
);

/**
 * Root room state for the `foundation` room (Stage 2B2).
 *
 * `players` is keyed by Colyseus client `sessionId`.
 */
export const FoundationRoomState = schema(
  {
    players: t.map(PlayerState),
  },
  "FoundationRoomState",
);

export type PlayerStateInstance = InstanceType<typeof PlayerState>;
export type FoundationRoomStateInstance = InstanceType<
  typeof FoundationRoomState
>;

/**
 * Explicitly map a server-side `PlayerState` instance to the shared protocol
 * contract shape (`AuthoritativePlayerState`).
 *
 * The position coordinate semantic is **capsule-centre** (Y-up, metres), per
 * the `PlayerPositionSemantic` contract constant. This mapping is the single
 * place where the flat wire fields are re-assembled into the contract's
 * nested `position` object, so a future contract/wire shape mismatch is
 * caught at this boundary instead of leaking through call sites.
 */
export function toAuthoritativePlayerState(
  p: PlayerStateInstance,
): AuthoritativePlayerState {
  // The position coordinates carry the contract's capsule-centre semantic
  // (Y-up, metres); see `PlayerPositionSemantic` in `@buildshift/protocol`.
  return {
    playerId: p.playerId,
    position: { x: p.x, y: p.y, z: p.z },
    yaw: p.yaw,
    acknowledgedSequence: p.acknowledgedSequence,
  };
}

/**
 * Convenience alias so call sites that only need the `MapSchema` of players
 * (e.g. to iterate or check membership) can be type-precise.
 */
export type PlayersMap = MapSchema<PlayerStateInstance, string>;
