/**
 * AmmoCounter — a presentation-only, composable HUD element that renders
 * the authoritative magazine/reserve ammunition counts for a weapon.
 *
 * This is a standalone sub-component extracted from the monolithic
 * {@link WeaponHUD} so that the NetworkClient (T3) or any parent layout can
 * place the ammo display independently of the weapon name or reload bar.
 *
 * Visual states:
 *  - **normal** — magazine has rounds (default styling).
 *  - **low** — magazine is empty but reserve still has rounds (magazine
 *    count turns amber/warning).
 *  - **empty** — both magazine and reserve are 0 (all counts turn red to
 *    signal "out of ammo").
 *
 * Purely presentational: accepts numeric ammo values via explicit props,
 * performs no networking, no runtime queries, and no side effects beyond
 * rendering.
 *
 * Example usage:
 * ```tsx
 * <AmmoCounter magazineAmmo={12} reserveAmmo={48} />
 * // renders: 12 / 48
 *
 * <AmmoCounter magazineAmmo={0} reserveAmmo={48} />
 * // renders: 0 / 48  (magazine in amber)
 *
 * <AmmoCounter magazineAmmo={0} reserveAmmo={0} />
 * // renders: 0 / 0   (all in red)
 *
 * <AmmoCounter magazineAmmo={3} reserveAmmo={27} className="my-custom" />
 * // renders: <span class="ammo-counter my-custom">3 / 27</span>
 * ```
 */

import "./weapon-hud.css";

/**
 * Explicit props for {@link AmmoCounter}.
 */
export interface AmmoCounterProps {
  /**
   * Rounds currently loaded in the weapon's magazine.
   * Should be >= 0; negative values are clamped to 0 for rendering.
   */
  magazineAmmo: number;
  /**
   * Rounds available in the reserve pool to reload the magazine.
   * Should be >= 0; negative values are clamped to 0 for rendering.
   */
  reserveAmmo: number;
  /**
   * Optional additional CSS class to apply to the rendered element.
   */
  className?: string;
}

/**
 * Derive the visual state class modifier from the ammo values.
 *
 * - `empty` when both magazine and reserve are 0.
 * - `low` when magazine is 0 but reserve > 0.
 * - no modifier (normal) otherwise.
 */
function ammoStateClass(
  magazineAmmo: number,
  reserveAmmo: number,
): string {
  const mag = Math.max(0, Math.round(magazineAmmo));
  const res = Math.max(0, Math.round(reserveAmmo));

  if (mag <= 0 && res <= 0) return "ammo-counter--empty";
  if (mag <= 0) return "ammo-counter--low";
  return "";
}

/**
 * A presentation-only ammunition counter displaying
 * `magazineAmmo / reserveAmmo`.
 *
 * Renders a single `<span>` containing three sub-spans (magazine count,
 * separator, reserve count). The font styling and color states are defined
 * in `weapon-hud.css` under the `.ammo-counter` class family.
 */
export function AmmoCounter(props: AmmoCounterProps): JSX.Element {
  const { magazineAmmo, reserveAmmo, className } = props;

  const mag = Math.max(0, Math.round(magazineAmmo));
  const res = Math.max(0, Math.round(reserveAmmo));
  const stateModifier = ammoStateClass(mag, res);

  const combinedClass = [
    "ammo-counter",
    stateModifier,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={combinedClass}
      aria-label={`${mag} in magazine, ${res} in reserve`}
    >
      <span className="ammo-counter__magazine">{mag}</span>
      <span className="ammo-counter__separator" aria-hidden="true">
        /
      </span>
      <span className="ammo-counter__reserve">{res}</span>
    </span>
  );
}
