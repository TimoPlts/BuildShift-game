/**
 * Reconciliation — authoritative state reconciliation helpers for the
 * canonical multiplayer system.
 *
 * This module provides the pure functions that the GameRuntime uses to
 * reconcile authoritative server state with local presentation:
 *
 *  - `reconcileHealthDisplay`: updates the combat HUD from authoritative
 *    server events (not local damage calculation).
 *  - `shouldShowElimination`: determines whether the elimination overlay
 *    should be shown based on authoritative server state.
 *
 * The key principle: health, shield, ammo, and elimination state ALWAYS
 * come from the server's authoritative state, never from local damage
 * calculation. The local prediction orchestrator only optimistically
 * updates these between reconciliation cycles, and they are always
 * corrected by the authoritative server values.
 */
import type { PredictionOrchestrator } from "./predictionOrchestrator";
import type { HealthHud } from "../HealthHud";
import { MAX_HEALTH, MAX_SHIELD } from "@buildshift/game-config";

/**
 * The authoritative health/shield/ammo data from the server state that
 * drives the HUD display.
 */
export interface AuthoritativeCombatData {
  health: number;
  shield: number;
  ammo: number;
  isEliminated: boolean;
}

/**
 * Apply authoritative server combat data to the HUD display.
 *
 * This is the SINGLE place where the health display is updated. It always
 * uses the authoritative server values — never local damage calculation.
 *
 * @param hud The HealthHud to update.
 * @param data The authoritative combat data from the server.
 * @param orchestrator The prediction orchestrator (used to trigger the
 *        elimination overlay when the server confirms elimination).
 */
export function reconcileHealthDisplay(
  hud: HealthHud,
  data: AuthoritativeCombatData,
): void {
  hud.setHealth(data.health, MAX_HEALTH);
  hud.setShield(data.shield, MAX_SHIELD);
  hud.setAmmo(data.ammo);
  hud.setWeapon("Assault Rifle");

  if (data.isEliminated) {
    hud.showEliminationOverlay();
  }
}

/**
 * Determine whether the elimination overlay should be shown based on
 * the authoritative server state.
 */
export function shouldShowElimination(
  orchestrator: PredictionOrchestrator,
): boolean {
  return orchestrator.isEliminated;
}
