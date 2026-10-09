/**
 * WeaponHUD — a presentation-only weapon HUD for the BuildShift 1v1 Energy
 * Box Fight mode.
 *
 * Displays the local player's equipped weapon:
 *  - the active weapon's name (small label)
 *  - the active weapon's magazine rounds over its magazine capacity
 *    (`30 / 30`), driven by the authoritative replicated ammo value
 *  - a thin horizontal reload progress bar while the active weapon is
 *    reloading (fills based on `reloadProgress`), plus a "Press R to reload"
 *    prompt while the magazine is empty and no reload is running
 *  - an unobtrusive weapon-slot indicator for the two-weapon loadout, with
 *    the equipped weapon highlighted and each slot's switch keybind (1 / 2)
 *    shown
 *
 * Data sources (all existing runtime values, no mirrored state):
 *  - `activeWeapon` / `magazineSize` / `isReloading` / `reloadProgress` —
 *    the weapon controller's local state, reconciled from the authoritative
 *    server `weapon:state_update` event,
 *  - `magazineAmmo` — the authoritative replicated magazine ammo carried on
 *    the player state (the same value the legacy combat HUD displayed).
 *
 * This component is purely presentational: all values are supplied via
 * explicit props; it performs no networking, no runtime queries, and no
 * side effects beyond rendering.
 *
 * Example usage:
 * ```tsx
 * <WeaponHUD
 *   activeWeapon="assault_rifle"
 *   magazineAmmo={12}
 *   magazineSize={30}
 *   isReloading={true}
 *   reloadProgress={0.42}
 * />
 * ```
 */

import type { WeaponType } from "@buildshift/protocol";
import "./weapon-hud.css";

/**
 * The 1v1 loadout, in display order (slot 1 / slot 2). This is static UI
 * chrome for the slot indicator — the equipped weapon itself always comes
 * from the runtime's reconciled weapon state, never from this list.
 */
const LOADOUT: readonly WeaponType[] = ["assault_rifle", "shotgun"];

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
 * The weapon-switch keybind shown on each slot chip. Mirrors the weapon
 * switch keys bound in the InputManager (Digit1 → assault rifle,
 * Digit2 → shotgun) so the HUD never advertises a key that is not bound.
 */
const WEAPON_SLOT_KEYS: Record<WeaponType, string> = {
  assault_rifle: "1",
  shotgun: "2",
};

/**
 * Explicit props for the WeaponHUD.
 *
 * All values represent the **local player's** equipped-weapon state as
 * supplied by the runtime.
 */
export interface WeaponHUDProps {
  /** The local player's currently equipped (active) weapon. */
  activeWeapon: WeaponType;
  /** Rounds currently loaded in the active weapon's magazine (authoritative). */
  magazineAmmo: number;
  /** The active weapon's magazine capacity (reconciled). */
  magazineSize: number;
  /** `true` while the active weapon is in the middle of a reload. */
  isReloading: boolean;
  /**
   * Reload progress from 0 (reload just started) to 1 (reload complete).
   * Meaningful only while {@link isReloading} is `true`.
   */
  reloadProgress: number;
}

/** Clamp `value` into the inclusive range `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(value, max));
}

/** Floor a value into `[0, +∞)` as an integer (non-finite → 0). */
function floorNonNegative(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

/**
 * A presentation-only weapon HUD.
 *
 * Renders a fixed-position panel at the bottom-left of the viewport showing
 * the active weapon name, its `magazine / capacity` counter, a thin reload
 * progress bar (only while the active weapon is reloading), and a compact
 * slot indicator for the loadout with the equipped one highlighted.
 */
export function WeaponHUD(props: WeaponHUDProps): JSX.Element {
  const { activeWeapon, magazineAmmo, magazineSize, isReloading, reloadProgress } =
    props;

  const ammo = floorNonNegative(magazineAmmo);
  const capacity = floorNonNegative(magazineSize);
  const ammoEmpty = ammo <= 0;
  // Contextual reload prompt: only when the magazine is empty AND no reload
  // is already running (a running reload shows its own progress bar).
  const needsReload = ammoEmpty && !isReloading;

  const reloadFraction = clamp(reloadProgress, 0, 1);
  const reloadPercent = (reloadFraction * 100).toFixed(1);

  const weaponName = WEAPON_NAMES[activeWeapon] ?? activeWeapon;

  return (
    <div className="weapon-hud" aria-live="polite" aria-label="Weapon status">
      {/* ── Weapon-slot indicator (one chip per loadout weapon) ── */}
      <div className="weapon-hud__slots" role="list" aria-label="Weapon slots">
        {LOADOUT.map((weapon) => {
          const isActive = weapon === activeWeapon;
          const slotName = WEAPON_NAMES[weapon] ?? weapon;
          return (
            <div
              key={weapon}
              role="listitem"
              aria-current={isActive || undefined}
              aria-label={`${slotName} (key ${WEAPON_SLOT_KEYS[weapon]})`}
              className={`weapon-hud__slot ${
                isActive ? "weapon-hud__slot--active" : ""
              }`}
            >
              <span className="weapon-hud__slot-key" aria-hidden="true">
                {WEAPON_SLOT_KEYS[weapon]}
              </span>
              <span className="weapon-hud__slot-glyph" aria-hidden="true">
                {WEAPON_GLYPHS[weapon] ?? ""}
              </span>
              <span className="weapon-hud__slot-name">{slotName}</span>
            </div>
          );
        })}
      </div>

      {/* ── Active weapon: name + magazine counter ── */}
      <div className="weapon-hud__active">
        <span className="weapon-hud__name">{weaponName}</span>
        <span
          className={`weapon-hud__ammo ${
            ammoEmpty ? "weapon-hud__ammo--empty" : ""
          }`}
          aria-label={`${ammo} of ${capacity} rounds in the magazine`}
        >
          <span className="weapon-hud__ammo-magazine">{ammo}</span>
          <span className="weapon-hud__ammo-separator" aria-hidden="true">
            /
          </span>
          <span className="weapon-hud__ammo-capacity">{capacity}</span>
        </span>
      </div>

      {/* ── Contextual reload prompt (empty magazine, no reload running) ── */}
      {needsReload && (
        <div className="weapon-hud__reload-hint" role="status">
          Press <kbd>R</kbd> to reload
        </div>
      )}

      {/* ── Reload progress bar (only while the active weapon reloads) ── */}
      {isReloading && (
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
