/**
 * ReloadProgressBar — a presentation-only reload progress bar component.
 *
 * Renders a thin horizontal track with an inner fill whose width is driven by
 * a `progress` value in `[0, 1]`. Includes full ARIA progressbar semantics
 * so screen readers can announce the reload percentage.
 *
 * This component is purely presentational: it accepts an explicit numeric
 * progress value and renders a static DOM fragment. It performs no
 * networking, no game queries, and no side effects beyond rendering.
 *
 * The parent is responsible for conditional rendering (e.g. only mounting
 * this component while `isReloading` is `true`).
 *
 * Example usage:
 * ```tsx
 * {weapon.isReloading && (
 *   <ReloadProgressBar progress={weapon.reloadProgress} />
 * )}
 * ```
 */

import "./weapon-hud.css";

/** Explicit props for {@link ReloadProgressBar}. */
export interface ReloadProgressBarProps {
  /**
   * Reload progress from `0` (reload just started) to `1` (reload complete).
   * Values outside `[0, 1]` are clamped.
   */
  progress: number;
  /**
   * Optional accessible label override. Defaults to `"Reload in progress"`.
   */
  ariaLabel?: string;
}

/** Clamp `value` into the inclusive range `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Renders a thin reload progress bar with ARIA `progressbar` semantics.
 *
 * The fill width transitions over 120 ms (see `weapon-hud.css`) so successive
 * server updates produce a smooth visual interpolation without any local
 * animation loop.
 */
export function ReloadProgressBar(props: ReloadProgressBarProps): JSX.Element {
  const { progress, ariaLabel } = props;

  const fraction = clamp(progress, 0, 1);
  const percent = Math.round(fraction * 100);
  const widthPercent = (fraction * 100).toFixed(1);
  const label = ariaLabel ?? "Reload in progress";

  return (
    <div
      className="weapon-hud__reload-track"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className="weapon-hud__reload-fill"
        style={{ width: `${widthPercent}%` }}
      />
    </div>
  );
}
