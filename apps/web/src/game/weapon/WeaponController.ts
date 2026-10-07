import type { WeaponType, FireRequest, Vec3 } from "@buildshift/protocol";
import { isWeaponType } from "@buildshift/protocol";
import { getEnergyFightWeaponById, type EnergyFightWeaponId, ASSAULT_RIFLE_WEAPON_ID } from "@buildshift/game-config";

export const SWITCH_WEAPON_MESSAGE = "weapon:switch" as const;
export const RELOAD_MESSAGE = "weapon:reload" as const;
export const FIRE_MESSAGE = "weapon:fire" as const;
export const WEAPON_STATE_UPDATE_EVENT = "weapon:state_update" as const;
export const FIRE_RESULT_EVENT = "weapon:fire_result" as const;

export interface LocalWeaponState {
  weaponType: WeaponType;
  currentAmmo: number;
  maxAmmo: number;
  isReloading: boolean;
  reloadProgress: number;
  canFire: boolean;
}

export interface WeaponFireResult {
  fired: boolean;
  currentAmmo: number;
  request: FireRequest | null;
}

export interface WeaponSwitchResult {
  switched: boolean;
  targetWeapon: WeaponType | null;
}

export interface WeaponReloadResult {
  started: boolean;
  weaponType: WeaponType | null;
}

export interface WeaponStateUpdatePayload {
  playerId: string;
  weaponState: {
    weaponType: string;
    currentAmmo: number;
    maxAmmo: number;
    isReloading: boolean;
    reloadProgress: number;
  };
}

export class WeaponController {
  private _activeWeapon: WeaponType = "assault_rifle";
  private _currentAmmo: number;
  private _maxAmmo: number;
  private _fireCooldownElapsedMs = Infinity;
  private _fireIntervalMs: number;
  private _isReloading = false;
  private _reloadElapsedMs = 0;
  private _reloadDurationMs: number;

  constructor() {
    const w = getEnergyFightWeaponById(ASSAULT_RIFLE_WEAPON_ID)!;
    this._currentAmmo = w.magazineSize;
    this._maxAmmo = w.magazineSize;
    this._fireIntervalMs = 1000 / w.fireRatePerSec;
    this._reloadDurationMs = w.reloadTimeMs;
  }

  get activeWeapon(): WeaponType { return this._activeWeapon; }
  get currentAmmo(): number { return this._currentAmmo; }
  get isReloading(): boolean { return this._isReloading; }
  get reloadProgress(): number {
    if (!this._isReloading) return 0;
    return Math.min(this._reloadElapsedMs / this._reloadDurationMs, 1);
  }
  get canFireNow(): boolean {
    return this._fireCooldownElapsedMs >= this._fireIntervalMs && this._currentAmmo > 0 && !this._isReloading;
  }

  getLocalState(): LocalWeaponState {
    return { weaponType: this._activeWeapon, currentAmmo: this._currentAmmo, maxAmmo: this._maxAmmo, isReloading: this._isReloading, reloadProgress: this.reloadProgress, canFire: this.canFireNow };
  }

  tryFire(aimDirection: Vec3): WeaponFireResult {
    if (this._isReloading) return { fired: false, currentAmmo: this._currentAmmo, request: null };
    if (this._fireCooldownElapsedMs < this._fireIntervalMs) return { fired: false, currentAmmo: this._currentAmmo, request: null };
    if (this._currentAmmo <= 0) return { fired: false, currentAmmo: 0, request: null };
    this._currentAmmo -= 1;
    this._fireCooldownElapsedMs = 0;
    return { fired: true, currentAmmo: this._currentAmmo, request: { weaponType: this._activeWeapon, aimDirection } };
  }

  switchWeapon(targetWeapon: string): WeaponSwitchResult {
    if (!isWeaponType(targetWeapon)) return { switched: false, targetWeapon: null };
    if (this._activeWeapon === targetWeapon) return { switched: false, targetWeapon: null };
    this._activeWeapon = targetWeapon;
    const w = getEnergyFightWeaponById(targetWeapon as EnergyFightWeaponId);
    if (w) {
      this._currentAmmo = w.magazineSize;
      this._maxAmmo = w.magazineSize;
      this._fireIntervalMs = 1000 / w.fireRatePerSec;
      this._reloadDurationMs = w.reloadTimeMs;
    }
    this._isReloading = false;
    this._reloadElapsedMs = 0;
    this._fireCooldownElapsedMs = Infinity;
    return { switched: true, targetWeapon };
  }

  startReload(): WeaponReloadResult {
    if (this._isReloading) return { started: false, weaponType: null };
    if (this._currentAmmo >= this._maxAmmo) return { started: false, weaponType: null };
    this._isReloading = true;
    this._reloadElapsedMs = 0;
    return { started: true, weaponType: this._activeWeapon };
  }

  tick(deltaTimeMs: number): void {
    this._fireCooldownElapsedMs += deltaTimeMs;
    if (this._isReloading) {
      this._reloadElapsedMs += deltaTimeMs;
      if (this._reloadElapsedMs >= this._reloadDurationMs) {
        this._isReloading = false;
        this._reloadElapsedMs = 0;
        this._currentAmmo = this._maxAmmo;
      }
    }
  }

  reconcile(update: WeaponStateUpdatePayload, localPlayerId: string): boolean {
    if (update.playerId !== localPlayerId) return false;
    const ws = update.weaponState;
    if (!ws || !isWeaponType(ws.weaponType)) return false;
    this._activeWeapon = ws.weaponType;
    this._currentAmmo = ws.currentAmmo;
    this._maxAmmo = ws.maxAmmo;
    this._isReloading = ws.isReloading;
    if (ws.isReloading) {
      this._reloadElapsedMs = ws.reloadProgress * this._reloadDurationMs;
    } else {
      this._reloadElapsedMs = 0;
    }
    return true;
  }

  reset(): void {
    this._activeWeapon = "assault_rifle";
    const w = getEnergyFightWeaponById(ASSAULT_RIFLE_WEAPON_ID)!;
    this._currentAmmo = w.magazineSize;
    this._maxAmmo = w.magazineSize;
    this._fireIntervalMs = 1000 / w.fireRatePerSec;
    this._reloadDurationMs = w.reloadTimeMs;
    this._isReloading = false;
    this._reloadElapsedMs = 0;
    this._fireCooldownElapsedMs = Infinity;
  }

  dispose(): void {}
}
