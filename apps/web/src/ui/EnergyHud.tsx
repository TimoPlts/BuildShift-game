/**
 * EnergyHud — a presentation-only HUD overlay for the BuildShift Energy
 * economy.
 *
 * Displays the local player's current energy as a horizontal bar with a
 * numeric readout. The bar fill color shifts from cyan (healthy) through
 * amber (low) to red (critical) as the energy depletes, giving the player
 * an at-a-glance sense of their remaining build budget.
 *
 * This component is purely presentational. All data is supplied via
 * explicit props; the component performs no networking, no runtime
 * queries, and no side effects beyond rendering.
 *
 * The caller (e.g. GameCanvas) is responsible for reading the
 * authoritative energy value from the runtime and passing it here.
 *
 * Example usage:
 * ```tsx
 * <EnergyHud currentEnergy={72} maxEnergy={100} />
 * ```
 */

import "../energy-hud.css";

/**
 * Explicit props for the Energy HUD.
 *
 * All values represent the **local player's** energy state as supplied by
 * the runtime.
 */
export interface EnergyHudProps {
  /** The player's current energy in points (>= 0). */
  currentEnergy: number;
  /** The maximum energy the player can hold (> 0). */
  maxEnergy: number;
}

/**
 * A presentation-only Energy HUD overlay.
 *
 * Renders a fixed-position overlay at the bottom-left of the viewport
 * showing the player's energy as a coloured bar and a numeric readout.
 */
export function EnergyHud(props: EnergyHudProps): JSX.Element {
  const { currentEnergy, maxEnergy } = props;

  const clamped = Math.max(0, Math.min(currentEnergy, maxEnergy));
  const fraction = maxEnergy > 0 ? clamped / maxEnergy : 0;
  const percent = (fraction * 100).toFixed(1);

  // Determine the fill colour class based on the energy fraction.
  const fillClass =
    fraction > 0.5
      ? "energy-hud__bar-fill--healthy"
      : fraction > 0.25
        ? "energy-hud__bar-fill--low"
        : "energy-hud__bar-fill--critical";

  // Mirror the bar state on the numeric read-out so the value is readable
  // at a glance even when the eye is not on the bar itself.
  const valueClass =
    fraction > 0.5
      ? ""
      : fraction > 0.25
        ? "energy-hud__value--low"
        : "energy-hud__value--critical";

  return (
    <div className="energy-hud" aria-live="polite">
      <div className="energy-hud__top-row">
        <span className="energy-hud__label" aria-hidden="true">
          ⚡ ENERGY
        </span>
        <span className={`energy-hud__value ${valueClass}`}>
          {Math.round(clamped)} / {Math.round(maxEnergy)}
        </span>
      </div>
      <div
        className="energy-hud__bar-track"
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={Math.round(maxEnergy)}
        aria-label="Player energy"
      >
        <div
          className={`energy-hud__bar-fill ${fillClass}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
