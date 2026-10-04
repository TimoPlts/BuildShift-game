/**
 * Weapon HUD barrel exports — presentation-only React components for the
 * BuildShift 1v1 Energy Box Fight weapon status.
 *
 * - **WeaponHud** — bottom-left overlay showing the active weapon name,
 *   the `currentAmmo / maxAmmo` counter, a thin reload progress bar while
 *   reloading, and a compact weapon-slot indicator with the active slot
 *   highlighted.
 *
 * All components are purely presentational: they accept the local player's
 * weapon state via props and perform no networking, no game runtime queries,
 * and no side effects beyond rendering.
 */

export {
  WeaponHud,
  type WeaponHudProps,
  type WeaponStateView,
} from "./WeaponHud";
