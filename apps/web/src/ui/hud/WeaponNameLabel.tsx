/**
 * WeaponNameLabel — a presentation-only, composable HUD element that renders
 * the authoritative weapon name for the currently equipped weapon.
 *
 * This is a standalone sub-component extracted from the monolithic
 * {@link WeaponHUD} so that the NetworkClient (T3) or any parent layout can
 * place the weapon name independently of the ammo counter or reload bar.
 *
 * Purely presentational: accepts the weapon type via an explicit prop,
 * performs no networking, no runtime queries, and no side effects beyond
 * rendering.
 *
 * Example usage:
 * ```tsx
 * <WeaponNameLabel weaponType="assault_rifle" />
 * // renders: <span class="weapon-name-label">Assault Rifle</span>
 *
 * <WeaponNameLabel weaponType="shotgun" className="my-custom-class" />
 * // renders: <span class="weapon-name-label my-custom-class">Shotgun</span>
 * ```
 */

import type { WeaponType } from "@buildshift/protocol";
import "./weapon-hud.css";

/** Human-readable display names for each weapon type. */
const WEAPON_DISPLAY_NAMES: Record<WeaponType, string> = {
  assault_rifle: "Assault Rifle",
  shotgun: "Shotgun",
};

/**
 * Explicit props for {@link WeaponNameLabel}.
 */
export interface WeaponNameLabelProps {
  /**
   * The authoritative weapon type the label should display.
   * The display name is derived from the protocol {@link WeaponType}
   * vocabulary; unknown values fall back to the raw string.
   */
  weaponType: WeaponType;
  /**
   * Optional additional CSS class to apply to the rendered element.
   * Useful when the parent layout needs to override positioning or
   * typography without duplicating the base styles.
   */
  className?: string;
}

/**
 * A presentation-only label showing the authoritative weapon name.
 *
 * Renders a single `<span>` with the human-readable weapon name. The font
 * styling (size, weight, letter-spacing, color) is defined in
 * `weapon-hud.css` under the `.weapon-name-label` class.
 */
export function WeaponNameLabel(props: WeaponNameLabelProps): JSX.Element {
  const { weaponType, className } = props;

  const displayName =
    WEAPON_DISPLAY_NAMES[weaponType] ?? weaponType;

  const combinedClass = className
    ? `weapon-name-label ${className}`
    : "weapon-name-label";

  return (
    <span className={combinedClass} aria-label={`Weapon: ${displayName}`}>
      {displayName}
    </span>
  );
}
