/**
 * WeaponHUD — a presentation-only weapon HUD for the BuildShift 1v1 Energy
 * Box Fight mode.
 *
 * Displays the local player's authoritative weapon state:
 *  - the active weapon's name (small label)
 *  - the active weapon's magazine ammo (primary) and reserve ammo (secondary)
 *  - a thin horizontal reload progress bar while the active weapon is
 *    reloading (fills based on `reloadProgress`)
 *  - an unobtrusive weapon-slot indicator for every weapon in the loadout,
 *    with the currently equipped one highlighted
 *
 * The data source is the local player's {@link WeaponAmmoState} as produced
 * by the authoritative server (via the Colyseus `PlayerStateSchema.weapons`
 * map). This component is purely presentational: all values are supplied via
 * explicit props; it performs no networking, no runtime queries, and no side
 * effects beyond rendering. It deliberately does not touch the existing
 * health, energy, or round-timer HUD elements.
 *
 * The HUD is composed from smaller, independently-usable sub-components:
 *  - {@link WeaponName}        — the active weapon's label
 *  - {@link WeaponAmmoCounter} — magazine / reserve ammo readout
 *  - {@link WeaponReloadBar}   — reload progress bar
 *
 * Example usage:
 * ```tsx
 * <WeaponHUD
 *   activeWeapon={{
 *     weaponType: "assault_rifle",
 *     magazineAmmo: 12,
 *     reserveAmmo: 48,
 *     isReloading: true,
 *     reloadProgress: 0.42,
 *   }}
 *   weapons={[
 *     { weaponType: "assault_rifle", magazineAmmo: 12, reserveAmmo: 48, isReloading: true, reloadProgress: 0.42 },
 *     { weaponType: "shotgun", magazineAmmo: 4, reserveAmmo: 16, isReloading: false, reloadProgress: 0 },
 *   ]}
 * />
 * ```
 */

import type { WeaponType } from "@buildshift/protocol";
import { WeaponName } from "./WeaponName";
import { WeaponAmmoCounter } from "./WeaponAmmoCounter";
import { WeaponReloadBar } from "./WeaponReloadBar";
import "./weapon-hud.css";

/**
 * A view of a single weapon slot's authoritative state, in the shape the HUD
 * needs. Mirrors the protocol `WeaponAmmoState` fields
 * (`magazineAmmo`, `reserveAmmo`, `isReloading`, `reloadProgress`) plus the
 * canonical {@link WeaponType} so the active weapon can be identified in the
 * slot indicator.
 */
export interface WeaponStateView {
  /** The canonical weapon type occupying this slot. */
  weaponType: WeaponType;
  /** Rounds currently loaded in the magazine (>= 0). */
  magazineAmmo: number;
  /** Rounds available in the reserve to reload the magazine (>= 0). */
  reserveAmmo: number;
  /** `true` while this weapon is in the middle of a reload. */
  isReloading: boolean;
  /**
   * Reload progress from 0 (reload just started) to 1 (reload complete).
   * Meaningful only while {@link isReloading} is `true`.
   */
  reloadProgress: number;
}

/**
 * Explicit props for the WeaponHUD.
 *
 * All values represent the **local player's** weapon state as supplied by the
 * runtime.
 */
export interface WeaponHUDProps {
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

/**
 * A presentation-only weapon HUD.
 *
 * Renders a fixed-position overlay at the bottom-left of the viewport showing
 * the active weapon name, its `magazineAmmo / reserveAmmo` counter, a thin
 * reload progress bar (only while the active weapon is reloading), and a
 * compact slot indicator for every weapon in the loadout with the equipped
 * one highlighted.
 */
export function WeaponHUD(props: WeaponHUDProps): JSX.Element {
  const { activeWeapon, weapons } = props;

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
        <WeaponName weaponType={activeWeapon.weaponType} />
        <WeaponAmmoCounter
          magazineAmmo={activeWeapon.magazineAmmo}
          reserveAmmo={activeWeapon.reserveAmmo}
        />
      </div>

      {/* ── Reload progress bar (only while the active weapon reloads) ── */}
      {activeWeapon.isReloading && (
        <WeaponReloadBar progress={activeWeapon.reloadProgress} />
      )}
    </div>
  );
}
