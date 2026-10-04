/**
 * GameRuntime internal helpers — remote player rendering, HUD updates,
 * and disposal. Extracted from GameRuntime.ts to keep the main class file
 * within manageable size while preserving the same logic.
 */
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import { PLAYER_COLLIDER, PLAYER_COLLIDER_TOTAL_HEIGHT } from "@buildshift/game-config";
import type { NetworkClient } from "./network";
import type { LocalCombatState } from "./network";
import type { HealthHud } from "./network/HealthHud";
import { reconcileHealthDisplay } from "./network";
import type { MovementDebugHUD } from "../ui/MovementDebugHUD";
import type { PlayerController } from "./player/PlayerController";
import type { EnergyRuntimeConsumer } from "./energy";
import type { BuildingSystem } from "./building";
import type { WeaponController } from "./weapon";

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
  remoteMesh: AbstractMesh | null;
  remoteMarker: AbstractMesh | null;
  remoteMaterial: StandardMaterial | null;
  remoteMarkerMat: StandardMaterial | null;
}

export function disposeGameRuntimeResources(d: GameRuntimeDisposables): void {
  d.energyConsumer.dispose();
  d.buildingSystem.dispose();
  d.weaponController.dispose();
  d.networkClient.dispose();
  d.debugHud.dispose();
  d.combatHud.dispose();
  if (d.remoteMesh) d.remoteMesh.dispose();
  if (d.remoteMarker) d.remoteMarker.dispose();
  if (d.remoteMaterial) d.remoteMaterial.dispose();
  if (d.remoteMarkerMat) d.remoteMarkerMat.dispose();
  d.playerController.dispose();
  d.inputManager.dispose();
  d.cameraController.dispose();
}

export interface RemotePlayerVisuals {
  remoteMesh: AbstractMesh | null;
  remoteMaterial: StandardMaterial | null;
  remoteMarker: AbstractMesh | null;
  remoteMarkerMat: StandardMaterial | null;
}

export function ensureRemoteMesh(
  scene: Scene,
  visuals: RemotePlayerVisuals,
): void {
  if (visuals.remoteMesh) return;
  const mat = new StandardMaterial("remote-player-material", scene);
  mat.diffuseColor = new Color3(0.9, 0.25, 0.25);
  mat.emissiveColor = new Color3(0.05, 0.02, 0.15);
  const mesh = MeshBuilder.CreateCapsule("remote-player", {
    height: PLAYER_COLLIDER_TOTAL_HEIGHT,
    radius: PLAYER_COLLIDER.radius,
    tessellation: 16,
  }, scene);
  mesh.material = mat;
  const markerMat = new StandardMaterial("remote-player-marker", scene);
  markerMat.diffuseColor = new Color3(0.95, 0.95, 0.95);
  const marker = MeshBuilder.CreateBox("remote-player-marker", {
    width: 0.22, height: 0.08, depth: 0.06,
  }, scene);
  marker.material = markerMat;
  marker.parent = mesh;
  marker.position.set(0, 0.2, -0.35);
  visuals.remoteMesh = mesh;
  visuals.remoteMaterial = mat;
  visuals.remoteMarker = marker;
  visuals.remoteMarkerMat = markerMat;
}

export function updateRemotePlayersVisuals(
  visuals: RemotePlayerVisuals,
  pos: { x: number; y: number; z: number; yaw: number },
  wasEliminated: boolean,
  hitFlashFrames: number,
): number {
  if (!visuals.remoteMesh || !visuals.remoteMaterial) return hitFlashFrames;
  visuals.remoteMesh.position.set(pos.x, pos.y, pos.z);
  visuals.remoteMesh.rotation.y = pos.yaw;
  if (wasEliminated) {
    visuals.remoteMaterial.emissiveColor = new Color3(0.1, 0, 0);
    visuals.remoteMaterial.diffuseColor = new Color3(0.3, 0.1, 0.1);
  } else if (hitFlashFrames > 0) {
    visuals.remoteMaterial.emissiveColor = new Color3(1, 0.3, 0);
    return hitFlashFrames - 1;
  } else {
    visuals.remoteMaterial.emissiveColor = new Color3(0.05, 0.02, 0.15);
    visuals.remoteMaterial.diffuseColor = new Color3(0.9, 0.25, 0.25);
  }
  return hitFlashFrames;
}

export function setRemoteVisible(visuals: RemotePlayerVisuals, v: boolean): void {
  if (visuals.remoteMesh) visuals.remoteMesh.setEnabled(v);
  if (visuals.remoteMarker) visuals.remoteMarker.setEnabled(v);
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
