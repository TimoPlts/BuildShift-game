/**
 * PlayerStateSchema — the Colyseus wire schema for a single player's
 * authoritative state broadcast to all clients in the room.
 *
 * This is the canonical player state schema. It started life as the Stage 2D
 * two-player movement schema and was extended for the canonical hitscan combat
 * contract with the authoritative combat fields: `health`, `shield`, `energy`,
 * `ammo`, `lastFireSequence`, and `isEliminated`. It is the Colyseus `Schema`
 * class (via the decorator-free `schema()` factory from `@colyseus/schema` v5)
 * that the authoritative server populates each tick and that Colyseus' built-in
 * state synchronisation delivers to clients.
 *
 * The 1v1 Energy Box Fight milestone extends it with the player's *weapon*
 * state: `currentWeapon` (the active {@link WeaponId}) and a `weapons` map
 * keyed by weapon id, each value a {@link WeaponAmmoStateSchema} carrying
 * magazine / reserve ammo and reload progress. `currentWeapon` is stored as a
 * plain string so it serialises cleanly over the wire (the shared
 * `WeaponId` vocabulary — `shotgun` / `assault_rifle` — is validated by the
 * consuming code).
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
 *  - health        — authoritative current health in points. The server sets
 *                    this to `MAX_HEALTH` on join and decreases it
 *                    authoritatively on a confirmed hit.
 *  - shield        — authoritative current shield in points. Shield absorbs
 *                    damage before health; initialised to `0` on join.
 *  - energy        — authoritative current energy in points (used by later
 *                    abilities); defaults to `0`.
 *  - ammo          — authoritative current magazine ammo for the active
 *                    weapon; the server sets this to the weapon's `maxAmmo`
 *                    on join and decrements it on each confirmed shot.
 *  - lastFireSequence — the highest input sequence at which this player last
 *                    fired; combined with the weapon `fireIntervalTicks`
 *                    cooldown it drives both local fire prediction and
 *                    server-side validation (see `canFire`).
 *  - alive         — authoritative liveness flag; `false` once the player can
 *                    no longer act.
 *  - isEliminated  — authoritative elimination flag; `true` once the player is
 *                    eliminated (health reached 0 and not yet respawned).
 *  - currentWeapon — authoritative id of the weapon the player currently has
 *                    equipped. Switching weapons updates this field so the
 *                    change syncs to all clients.
 *  - weapons       — per-weapon ammo + reload state, keyed by weapon id. Each
 *                    value is a {@link WeaponAmmoStateSchema} (magazineAmmo /
 *                    reserveAmmo / isReloading / reloadProgress). A weapon the
 *                    player does not carry is simply absent from the map.
 *
 * Coordinate convention matches `PlayerPositionSemantic` (capsule-centre)
 * and the shared `@buildshift/simulation` movement step.
 */
import { schema, t } from "@colyseus/schema";
import { WeaponAmmoStateSchema } from "./weaponAmmoSchema.js";

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
    /**
     * Authoritative current health in points. The server initialises this to
     * `MAX_HEALTH` on join and decreases it on a confirmed hit. Defaults to
     * `0` until the server assigns a value (Colyseus numeric default).
     */
    health: t.number(),
    /**
     * Authoritative current shield in points. Shield absorbs damage before
     * health; the server initialises it to `0` on join. Defaults to `0` until
     * the server assigns a value (Colyseus numeric default).
     */
    shield: t.number(),
    /**
     * Authoritative current energy in points. Used by later game-mode
     * abilities; the server initialises it on join. Defaults to `0` until the
     * server assigns a value (Colyseus numeric default).
     */
    energy: t.number(),
    /**
     * Authoritative current magazine ammo for the active weapon. The server
     * initialises this to the weapon's `maxAmmo` on join and decrements it on
     * each confirmed shot. Defaults to `0` until the server assigns a value
     * (Colyseus numeric default).
     */
    ammo: t.number(),
    /**
     * Highest input sequence at which this player last fired. Combined with
     * the weapon `fireIntervalTicks` cooldown it drives the fire gate
     * (`canFire`) on both the predicting client and the authoritative server.
     * `-1` means the player has not fired yet. Defaults to `0` until the
     * server assigns a value (Colyseus numeric default).
     */
    lastFireSequence: t.number(),
    /**
     * Authoritative liveness flag. `true` while the player can act; the server
     * flips it to `false` once health reaches `0`. Defaults to `false` until
     * the server assigns a value (Colyseus boolean default).
     */
    alive: t.boolean(),
    /**
     * Authoritative elimination flag. The server flips this to `true` once the
     * player is eliminated (health reached `0`). It is the combat-facing
     * counterpart of `alive` and is what client prediction and the fire gate
     * read to decide whether a local player may still fire. Defaults to
     * `false` until the server assigns a value (Colyseus boolean default).
     */
    isEliminated: t.boolean(),
    /**
     * Authoritative id of the weapon the player currently has equipped (the
     * "active" weapon). The server sets this on join and updates it when the
     * player switches weapons; the change syncs to all clients. Stored as a
     * plain string (the shared `WeaponId` vocabulary); defaults to `""` until
     * the server assigns a value (Colyseus string default).
     */
    currentWeapon: t.string(),
    /**
     * Per-weapon ammo + reload state, keyed by weapon id. Each value is a
     * {@link WeaponAmmoStateSchema} carrying `magazineAmmo`, `reserveAmmo`,
     * `isReloading`, and `reloadProgress`. The server adds an entry for each
     * weapon the player carries on join; a weapon the player does not carry is
     * simply absent from the map. Colyseus synchronises map additions,
     * removals, and value updates to every client automatically.
     */
    weapons: t.map(WeaponAmmoStateSchema),
  },
  "PlayerStateSchema",
);

/** Instance type of {@link PlayerStateSchema}. */
export type PlayerStateSchemaInstance = InstanceType<typeof PlayerStateSchema>;
