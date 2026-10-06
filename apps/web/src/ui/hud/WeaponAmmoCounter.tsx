/**
 * WeaponAmmoCounter — a presentation-only magazine/reserve ammunition
 * display.
 *
 * Renders the currently loaded rounds (`magazineAmmo`) as the primary,
 * bold count and the available reserve rounds (`reserveAmmo`) as a
 * secondary, smaller count, separated by a slash.
 *
 * Visual states:
 *  - **normal**   — magazine has rounds remaining
 *  - **low**      — magazine is empty but reserve still has rounds (amber)
 *  - **empty**    — both magazine and reserve are zero (red)
 *
 * This is a pure presentational component: all values are supplied via
 * explicit props. No networking or game-runtime queries are performed.
 *
 * Example usage:
 * ```tsx
 * <WeaponAmmoCounter magazineAmmo={12} reserveAmmo={48} />
 * // renders: "12 / 48"
 * ```
 */

/**
 * Explicit props for the {@link WeaponAmmoCounter}.
 */
export interface WeaponAmmoCounterProps {
  /** Rounds currently loaded in the magazine (>= 0). */
  magazineAmmo: number;
  /** Rounds available in the reserve (>= 0). */
  reserveAmmo: number;
  /**
   * Optional extra CSS class appended to the root element.
   */
  className?: string;
}

/**
 * A presentation-only ammunition counter.
 *
 * Renders `magazineAmmo / reserveAmmo` with tabular numerals. Applies
 * the `--low` modifier when the magazine is empty but reserve remains,
 * and the `--empty` modifier when both are zero.
 */
export function WeaponAmmoCounter(
  props: WeaponAmmoCounterProps,
): JSX.Element {
  const { magazineAmmo, reserveAmmo, className } = props;

  // Defensive: clamp to non-negative integers for display.
  const mag = Math.max(0, Math.round(magazineAmmo));
  const reserve = Math.max(0, Math.round(reserveAmmo));

  const ammoEmpty = mag <= 0;
  const fullyEmpty = ammoEmpty && reserve <= 0;

  const modifierClass = fullyEmpty
    ? "weapon-hud__ammo--empty"
    : ammoEmpty
      ? "weapon-hud__ammo--low"
      : "";
  const rootClass = className
    ? `weapon-hud__ammo ${modifierClass} ${className}`
    : `weapon-hud__ammo ${modifierClass}`.trim();

  return (
    <span
      className={rootClass}
      aria-label={`${mag} in magazine, ${reserve} in reserve`}
    >
      <span className="weapon-hud__ammo-magazine">{mag}</span>
      <span className="weapon-hud__ammo-separator" aria-hidden="true">
        /
      </span>
      <span className="weapon-hud__ammo-reserve">{reserve}</span>
    </span>
  );
}
