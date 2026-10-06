/**
 * WeaponReloadBar — a standalone, presentation-only reload progress indicator.
 *
 * Renders a thin horizontal bar that fills from 0 → 100 % based on the
 * `progress` prop. Intended to be shown while a weapon is reloading; the
 * caller is responsible for conditionally rendering it only during a reload.
 *
 * This component is purely presentational: it accepts a single `progress`
 * value (0–1) via an explicit prop and performs no networking, no runtime
 * queries, and no side effects beyond rendering.
 *
 * Example usage:
 * ```tsx
 * <WeaponReloadBar progress={0.42} />
 * ```
 */

import "./weapon-hud.css";

/** Clamp `value` into the inclusive range `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Explicit props for the WeaponReloadBar.
 */
export interface WeaponReloadBarProps {
  /**
   * Reload progress from 0 (reload just started) to 1 (reload complete).
   * Values outside `[0, 1]` are clamped.
   */
  progress: number;
}

/**
 * A thin horizontal progress bar indicating weapon reload progress.
 *
 * Uses the `progressbar` ARIA role with appropriate `aria-valuenow` /
 * `aria-valuemin` / `aria-valuemax` for screen-reader accessibility.
 */
export function WeaponReloadBar(props: WeaponReloadBarProps): JSX.Element {
  const { progress } = props;

  const fraction = clamp(progress, 0, 1);
  const percent = (fraction * 100).toFixed(1);
  const now = Math.round(fraction * 100);

  return (
    <div
      className="weapon-hud__reload-track"
      role="progressbar"
      aria-valuenow={now}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Reload in progress"
    >
      <div
        className="weapon-hud__reload-fill"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
