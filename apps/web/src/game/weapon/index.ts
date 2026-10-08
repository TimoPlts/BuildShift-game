/**
 * Public entry point for the weapon prediction / reconciliation layer.
 *
 * ```ts
 * import {
 *   WeaponController,
 *   type LocalWeaponState,
 * } from "./game/weapon";
 * ```
 */
export {
  WeaponController,
  type LocalWeaponState,
  type WeaponFireResult,
  type WeaponSwitchResult,
  type WeaponReloadResult,
} from "./WeaponController";
