/**
 * WeaponName — a presentation-only label for the authoritative weapon name.
 *
 * Renders a small uppercase label with the display name of the currently
 * active weapon. This is a pure presentational component: the weapon type
 * is supplied via an explicit prop and no networking or game-runtime query
 * is performed.
 *
 * Example usage:
 * ```tsx
 * <WeaponName weaponType="assault_rifle" />
 * // renders: "ASSAULT RIFLE"
 * ```
 */

import type { WeaponType } from "@buildshift/protocol";

/**
 * Explicit props for the {@link WeaponName} label.
 */
export interface WeaponNameProps {
  /** The authoritative weapon type to display. */
  weaponType: WeaponType;
  /**
   * Optional extra CSS class appended to the root element.
   * Useful for callers that need to adjust styling context.
   */
  className?: string;
}

/** Human-readable display names for each canonical weapon type. */
const WEAPON_DISPLAY_NAMES: Record<WeaponType, string> = {
  assault_rifle: "Assault Rifle",
  shotgun: "Shotgun",
};

/**
 * A presentation-only weapon name label.
 *
 * Renders the active weapon's display name in an uppercase, bold, small
 * font suitable for HUD overlays. Falls back to the raw weapon-type
 * string if an unrecognised value is passed (defensive).
 */
export function WeaponName(props: WeaponNameProps): JSX.Element {
  const { weaponType, className } = props;

  const displayName = WEAPON_DISPLAY_NAMES[weaponType] ?? weaponType;
  const rootClass = className ? `weapon-hud__name ${className}` : "weapon-hud__name";

  return (
    <span className={rootClass}>{displayName}</span>
  );
}
