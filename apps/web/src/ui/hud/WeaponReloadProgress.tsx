/**
 * WeaponReloadProgress — a presentation-only reload progress bar.
 *
 * Renders a thin horizontal progress bar that fills based on the
 * authoritative `progress` value (0 to 1). Should only be rendered
 * while the weapon is actively reloading (`active` is true); callers
 * that wish to conditionally show/hide the bar can gate on the
 * `active` prop.
 *
 * This is a pure presentational component: all values are supplied via
 * explicit props. No networking or game-runtime queries are performed.
 *
 * Example usage:
 * ```tsx
 * {isReloading && (
 *   <WeaponReloadProgress active progress={0.42} />
 * )}
 * ```
 */

/**
 * Explicit props for the {@link WeaponReloadProgress} bar.
 */
export interface WeaponReloadProgressProps {
  /**
   * Whether the reload is actively in progress. When `false` the
   * component renders nothing (returns null).
   */
  active: boolean;
  /**
   * Reload progress from 0 (just started) to 1 (complete).
   * Values outside this range are clamped defensively.
   */
  progress: number;
  /**
   * Optional extra CSS class appended to the root element.
   */
  className?: string;
}

/**
 * Clamp a value into the inclusive range [0, 1].
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * A presentation-only reload progress bar.
 *
 * Renders a `role="progressbar"` track with a fill whose width is set
 * as a percentage of the `progress` value. Returns `null` when
 * `active` is `false`.
 */
export function WeaponReloadProgress(
  props: WeaponReloadProgressProps,
): JSX.Element | null {
  const { active, progress, className } = props;

  if (!active) return null;

  const clamped = clamp01(progress);
  const percent = (clamped * 100).toFixed(1);
  const ariaNow = Math.round(clamped * 100);

  const rootClass = className
    ? `weapon-hud__reload-track ${className}`
    : "weapon-hud__reload-track";

  return (
    <div
      className={rootClass}
      role="progressbar"
      aria-valuenow={ariaNow}
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
