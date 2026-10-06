/**
 * ReloadProgressBar — a presentation-only, composable HUD element that
 * renders a thin horizontal progress bar indicating reload progress for a
 * weapon that is currently reloading.
 *
 * This is a standalone sub-component extracted from the monolithic
 * {@link WeaponHUD} so that the NetworkClient (T3) or any parent layout can
 * place the reload indicator independently of the weapon name or ammo
 * counter.
 *
 * The bar fills from left to right as `progress` goes from 0 (reload just
 * started) to 1 (reload complete). The parent is responsible for
 * conditionally rendering this component (e.g. only when `isReloading` is
 * `true`); this component does not hide itself when `progress` is 0.
 *
 * Purely presentational: accepts the progress fraction via an explicit
 * prop, performs no networking, no runtime queries, and no side effects
 * beyond rendering.
 *
 * Example usage:
 * ```tsx
 * {isReloading && (
 *   <ReloadProgressBar progress={0.42} />
 *   // renders a track with the fill at 42% width
 * )}
 *
 * <ReloadProgressBar progress={1} className="my-custom" />
 * // renders: <div class="reload-progress-bar my-custom">
 * //           <div class="reload-progress-bar__fill" style="width: 100%" />
 * //         </div>
 * ```
 */

import "./weapon-hud.css";

/**
 * Explicit props for {@link ReloadProgressBar}.
 */
export interface ReloadProgressBarProps {
  /**
   * Reload progress as a fraction in the range `[0, 1]`.
   * - `0` — reload just started (empty bar).
   * - `1` — reload complete (full bar).
   *
   * Values outside `[0, 1]` are clamped for rendering.
   */
  progress: number;
  /**
   * Optional additional CSS class to apply to the track element.
   */
  className?: string;
}

/** Clamp `value` into the inclusive range `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * A presentation-only reload progress bar.
 *
 * Renders a `<div>` track with an inner `<div>` fill whose width is set
 * inline based on the `progress` prop. The track and fill styles (height,
 * colors, border-radius, transition) are defined in `weapon-hud.css` under
 * the `.reload-progress-bar` class family.
 *
 * The track has `role="progressbar"` and appropriate ARIA attributes
 * (`aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-label`) for
 * screen-reader accessibility.
 */
export function ReloadProgressBar(props: ReloadProgressBarProps): JSX.Element {
  const { progress, className } = props;

  const fraction = clamp(progress, 0, 1);
  const percent = fraction * 100;
  const percentStr = `${percent.toFixed(1)}%`;

  const combinedClass = className
    ? `reload-progress-bar ${className}`
    : "reload-progress-bar";

  return (
    <div
      className={combinedClass}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Reload in progress"
    >
      <div
        className="reload-progress-bar__fill"
        style={{ width: percentStr }}
      />
    </div>
  );
}
