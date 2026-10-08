/**
 * GameRuntime internal helpers — HUD updates, and disposal. The remote
 * player's visuals are owned by the modular {@link PlayerPresentation}
 * component (created on demand by the runtime and disposed here).
 */
import type { HealthHud } from "./network/HealthHud";
import type { LocalCombatState } from "./network";
import type { NetworkClient } from "./network";
import { reconcileHealthDisplay } from "./network";
import type { MovementDebugHUD } from "../ui/MovementDebugHUD";
import type { PlayerController } from "./player/PlayerController";
import type { EnergyRuntimeConsumer } from "./energy";
import type { BuildingSystem } from "./building";
import type { WeaponController } from "./weapon";
import type { PlayerPresentation } from "./scene/PlayerPresentation";

export interface GameRuntimeDisposables {
  energyConsumer: EnergyRuntimeConsumer;
  buildingSystem: BuildingSystem;
  weaponController: WeaponController;
  networkClient: NetworkClient;
  debugHud: MovementDebugHUD;
  combatHud: HealthHud;
  playerController: PlayerController;
  inputManager: { dispose(): void };
  cameraController: { dispose(): void };
  /** The remote player's presentation component, once created. */
  remotePresentation: PlayerPresentation | null;
}

export function disposeGameRuntimeResources(d: GameRuntimeDisposables): void {
  d.energyConsumer.dispose();
  d.buildingSystem.dispose();
  d.weaponController.dispose();
  d.networkClient.dispose();
  d.debugHud.dispose();
  d.combatHud.dispose();
  // Self-cleaning presentation: releases every owned mesh and material.
  d.remotePresentation?.dispose();
  d.playerController.dispose();
  d.inputManager.dispose();
  d.cameraController.dispose();
}

export function updateCombatHudFn(
  combatHud: HealthHud,
  combatState: LocalCombatState,
): void {
  reconcileHealthDisplay(combatHud, {
    health: combatState.health,
    shield: combatState.shield,
    ammo: combatState.ammo,
    isEliminated: combatState.isEliminated,
  });
}

export function updateDebugHudFn(
  debugHud: MovementDebugHUD,
  localPos: { x: number; y: number; z: number },
  remoteState: { x: number; y: number; z: number } | null,
  sequence: number,
  lastCorrectionDistance: number | null,
): void {
  debugHud.state.localX = localPos.x;
  debugHud.state.localY = localPos.y;
  debugHud.state.localZ = localPos.z;
  if (remoteState) {
    debugHud.state.remoteX = remoteState.x;
    debugHud.state.remoteY = remoteState.y;
    debugHud.state.remoteZ = remoteState.z;
    debugHud.state.remotePresent = true;
  } else {
    debugHud.state.remotePresent = false;
  }
  debugHud.state.sequence = sequence;
  debugHud.state.lastCorrectionDistance = lastCorrectionDistance;
}
