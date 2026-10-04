/**
 * Public entry point for the weapon prediction / reconciliation layer.
 *
 * ```ts
 * import {
 *   WeaponController,
 *   SWITCH_WEAPON_MESSAGE,
 *   RELOAD_MESSAGE,
 *   FIRE_MESSAGE,
 *   WEAPON_STATE_UPDATE_EVENT,
 *   type LocalWeaponState,
 * } from "./game/weapon";
 * ```
 */
export {
  WeaponController,
  SWITCH_WEAPON_MESSAGE,
  RELOAD_MESSAGE,
  FIRE_MESSAGE,
  WEAPON_STATE_UPDATE_EVENT,
  FIRE_RESULT_EVENT,
  type LocalWeaponState,
  type WeaponFireResult,
  type WeaponSwitchResult,
  type WeaponReloadResult,
} from "./WeaponController";
