/**
 * GameHud — the cohesive in-game HUD for the BuildShift 1v1 Energy Box
 * Fight match.
 *
 * Composes the presentation-only HUD panels into one shared, full-viewport
 * layer (`.game-hud`) with a single visual language:
 *
 *  - **MatchHud** (top-center) — round score, round/phase and the
 *    waiting-for-opponent indicator, plus the round/match outcome banners.
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
 * rendering. This container deliberately drops the round-timer field that
 * still rides on the local view: a fight is untimed (a round ends on
 * elimination), so a stale/legacy timer value is never folded into the header.
 * The only clock in the game — the build-preparation countdown — is presented
 * by the App-level `PreparationBanner`.
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
   * The runtime's flat local HUD view (vitals, energy, weapon, build state).
   * `null` before the first snapshot is produced. Its legacy round-timer
   * field is ignored by this container.
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

  // No round timer is folded into the header: an in-progress fight is untimed,
  // so `local.roundTimer` (a legacy field) is intentionally never displayed.

  return (
    <div className="game-hud">
      {/* ── Match header (top-center): score, round/phase, no clock ── */}
      {match !== null && <MatchHud {...match} />}

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
            removedTiles={local.buildEdit.removedTiles}
            totalTiles={local.buildEdit.totalTiles}
            rampVariant={local.buildEdit.rampVariant}
            feedback={local.buildEdit.feedback}
            applyReady={local.buildEdit.applyReady}
            unconfirmed={local.buildEdit.unconfirmed}
            invalidReason={local.buildEdit.invalidReason}
          />
        </>
      )}
    </div>
  );
}
