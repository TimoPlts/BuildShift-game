/**
 * WeaponHud — a presentation-only weapon HUD for the BuildShift 1v1 Energy
 * Box Fight mode.
 *
 * Displays the local player's authoritative weapon state:
 *  - the active weapon's name (small label)
 *  - the active weapon's ammo as `currentAmmo / maxAmmo`
 *  - a thin horizontal reload progress bar while the active weapon is
 *    reloading (fills based on `reloadProgress`)
 *  - an unobtrusive weapon-slot indicator for every weapon in the loadout,
 *    with the currently equipped one highlighted
 *
 * The data source is the local player's {@link WeaponStateView} as produced
 * by the GameRuntime's authoritative weapon pipeline. This component is
 * purely presentational: all values are supplied via explicit props; it
 * performs no networking, no runtime queries, and no side effects beyond
 * rendering. It deliberately does not touch the existing health, energy, or
 * round-timer HUD elements.
 *
 * Example usage:
 * ```tsx
 * <WeaponHud
 *   activeWeapon={{
 *     weaponType: "assault_rifle",
 *     currentAmmo: 12,
 *     maxAmmo: 30,
 *     isReloading: true,
 *     reloadProgress: 0.42,
 *   }}
 *   weapons={[
 *     { weaponType: "assault_rifle", currentAmmo: 12, maxAmmo: 30, isReloading: true, reloadProgress: 0.42 },
 *     { weaponType: "shotgun", currentAmmo: 4, maxAmmo: 4, isReloading: false, reloadProgress: 0 },
 *   ]}
 * />
 * ```
 */

import type { WeaponType } from "@buildshift/protocol";
import "./weapon-hud.css";

/**
 * A view of a single weapon slot's authoritative state, in the shape the HUD
 * needs. Mirrors the fields of the protocol weapon state (`currentAmmo`,
 * `maxAmmo`, `isReloading`, `reloadProgress`) plus the canonical
 * {@link WeaponType} so the active weapon can be identified in the slot
 * indicator.
 */
export interface WeaponStateView {
  /** The canonical weapon type occupying this slot. */
  weaponType: WeaponType;
  /** Rounds currently loaded in the magazine (>= 0). */
  currentAmmo: number;
  /** Maximum rounds the magazine holds (> 0). */
  maxAmmo: number;
  /** `true` while this weapon is in the middle of a reload. */
  isReloading: boolean;
  /**
   * Reload progress from 0 (reload just started) to 1 (reload complete).
   * Meaningful only while {@link isReloading} is `true`.
   */
  reloadProgress: number;
}

/**
 * Explicit props for the weapon HUD.
 *
 * All values represent the **local player's** weapon state as supplied by the
 * runtime.
 */
export interface WeaponHudProps {
  /** The local player's currently equipped (active) weapon. */
  activeWeapon: WeaponStateView;
  /**
   * Every weapon in the local player's loadout, in display order. Used to
   * render the weapon-slot indicator; the active one is the entry whose
   * `weaponType` matches {@link activeWeapon.weaponType}.
   */
  weapons: WeaponStateView[];
}

/** Human-readable display names for each weapon type. */
const WEAPON_NAMES: Record<WeaponType, string> = {
  assault_rifle: "Assault Rifle",
  shotgun: "Shotgun",
};

/** Short glyphs used in the compact slot indicator chips. */
const WEAPON_GLYPHS: Record<WeaponType, string> = {
  assault_rifle: "\u25ac",
  shotgun: "\u2733",
};

/** Clamp `value` into the inclusive range `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * A presentation-only weapon HUD.
 *
 * Renders a fixed-position overlay at the bottom-left of the viewport showing
 * the active weapon name, its `currentAmmo / maxAmmo` count, a thin reload
 * progress bar (only while the active weapon is reloading), and a compact slot
 * indicator for every weapon in the loadout with the equipped one highlighted.
 */
export function WeaponHud(props: WeaponHudProps): JSX.Element {
  const { activeWeapon, weapons } = props;

  // Guard against malformed inputs so the counter never renders a negative or
  // over-max value.
  const maxAmmo = Math.max(1, activeWeapon.maxAmmo);
  const currentAmmo = Math.round(clamp(activeWeapon.currentAmmo, 0, maxAmmo));
  const ammoEmpty = currentAmmo <= 0;

  const reloadFraction = clamp(activeWeapon.reloadProgress, 0, 1);
  const reloadPercent = (reloadFraction * 100).toFixed(1);

  const weaponName =
    WEAPON_NAMES[activeWeapon.weaponType] ?? activeWeapon.weaponType;

  return (
    <div className="weapon-hud" aria-live="polite" aria-label="Weapon status">
      {/* ── Weapon-slot indicator (one chip per loadout weapon) ── */}
      {weapons.length > 0 && (
        <div
          className="weapon-hud__slots"
          role="list"
          aria-label="Weapon slots"
        >
          {weapons.map((weapon) => {
            const isActive = weapon.weaponType === activeWeapon.weaponType;
            const slotName =
              WEAPON_NAMES[weapon.weaponType] ?? weapon.weaponType;
            return (
              <div
                key={weapon.weaponType}
                role="listitem"
                aria-current={isActive || undefined}
                className={`weapon-hud__slot ${
                  isActive ? "weapon-hud__slot--active" : ""
                }`}
              >
                <span className="weapon-hud__slot-glyph" aria-hidden="true">
                  {WEAPON_GLYPHS[weapon.weaponType] ?? ""}
                </span>
                <span className="weapon-hud__slot-name">{slotName}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Active weapon: name + ammo counter ── */}
      <div className="weapon-hud__active">
        <span className="weapon-hud__name">{weaponName}</span>
        <span
          className={`weapon-hud__ammo ${
            ammoEmpty ? "weapon-hud__ammo--empty" : ""
          }`}
        >
          {currentAmmo} / {maxAmmo}
        </span>
      </div>

      {/* ── Reload progress bar (only while the active weapon reloads) ── */}
      {activeWeapon.isReloading && (
        <div
          className="weapon-hud__reload-track"
          role="progressbar"
          aria-valuenow={Math.round(reloadFraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Reload in progress"
        >
          <div
            className="weapon-hud__reload-fill"
            style={{ width: `${reloadPercent}%` }}
          />
        </div>
      )}
    </div>
  );
}
