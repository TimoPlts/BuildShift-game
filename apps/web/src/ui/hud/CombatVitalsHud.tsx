/**
 * CombatVitalsHud — a presentation-only health + shield panel for the
 * BuildShift 1v1 Energy Box Fight game HUD.
 *
 * Displays the local player's authoritative health and shield as labelled
 * bars with numeric read-outs, plus a prominent "ELIMINATED" state while the
 * authoritative elimination flag is set.
 *
 * This component is purely presentational. All values are supplied via
 * explicit props (by the runtime through the canonical
 * App -> GameCanvas -> GameRuntime -> NetworkClient flow); the component
 * performs no networking, no runtime queries, and no side effects beyond
 * rendering.
 *
 * The panel visually mirrors the Energy / Weapon panels (same shape,
 * border, blur and colour language) so the bottom row of the HUD reads as
 * one cohesive surface.
 */

import "./game-hud.css";

/**
 * Explicit props for the combat vitals panel.
 *
 * All values represent the **local player's** vitals as supplied by the
 * runtime (authoritative, reconciled server values).
 */
export interface CombatVitalsHudProps {
  /** Current health (0..maxHealth). */
  health: number;
  /** Maximum health. */
  maxHealth: number;
  /** Current shield (0..maxShield). */
  shield: number;
  /** Maximum shield. */
  maxShield: number;
  /** Whether the local player is eliminated (authoritative). */
  eliminated: boolean;
}

/** Clamp `value` into the inclusive range `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(value, max));
}

/**
 * Map a health fraction [0, 1] to the fill colour class: green while
 * healthy, amber when low, red when critical.
 */
function healthFillClass(fraction: number): string {
  if (fraction > 0.5) {
    return "combat-vitals-hud__bar-fill--healthy";
  }
  if (fraction > 0.25) {
    return "combat-vitals-hud__bar-fill--low";
  }
  return "combat-vitals-hud__bar-fill--critical";
}

/**
 * A presentation-only combat vitals panel.
 *
 * Renders a fixed-position panel at the bottom-right of the viewport with a
 * health bar, a shield bar, and the elimination state.
 */
export function CombatVitalsHud(props: CombatVitalsHudProps): JSX.Element {
  const { health, maxHealth, shield, maxShield, eliminated } = props;

  const healthValue = clamp(health, 0, maxHealth);
  const shieldValue = clamp(shield, 0, maxShield);
  const healthFraction = maxHealth > 0 ? healthValue / maxHealth : 0;
  const shieldFraction = maxShield > 0 ? shieldValue / maxShield : 0;

  return (
    <div
      className={`combat-vitals-hud ${
        eliminated ? "combat-vitals-hud--eliminated" : ""
      }`}
      aria-label="Player vitals"
    >
      {/* ── Elimination state (authoritative) ── */}
      {eliminated && (
        <div
          className="combat-vitals-hud__eliminated"
          role="status"
          aria-live="assertive"
        >
          ELIMINATED
        </div>
      )}

      {/* ── Health ── */}
      <div className="combat-vitals-hud__row">
        <span className="combat-vitals-hud__label">HEALTH</span>
        <div
          className="combat-vitals-hud__track combat-vitals-hud__track--health"
          role="progressbar"
          aria-valuenow={Math.round(healthValue)}
          aria-valuemin={0}
          aria-valuemax={Math.round(maxHealth)}
          aria-label="Health"
        >
          <div
            className={`combat-vitals-hud__bar-fill ${healthFillClass(
              healthFraction,
            )}`}
            style={{ width: `${(healthFraction * 100).toFixed(1)}%` }}
          />
        </div>
        <span className="combat-vitals-hud__value">
          {Math.round(healthValue)}
          <span className="combat-vitals-hud__value-max" aria-hidden="true">
            {" "}
            / {Math.round(maxHealth)}
          </span>
        </span>
      </div>

      {/* ── Shield ── */}
      <div className="combat-vitals-hud__row">
        <span className="combat-vitals-hud__label">SHIELD</span>
        <div
          className="combat-vitals-hud__track combat-vitals-hud__track--shield"
          role="progressbar"
          aria-valuenow={Math.round(shieldValue)}
          aria-valuemin={0}
          aria-valuemax={Math.round(maxShield)}
          aria-label="Shield"
        >
          <div
            className="combat-vitals-hud__bar-fill combat-vitals-hud__bar-fill--shield"
            style={{ width: `${(shieldFraction * 100).toFixed(1)}%` }}
          />
        </div>
        <span className="combat-vitals-hud__value">
          {Math.round(shieldValue)}
          <span className="combat-vitals-hud__value-max" aria-hidden="true">
            {" "}
            / {Math.round(maxShield)}
          </span>
        </span>
      </div>
    </div>
  );
}
