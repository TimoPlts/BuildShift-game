/**
 * WeaponAmmoCounter — a standalone, presentation-only magazine / reserve
 * ammo display.
 *
 * Renders the magazine count (bold, primary) and reserve count (smaller,
 * secondary) separated by a slash. The colour shifts based on the ammo
 * state:
 *  - **normal** — magazine has rounds and reserve may or may not
 *  - **low**    — magazine is empty but reserve still has rounds (amber)
 *  - **empty**  — both magazine and reserve are zero (red)
 *
 * This component is purely presentational: all values are supplied via
 * explicit props; it performs no networking, no runtime queries, and no
 * side effects beyond rendering.
 *
 * Example usage:
 * ```tsx
 * <WeaponAmmoCounter magazineAmmo={12} reserveAmmo={48} />
 * ```
 */

import "./weapon-hud.css";

/**
 * Explicit props for the WeaponAmmoCounter.
 */
export interface WeaponAmmoCounterProps {
  /** Rounds currently loaded in the magazine (>= 0). */
  magazineAmmo: number;
  /** Rounds available in the reserve (>= 0). */
  reserveAmmo: number;
}

/**
 * A compact "magazine / reserve" ammo readout with state-based colouring.
 */
export function WeaponAmmoCounter(props: WeaponAmmoCounterProps): JSX.Element {
  const { magazineAmmo, reserveAmmo } = props;

  // Guard against malformed inputs so the counters never render negative
  // values.
  const mag = Math.max(0, Math.round(magazineAmmo));
  const reserve = Math.max(0, Math.round(reserveAmmo));
  const ammoEmpty = mag <= 0;
  const fullyEmpty = ammoEmpty && reserve <= 0;

  const stateClass = fullyEmpty
    ? "weapon-hud__ammo--empty"
    : ammoEmpty
      ? "weapon-hud__ammo--low"
      : "";

  return (
    <span
      className={`weapon-hud__ammo ${stateClass}`.trim()}
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
