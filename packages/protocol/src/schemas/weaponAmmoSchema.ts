/**
 * WeaponAmmoStateSchema — the Colyseus wire schema for a single weapon's
 * authoritative ammo + reload state, carried per-weapon on a player's
 * `weapons` map (see `PlayerStateSchema`).
 *
 * This is the wire form of the plain-data `WeaponAmmoState` in
 * `state/playerState.ts`. It is the Colyseus `Schema` class (via the
 * decorator-free `schema()` factory from `@colyseus/schema` v5) the
 * authoritative server populates each tick and that Colyseus' built-in state
 * synchronisation delivers to clients, so the owning client (and any HUD) can
 * render the magazine / reserve ammo and any reload animation deterministically.
 *
 * Fields:
 *  - magazineAmmo   — rounds currently loaded in the weapon's magazine.
 *  - reserveAmmo    — rounds available to reload the magazine.
 *  - isReloading    — `true` while a reload is in progress.
 *  - reloadProgress — reload progress in `[0, 1]` (`1` = complete).
 */
import { schema, t } from "@colyseus/schema";

export const WeaponAmmoStateSchema = schema(
  {
    /** Rounds currently loaded in this weapon's magazine. */
    magazineAmmo: t.number(),
    /** Rounds available to reload the magazine. */
    reserveAmmo: t.number(),
    /** `true` while this weapon is in the middle of a reload. */
    isReloading: t.boolean(),
    /**
     * Reload progress, in `[0, 1]`. `0` when not reloading (or a reload just
     * started); `1` when the reload is complete. Ignored while
     * `isReloading` is `false`.
     */
    reloadProgress: t.number(),
  },
  "WeaponAmmoStateSchema",
);

/** Instance type of {@link WeaponAmmoStateSchema}. */
export type WeaponAmmoStateSchemaInstance =
  InstanceType<typeof WeaponAmmoStateSchema>;
