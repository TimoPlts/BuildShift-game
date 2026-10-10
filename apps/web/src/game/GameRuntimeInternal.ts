/**
 * GameRuntime internal helpers — HUD updates, and disposal. The remote
 * player's visuals are owned by the modular {@link PlayerPresentation}
 * component (created on demand by the runtime and disposed here).
 */
import type { NetworkClient } from "./network";
import type { MovementDebugHUD } from "../ui/MovementDebugHUD";
import type { PlayerController } from "./player/PlayerController";
import type { EnergyRuntimeConsumer } from "./energy";
import type { BuildingSystem } from "./building";
import type { BuildEditSystem } from "./buildEdit";
import type { WeaponController } from "./weapon";
import type { PlayerPresentation } from "./scene/PlayerPresentation";

export interface GameRuntimeDisposables {
  energyConsumer: EnergyRuntimeConsumer;
  buildingSystem: BuildingSystem;
  buildEditSystem: BuildEditSystem;
  weaponController: WeaponController;
  networkClient: NetworkClient;
  debugHud: MovementDebugHUD;
  playerController: PlayerController;
  inputManager: { dispose(): void };
  cameraController: { dispose(): void };
  /** The remote player's presentation component, once created. */
  remotePresentation: PlayerPresentation | null;
}

export function disposeGameRuntimeResources(d: GameRuntimeDisposables): void {
  d.energyConsumer.dispose();
  d.buildingSystem.dispose();
  d.buildEditSystem.dispose();
  d.weaponController.dispose();
  d.networkClient.dispose();
  d.debugHud.dispose();
  // Self-cleaning presentation: releases every owned mesh and material.
  d.remotePresentation?.dispose();
  d.playerController.dispose();
  d.inputManager.dispose();
  d.cameraController.dispose();
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
