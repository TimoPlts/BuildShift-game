/**
 * WeaponAmmoDisplay — a presentation-only ammo counter component.
 *
 * Shows the magazine count (primary, bold) and reserve count (secondary,
 * smaller) separated by a "/" glyph. Applies visual state classes based on
 * ammo levels:
 *
 *  - **normal** — magazine has rounds and reserve has rounds
 *  - **low**    — magazine is empty but reserve still has rounds (amber)
 *  - **empty**  — both magazine and reserve are zero (red)
 *
 * This component is purely presentational: it accepts explicit numeric props
 * and renders a static DOM fragment. It performs no networking, no game
 * queries, and no side effects beyond rendering.
 *
 * Example usage:
 * ```tsx
 * <WeaponAmmoDisplay magazineAmmo={12} reserveAmmo={48} />
 * <WeaponAmmoDisplay magazineAmmo={0} reserveAmmo={24} />
 * <WeaponAmmoDisplay magazineAmmo={0} reserveAmmo={0} />
 * ```
 */

import "./weapon-hud.css";

/** Explicit props for {@link WeaponAmmoDisplay}. */
export interface WeaponAmmoDisplayProps {
  /** Rounds currently loaded in the magazine (>= 0). */
  magazineAmmo: number;
  /** Rounds available in the reserve pool (>= 0). */
  reserveAmmo: number;
  /**
   * Optional accessible label override. Defaults to a generated label like
   * `"12 in magazine, 48 in reserve"`.
   */
  ariaLabel?: string;
}

/**
 * Renders a `magazineAmmo / reserveAmmo` counter with automatic visual state
 * (normal / low / empty).
 */
export function WeaponAmmoDisplay(props: WeaponAmmoDisplayProps): JSX.Element {
  const { magazineAmmo: rawMag, reserveAmmo: rawRes, ariaLabel } = props;

  // Guard against malformed inputs so counters never render negative values.
  const magazineAmmo = Math.max(0, Math.round(rawMag));
  const reserveAmmo = Math.max(0, Math.round(rawRes));

  const ammoEmpty = magazineAmmo <= 0;
  const fullyEmpty = ammoEmpty && reserveAmmo <= 0;

  const stateClass = fullyEmpty
    ? "weapon-hud__ammo--empty"
    : ammoEmpty
      ? "weapon-hud__ammo--low"
      : "";

  const label =
    ariaLabel ?? `${magazineAmmo} in magazine, ${reserveAmmo} in reserve`;

  return (
    <span
      className={`weapon-hud__ammo ${stateClass}`.trim()}
      aria-label={label}
    >
      <span className="weapon-hud__ammo-magazine">{magazineAmmo}</span>
      <span className="weapon-hud__ammo-separator" aria-hidden="true">
        /
      </span>
      <span className="weapon-hud__ammo-reserve">{reserveAmmo}</span>
    </span>
  );
}
