/**
 * Weapon HUD barrel exports — presentation-only React components for the
 * BuildShift 1v1 Energy Box Fight weapon status.
 *
 * - **WeaponHUD** — bottom-left overlay showing the active weapon name,
 *   the `magazineAmmo / reserveAmmo` counter, a thin reload progress bar
 *   while reloading, and a compact weapon-slot indicator with the active
 *   slot highlighted.
 *
 * - **WeaponStatusText** — a small, reusable single-line readout that
 *   renders a concise, human-readable descriptor of the authoritative
 *   weapon state (readiness, reload progress %, and magazine/reserve
 *   counts). Exported for use by other HUD surfaces or tests.
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

export {
  WeaponStatusText,
  describeWeaponStatus,
  type WeaponStatusTextProps,
} from "./WeaponStatusText";
