import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { PHYSICS_TIMING } from "@buildshift/game-config";
import type { HitResultEvent, PlayerEliminatedEvent } from "@buildshift/protocol";
import { ThirdPersonCameraController } from "./camera/ThirdPersonCameraController";
import { InputManager } from "./input/InputManager";
import { AimController } from "./aim/AimController";
import { PlayerController } from "./player/PlayerController";
import { createFoundationScene } from "./scene/createFoundationScene";
import { HealthHud } from "./HealthHud";
import type { SubstepInput } from "./player/substepInput";
import {
  createGameNetworking,
  COMBAT_HIT_EVENT,
  COMBAT_ELIMINATED_EVENT,
  SIMULATION_TICK_SECONDS,
  reconcileHealthDisplay,
  type ParsedRoomState,
  type InputSample,
} from "./network";
import { MovementDebugHUD } from "../ui/MovementDebugHUD";

const FIXED_DT = PHYSICS_TIMING.fixedStepDurationSeconds;
const MAX_FRAME_DELTA = 0.1;
const MAX_STEPS = 8;
const MAX_2P_TICKS = 4;
const NEUTRAL: Readonly<SubstepInput> = { moveX: 0, moveZ: 0, lookYaw: 0, jumpPressed: false };

export class GameRuntime {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly inputManager: InputManager;
  private readonly cameraController: ThirdPersonCameraController;
  private readonly playerController: PlayerController;
  private readonly renderFrame: () => void;
  private readonly resizeEngine: () => void;
  private accumulator = 0;
  private started = false;
  private disposed = false;
  private readonly aimController = new AimController();
  public readonly currentAimDirection = new Vector3(0, 0, -1);
  private readonly networkClient;
  private readonly inputBatcher;
  private readonly predictionOrchestrator;
  private readonly remoteInterpolation;
  private readonly debugHud: MovementDebugHUD;
  private readonly combatHud: HealthHud;
  private twoPlayerAccumulator = 0;
  private twoPlayerConnected = false;
  private hudCleanup: (() => void) | null = null;
  private combatHudCleanup: (() => void) | null = null;
  private unsubscribeState: (() => void) | null = null;
  private unsubscribeConnection: (() => void) | null = null;
  private unsubscribeHitEvent: (() => void) | null = null;
  private unsubscribeEliminatedEvent: (() => void) | null = null;
  private remoteMesh: AbstractMesh | null = null;
  private remoteMaterial: StandardMaterial | null = null;
  private remoteMarker: AbstractMesh | null = null;
  private remoteMarkerMat: StandardMaterial | null = null;
  private remoteWasEliminated = false;
  private remoteHitFlashFrames = 0;

  public static async create(canvas: HTMLCanvasElement): Promise<GameRuntime> {
    const engine = new Engine(canvas, true);
    try {
      const scene = createFoundationScene(engine);
      const inputManager = new InputManager(canvas);
      let cam: ThirdPersonCameraController | undefined;
      try {
        cam = new ThirdPersonCameraController(scene);
        const pc = await PlayerController.create(scene);
        return new GameRuntime(engine, scene, inputManager, cam, pc, canvas);
      } catch (e) { cam?.dispose(); inputManager.dispose(); scene.dispose(); throw e; }
    } catch (e) { engine.dispose(); throw e; }
  }

  private constructor(engine: Engine, scene: Scene, inputManager: InputManager, cameraController: ThirdPersonCameraController, playerController: PlayerController, canvas: HTMLCanvasElement) {
    this.engine = engine; this.scene = scene; this.inputManager = inputManager;
    this.cameraController = cameraController; this.playerController = playerController;
    const networking = createGameNetworking();
    this.networkClient = networking.client;
    this.inputBatcher = networking.inputBatcher;
    this.predictionOrchestrator = networking.predictionOrchestrator;
    this.remoteInterpolation = networking.remotePlayerManager;
    this.debugHud = new MovementDebugHUD(canvas); this.combatHud = new HealthHud();
    this.unsubscribeState = this.networkClient.onStateChange((state) => this.handleNetworkState(state));
    this.unsubscribeConnection = this.networkClient.onConnectionChange((connected) => {
      this.twoPlayerConnected = connected;
      if (connected) { this.predictionOrchestrator.reset(); this.inputBatcher.reset(); this.remoteInterpolation.reset(); this.remoteWasEliminated = false; }
      this.debugHud.state.connectionState = connected ? "connected" : "disconnected";
    });
    this.unsubscribeHitEvent = this.networkClient.onEvent(COMBAT_HIT_EVENT, (p) => this.handleHitEvent(p as HitResultEvent));
    this.unsubscribeEliminatedEvent = this.networkClient.onEvent(COMBAT_ELIMINATED_EVENT, (p) => this.handleEliminatedEvent(p as PlayerEliminatedEvent));
    this.renderFrame = () => {
      if (!this.scene.isDisposed) {
        const ld = this.inputManager.consumeLookDelta();
        this.cameraController.applyLook(ld.x, ld.y);
        const dt = Math.min(Math.max(this.engine.getDeltaTime() / 1000, 0), MAX_FRAME_DELTA);
        if (this.twoPlayerConnected) {
          this.twoPlayerAccumulator += dt;
          let t = 0;
          while (this.twoPlayerAccumulator >= SIMULATION_TICK_SECONDS && t < MAX_2P_TICKS) {
            this.stepSimulationTick(); this.twoPlayerAccumulator -= SIMULATION_TICK_SECONDS; t++;
          }
          if (t >= MAX_2P_TICKS) this.twoPlayerAccumulator = 0;
        } else {
          this.accumulator += dt; let s = 0;
          while (this.accumulator >= FIXED_DT && s < MAX_STEPS) {
            this.playerController.update(FIXED_DT, NEUTRAL); this.accumulator -= FIXED_DT; s++;
          }
          if (s >= MAX_STEPS) this.accumulator = 0;
        }
        if (this.twoPlayerConnected) { this.updateRemotePlayers(); this.updateCombatHud(); }
        this.cameraController.update(this.playerController.getFeetPosition());
        this.aimController.getAimDirection(this.cameraController.getCamera(), this.currentAimDirection);
        this.updateDebugHud();
        this.scene.render();
      }
    };
    this.resizeEngine = () => { this.engine.resize(); };
  }

  private stepSimulationTick(): void {
    const m = this.inputManager.getMovementInput();
    const fireIntent = this.inputManager.isFiring();
    const seq = this.inputBatcher.nextSequence;
    const sample: InputSample = { moveX: m.x, moveZ: m.z, yaw: this.cameraController.getYaw(), pitch: this.cameraController.getPitch(), jump: this.inputManager.pollJumpPressed(), crouch: false, primaryFire: fireIntent };
    const predicted = this.predictionOrchestrator.predict({ moveX: sample.moveX, moveZ: sample.moveZ, yaw: sample.yaw, pitch: sample.pitch, jump: sample.jump, crouch: false });
    this.predictionOrchestrator.predictFire(seq, fireIntent);
    this.inputBatcher.send(sample, this.networkClient, { x: predicted.x, y: predicted.y, z: predicted.z, velocityY: predicted.velocityY, grounded: predicted.grounded });
    this.playerController.setMeshTransform({ x: predicted.x, y: predicted.y, z: predicted.z }, predicted.yaw);
  }

  private handleNetworkState(state: ParsedRoomState): void {
    const sid = this.networkClient.sessionId;
    if (!sid) return;
    const pids = Object.keys(state.players);
    const local = state.players[sid];
    if (local) {
      this.predictionOrchestrator.onServerState({ x: local.x, y: local.y, z: local.z, yaw: local.yaw, velocityY: local.vy, grounded: local.vy === 0, sequence: local.sequence, health: local.health, shield: local.shield, energy: local.energy, ammo: local.ammo, lastFireSequence: local.lastFireSequence, isEliminated: local.isEliminated }, this.inputBatcher.getInputsAfter(local.sequence));
      this.inputBatcher.pruneUpTo(local.sequence);
    }
    for (const pid of pids) {
      if (pid === sid) continue;
      const r = state.players[pid];
      if (r) {
        this.remoteInterpolation.addState({ x: r.x, y: r.y, z: r.z, yaw: r.yaw, velocityY: r.vy, grounded: false }, performance.now());
        if (r.isEliminated) this.remoteWasEliminated = true;
      }
    }
    if (!pids.some((p) => p !== sid) && this.remoteInterpolation.hasData) { this.remoteInterpolation.reset(); this.remoteWasEliminated = false; }
  }

  private handleHitEvent(event: HitResultEvent): void {
    const sid = this.networkClient.sessionId;
    if (!sid) return;
    if (event.targetId !== sid) this.remoteHitFlashFrames = 6;
  }

  private handleEliminatedEvent(event: PlayerEliminatedEvent): void {
    const sid = this.networkClient.sessionId;
    if (!sid) return;
    if (event.eliminatedId === sid) { this.combatHud.showEliminationOverlay(); }
    else {
      this.remoteWasEliminated = true;
      if (this.remoteMesh && !this.remoteMesh.isDisposed() && this.remoteMaterial) { this.remoteMaterial.diffuseColor = new Color3(0.3, 0.3, 0.3); this.remoteMaterial.emissiveColor = new Color3(0, 0, 0); }
    }
  }

  private updateRemotePlayers(): void {
    if (!this.remoteInterpolation.hasData) {
      if (this.remoteMesh && !this.remoteMesh.isDisposed()) this.remoteMesh.setEnabled(false);
      this.debugHud.state.remotePresent = false; return;
    }
    const pos = this.remoteInterpolation.getInterpolated(performance.now());
    if (!this.remoteMesh || this.remoteMesh.isDisposed()) this.createRemoteMesh();
    if (this.remoteMesh) {
      this.remoteMesh.setEnabled(true); this.remoteMesh.position.set(pos.x, pos.y, pos.z); this.remoteMesh.rotation.y = pos.yaw;
      if (this.remoteHitFlashFrames > 0) { this.remoteHitFlashFrames--; if (this.remoteMaterial) this.remoteMaterial.emissiveColor = new Color3(0.8, 0.2, 0.1); }
      else if (this.remoteMaterial) {
        if (this.remoteWasEliminated) { this.remoteMaterial.emissiveColor = new Color3(0, 0, 0); this.remoteMaterial.diffuseColor = new Color3(0.3, 0.3, 0.3); }
        else { this.remoteMaterial.emissiveColor = new Color3(0, 0.1, 0.2); this.remoteMaterial.diffuseColor = new Color3(0.2, 0.62, 0.95); }
      }
    }
    this.debugHud.state.remotePresent = true;
    this.debugHud.state.remoteX = pos.x; this.debugHud.state.remoteY = pos.y; this.debugHud.state.remoteZ = pos.z;
  }

  private updateCombatHud(): void {
    const c = this.predictionOrchestrator.getCombatState();
    reconcileHealthDisplay(this.combatHud, { health: c.health, shield: c.shield, ammo: c.ammo, isEliminated: c.isEliminated });
  }

  private createRemoteMesh(): void {
    this.disposeRemoteMesh();
    this.remoteMaterial = new StandardMaterial("remote-material", this.scene);
    this.remoteMaterial.diffuseColor = new Color3(0.2, 0.62, 0.95); this.remoteMaterial.emissiveColor = new Color3(0, 0.1, 0.2);
    this.remoteMesh = MeshBuilder.CreateCapsule("remote-player", { height: 1.8, radius: 0.35, tessellation: 16 }, this.scene);
    this.remoteMesh.material = this.remoteMaterial;
    this.remoteMarkerMat = new StandardMaterial("remote-marker-mat", this.scene); this.remoteMarkerMat.diffuseColor = new Color3(1, 1, 1);
    this.remoteMarker = MeshBuilder.CreateBox("remote-marker", { width: 0.22, height: 0.08, depth: 0.06 }, this.scene);
    this.remoteMarker.material = this.remoteMarkerMat; this.remoteMarker.parent = this.remoteMesh;
    this.remoteMarker.position.set(0, 0.2, -0.35); this.remoteMarker.isPickable = false;
  }

  private disposeRemoteMesh(): void {
    if (this.remoteMarker) { this.remoteMarker.dispose(); this.remoteMarker = null; }
    if (this.remoteMesh) { this.remoteMesh.dispose(); this.remoteMesh = null; }
    if (this.remoteMaterial) { this.remoteMaterial.dispose(); this.remoteMaterial = null; }
    if (this.remoteMarkerMat) { this.remoteMarkerMat.dispose(); this.remoteMarkerMat = null; }
  }

  private updateDebugHud(): void {
    const s = this.debugHud.state; const pred = this.predictionOrchestrator.getCurrentState();
    s.localX = pred.x; s.localY = pred.y; s.localZ = pred.z;
    s.sequence = this.inputBatcher.nextSequence; s.lastCorrectionDistance = this.predictionOrchestrator.lastCorrectionDistance;
  }

  public start(): void {
    if (this.disposed) throw new Error("Cannot start a disposed GameRuntime.");
    if (this.started) return;
    window.addEventListener("resize", this.resizeEngine);
    this.engine.runRenderLoop(this.renderFrame); this.engine.resize(); this.started = true;
    this.hudCleanup = this.debugHud.attach(); this.combatHudCleanup = this.combatHud.attach();
    this.networkClient.start().catch((err) => { console.warn("[buildshift] failed to connect:", err); });
  }

  public dispose(): void {
    if (this.disposed) return;
    if (this.started) { window.removeEventListener("resize", this.resizeEngine); this.engine.stopRenderLoop(this.renderFrame); this.started = false; }
    this.inputManager.dispose();
    this.unsubscribeState?.(); this.unsubscribeConnection?.();
    this.unsubscribeHitEvent?.(); this.unsubscribeEliminatedEvent?.();
    this.networkClient.dispose(); this.disposeRemoteMesh();
    this.hudCleanup?.(); this.combatHudCleanup?.(); this.combatHud.dispose();
    this.debugHud.dispose(); this.playerController.dispose(); this.cameraController.dispose();
    this.scene.dispose(); this.engine.dispose();
    this.disposed = true;
  }
}
