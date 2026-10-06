/**
 * WeaponName — a standalone, presentation-only label for the active weapon.
 *
 * Renders a small, uppercase, bold label with the weapon's human-readable
 * name. The name is looked up from the canonical {@link WeaponType} union.
 *
 * This component is purely presentational: it accepts the weapon type via an
 * explicit prop and performs no networking, no runtime queries, and no side
 * effects beyond rendering.
 *
 * Example usage:
 * ```tsx
 * <WeaponName weaponType="assault_rifle" />
 * ```
 */

import type { WeaponType } from "@buildshift/protocol";
import "./weapon-hud.css";

/** Human-readable display names for each weapon type. */
const WEAPON_NAMES: Record<WeaponType, string> = {
  assault_rifle: "Assault Rifle",
  shotgun: "Shotgun",
};

/**
 * Explicit props for the WeaponName label.
 */
export interface WeaponNameProps {
  /** The canonical weapon type to display. */
  weaponType: WeaponType;
}

/**
 * A compact, uppercase weapon name label.
 */
export function WeaponName(props: WeaponNameProps): JSX.Element {
  const { weaponType } = props;

  const name = WEAPON_NAMES[weaponType] ?? weaponType;

  return <span className="weapon-hud__name">{name}</span>;
}
