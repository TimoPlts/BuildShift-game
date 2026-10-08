/**
 * GameHud — the cohesive in-game HUD for the BuildShift 1v1 Energy Box
 * Fight match.
 *
 * Composes the presentation-only HUD panels into one shared, full-viewport
 * layer (`.game-hud`) with a single visual language:
 *
 *  - **MatchHud** (top-center) — round score, authoritative round timer,
 *    round/phase, waiting-for-opponent and pre-round countdown, plus the
 *    round/match outcome banners.
 *  - **EnergyHud** (bottom-left, upper) — the mirrored authoritative energy.
 *  - **WeaponHUD** (bottom-left, lower) — equipped weapon, magazine rounds,
 *    reload progress and the loadout slot indicator.
 *  - **CombatVitalsHud** (bottom-right) — health, shield, elimination state.
 *  - **BuildHud** (bottom-center) — build mode, selected build piece,
 *    placement validity.
 *
 * This component is purely presentational. It receives:
 *  - `match` — the authoritative match-lifecycle props (mapped from the
 *    parsed match state by the caller), and
 *  - `local` — the flat local HUD view produced by the runtime from its
 *    existing authoritative / predicted sources.
 *
 * It performs no networking, no runtime queries, and no side effects beyond
 * rendering. The authoritative round timer (carried on `local`) is folded
 * into the match header here, keeping the timer source and its display in
 * one place.
 */

import { MatchHud, type MatchHudProps } from "../MatchHud";
import { EnergyHud } from "../EnergyHud";
import { BuildHud } from "../BuildHud";
import { WeaponHUD } from "./WeaponHud";
import { CombatVitalsHud } from "./CombatVitalsHud";
import { BuildEditHud } from "./BuildEditHud";
import type { LocalHudView } from "../../game/localHudView";
import "./game-hud.css";

/**
 * Explicit props for the cohesive game HUD.
 *
 * Both inputs are optional so the HUD degrades gracefully while the runtime
 * is still priming its first authoritative values.
 */
export interface GameHudProps {
  /**
   * The authoritative match-lifecycle props for the top-center match header
   * (score, phase, round, countdown, banners). `null` before the first
   * authoritative match state arrives.
   */
  match: MatchHudProps | null;
  /**
   * The runtime's flat local HUD view (vitals, energy, weapon, build state,
   * round timer). `null` before the first snapshot is produced.
   */
  local: LocalHudView | null;
}

/**
 * The cohesive in-game HUD overlay.
 *
 * Renders nothing until at least one of the two data sources is available;
 * each panel renders as soon as its own data exists.
 */
export function GameHud(props: GameHudProps): JSX.Element | null {
  const { match, local } = props;

  if (match === null && local === null) {
    return null;
  }

  // The authoritative round timer travels on the local view; fold it into
  // the match header so the timer source and its display live in one place.
  const roundTimer = local?.roundTimer ?? null;

  return (
    <div className="game-hud">
      {/* ── Match header (top-center) with the authoritative round timer ── */}
      {match !== null && (
        <MatchHud
          {...match}
          roundTimerRemainingMs={roundTimer?.remainingMs}
          roundTimerTotalMs={roundTimer?.totalMs}
        />
      )}

      {/* ── Player panels (only once the first local snapshot exists) ── */}
      {local !== null && (
        <>
          <EnergyHud
            currentEnergy={local.energy}
            maxEnergy={local.maxEnergy}
          />
          <WeaponHUD
            activeWeapon={local.weaponType}
            magazineAmmo={local.magazineAmmo}
            magazineSize={local.magazineSize}
            isReloading={local.isReloading}
            reloadProgress={local.reloadProgress}
          />
          <CombatVitalsHud
            health={local.health}
            maxHealth={local.maxHealth}
            shield={local.shield}
            maxShield={local.maxShield}
            eliminated={local.eliminated}
          />
          <BuildHud
            inBuildMode={local.buildMode}
            selectedBuildType={local.selectedBuildType}
            placementValid={local.placementValid}
            gridPosition={local.gridPosition}
          />
          <BuildEditHud
            mode={local.buildEdit.mode}
            target={local.buildEdit.target}
            selectedEdit={local.buildEdit.selectedEdit}
            allowedEdits={local.buildEdit.allowedEdits}
            feedback={local.buildEdit.feedback}
          />
        </>
      )}
    </div>
  );
}
