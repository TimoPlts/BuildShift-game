/**
 * Weapon HUD barrel exports — presentation-only React components for the
 * BuildShift 1v1 Energy Box Fight weapon status.
 *
 * **Composed overlay:**
 *  - **WeaponHUD** — bottom-left overlay showing the active weapon name,
 *    the `magazineAmmo / reserveAmmo` counter, a thin reload progress bar
 *    while reloading, and a compact weapon-slot indicator with the active
 *    slot highlighted.
 *
 * **Individually-usable sub-components:**
 *  - **WeaponName** — a compact uppercase label for the active weapon type.
 *  - **WeaponAmmoCounter** — a "magazine / reserve" ammo readout with
 *    state-based colouring (normal → low → empty).
 *  - **WeaponReloadBar** — a thin horizontal reload progress bar.
 *
 * All components are purely presentational: they accept the local player's
 * weapon state via props and perform no networking, no game runtime queries,
 * and no side effects beyond rendering.
 */

export {
  WeaponHUD,
  type WeaponHUDProps,
  type WeaponStateView,
} from "./WeaponHud";

export { WeaponName, type WeaponNameProps } from "./WeaponName";

export { WeaponAmmoCounter, type WeaponAmmoCounterProps } from "./WeaponAmmoCounter";

export { WeaponReloadBar, type WeaponReloadBarProps } from "./WeaponReloadBar";
