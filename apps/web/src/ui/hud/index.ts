/**
 * Weapon HUD barrel exports — presentation-only React components for the
 * BuildShift 1v1 Energy Box Fight weapon status.
 *
 * - **WeaponHUD** — bottom-left overlay showing the active weapon name,
 *   the `magazineAmmo / reserveAmmo` counter, a thin reload progress bar
 *   while reloading, and a compact weapon-slot indicator with the active
 *   slot highlighted.
 * - **WeaponAmmoDisplay** — focused, reusable ammo counter (`magazine /
 *   reserve`) with automatic visual state (normal / low / empty).
 * - **ReloadProgressBar** — focused, reusable thin reload progress bar with
 *   full ARIA progressbar semantics.
 *
 * All components are purely presentational: they accept the local player's
 * weapon state via explicit props and perform no networking, no game runtime
 * queries, and no side effects beyond rendering.
 */

export {
  WeaponHUD,
  type WeaponHUDProps,
  type WeaponStateView,
} from "./WeaponHud";

export {
  WeaponAmmoDisplay,
  type WeaponAmmoDisplayProps,
} from "./WeaponAmmoDisplay";

export {
  ReloadProgressBar,
  type ReloadProgressBarProps,
} from "./ReloadProgressBar";
