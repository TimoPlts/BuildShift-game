/**
 * Weapon HUD barrel exports — presentation-only React components for the
 * BuildShift 1v1 Energy Box Fight weapon status.
 *
 * Composite:
 *  - **WeaponHud** — bottom-left overlay showing the active weapon name,
 *    the `magazineAmmo / reserveAmmo` counter, a thin reload progress bar
 *    while reloading, and a compact weapon-slot indicator with the active
 *    slot highlighted.
 *
 * Sub-components (also usable standalone):
 *  - **WeaponName** — the active weapon's display name label
 *  - **WeaponAmmoCounter** — magazine / reserve ammunition display
 *  - **WeaponReloadProgress** — thin reload progress bar
 *
 * All components are purely presentational: they accept the local player's
 * weapon state via props and perform no networking, no game runtime
 * queries, and no side effects beyond rendering.
 */

export {
  WeaponHud,
  type WeaponHUDProps,
  type WeaponStateView,
} from "./WeaponHud";

export {
  WeaponName,
  type WeaponNameProps,
} from "./WeaponName";

export {
  WeaponAmmoCounter,
  type WeaponAmmoCounterProps,
} from "./WeaponAmmoCounter";

export {
  WeaponReloadProgress,
  type WeaponReloadProgressProps,
} from "./WeaponReloadProgress";
