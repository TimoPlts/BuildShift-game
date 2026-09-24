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
 *      * `position.{x,y,z}`   — world position in **metres**, origin at the
 *                               world floor, Y-up, **capsule CENTRE** semantic
 *                               (see `PlayerPositionSemantic`),
 *      * `yaw`                — horizontal facing in **radians** (0 faces -Z,
 *                               positive rotates toward +X),
 *      * `acknowledgedSequence` — highest input sequence the server has
 *                               authoritatively processed (`-1` = none yet).
 *
 * Wire-shape note: the synchronized player state DIRECTLY mirrors the shared
 * protocol contract. `position` is a nested `t.ref` schema, so browser clients
 * (which receive the real Colyseus wire state, not a server-side mapper) see
 * `player.position.{x,y,z}` — the same shape as `AuthoritativePlayerState`.
 * There is therefore no server-only remapping helper; the wire and the
 * contract share one shape by construction.
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
 * Nested world position (metres, capsule-centre, Y-up) for a synchronized
 * player.
 *
 * Expressed as its own schema so the coordinate trio is a first-class,
 * individually-synchronized `t.ref`. Because this schema defines no
 * `initialize(...args)` (zero-arg), `t.ref` auto-instantiates a fresh
 * `PositionState` for each owning player (verified against the installed
 * `@colyseus/schema` v5 `RefHasDefault` rule) — no `.default()` is required.
 */
export const PositionState = schema(
  {
    /** World X, metres, capsule-centre semantic. */
    x: t.number(),
    /** World Y, metres (up), capsule-centre semantic. */
    y: t.number(),
    /** World Z, metres, capsule-centre semantic. */
    z: t.number(),
  },
  "PositionState",
);

/**
 * Per-player authoritative state synced to clients (Stage 2B2 minimal).
 *
 * The field set intentionally mirrors the shared protocol contract
 * (`AuthoritativePlayerState`): `playerId`, nested `position`, `yaw`,
 * `acknowledgedSequence`.
 */
export const PlayerState = schema(
  {
    /** Stable player/session id (the Colyseus client `sessionId`). */
    playerId: t.string(),
    /**
     * World position (metres, capsule-centre). A nested ref that is
     * auto-instantiated per player; clients read `position.{x,y,z}`.
     */
    position: t.ref(PositionState),
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

export type PositionStateInstance = InstanceType<typeof PositionState>;
export type PlayerStateInstance = InstanceType<typeof PlayerState>;
export type FoundationRoomStateInstance = InstanceType<
  typeof FoundationRoomState
>;

/**
 * Convenience alias so call sites that only need the `MapSchema` of players
 * (e.g. to iterate or check membership) can be type-precise.
 */
export type PlayersMap = MapSchema<PlayerStateInstance, string>;
