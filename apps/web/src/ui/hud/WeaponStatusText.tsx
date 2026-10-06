/**
 * WeaponStatusText — a small, presentation-only HUD element that renders a
 * concise, human-readable descriptor of the local player's *authoritative*
 * weapon state.
 *
 * It presents the three authoritative signal groups the weapon HUD cares
 * about as a single accessible text line:
 *  - the magazine / reserve ammunition counts (e.g. "0 / 48"),
 *  - reload progress as a percentage while the active weapon is reloading,
 *  - the overall readiness state (Ready / Reloading / Magazine empty /
 *    Out of ammo).
 *
 * This component is deliberately **purely presentational**:
 *  - it is driven exclusively by explicit props,
 *  - it performs no networking and no runtime/state queries,
 *  - it carries no game authority and no input handling,
 *  - it is not a BoxFight-specific screen — it renders from whatever
 *    authoritative values the caller (the runtime / a parent HUD) supplies.
 *
 * The caller is responsible for reading the authoritative
 * {@link WeaponAmmoState} from the runtime and mapping it into these props.
 *
 * The status wording itself is produced by the pure, exported
 * {@link describeWeaponStatus} helper so it can be unit-tested without
 * rendering.
 *
 * Example usage:
 * ```tsx
 * <WeaponStatusText
 *   magazineAmmo={0}
 *   reserveAmmo={48}
 *   isReloading={true}
 *   reloadProgress={0.42}
 * />
 * // → "Reloading… 42% (0 / 48)"
 * ```
 */

import "./weapon-status.css";

/**
 * Explicit, presentation-only props for {@link WeaponStatusText}.
 *
 * All values represent the **local player's** authoritative active-weapon
 * state as supplied by the runtime.
 */
export interface WeaponStatusTextProps {
  /** Rounds currently loaded in the active weapon's magazine (>= 0). */
  magazineAmmo: number;
  /** Rounds available in the reserve to reload the magazine (>= 0). */
  reserveAmmo: number;
  /** `true` while the active weapon is in the middle of a reload. */
  isReloading: boolean;
  /**
   * Reload progress from 0 (reload just started) to 1 (reload complete).
   * Meaningful only while {@link isReloading} is `true`.
   */
  reloadProgress: number;
}

/** Clamp `value` into the inclusive range `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Compute a concise, human-readable descriptor of an authoritative weapon
 * state. Pure and side-effect free so it can be tested in isolation.
 *
 * The result always ends with the `magazine / reserve` count, and prefixes it
 * with a state word:
 *  - `"Reloading… NN%"`   while {@link isReloading} is `true`,
 *  - `"Out of ammo"`      when the magazine AND reserve are both empty,
 *  - `"Magazine empty"`   when only the magazine is empty (reserve remains),
 *  - `"Ready"`            otherwise.
 *
 * @example
 * describeWeaponStatus({ magazineAmmo: 0, reserveAmmo: 48, isReloading: true, reloadProgress: 0.42 })
 * // → "Reloading… 42% (0 / 48)"
 */
export function describeWeaponStatus(
  props: WeaponStatusTextProps,
): string {
  const magazine = Math.max(0, Math.round(props.magazineAmmo));
  const reserve = Math.max(0, Math.round(props.reserveAmmo));
  const ammo = `${magazine} / ${reserve}`;

  if (props.isReloading) {
    const fraction = clamp(props.reloadProgress, 0, 1);
    const percent = Math.round(fraction * 100);
    return `Reloading… ${percent}% (${ammo})`;
  }

  if (magazine <= 0 && reserve <= 0) {
    return `Out of ammo (${ammo})`;
  }

  if (magazine <= 0) {
    return `Magazine empty (${ammo})`;
  }

  return `Ready (${ammo})`;
}

/**
 * A presentation-only, single-line authoritative weapon status readout.
 *
 * Renders an accessible `status` element whose text is produced by
 * {@link describeWeaponStatus}. It uses `aria-live="polite"` so screen readers
 * announce meaningful state changes (e.g. a reload starting) without being
 * noisy on every frame.
 */
export function WeaponStatusText(props: WeaponStatusTextProps): JSX.Element {
  const status = describeWeaponStatus(props);

  return (
    <span className="weapon-status" role="status" aria-live="polite">
      {status}
    </span>
  );
}
