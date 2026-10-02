import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { PHYSICS_TIMING, MAX_HEALTH, MAX_SHIELD } from "@buildshift/game-config";
import type { HitResultEvent, PlayerEliminatedEvent } from "@buildshift/protocol";
import { ThirdPersonCameraController } from "./camera/ThirdPersonCameraController";
import { InputManager } from "./input/InputManager";
import { AimController } from "./aim/AimController";
import { RemotePlayerManager } from "./remote/RemotePlayerManager";
import { PlayerController } from "./player/PlayerController";
import { createFoundationScene } from "./scene/createFoundationScene";
import { HealthHud } from "./HealthHud";
import type { SubstepInput } from "./player/substepInput";
import {
  createGameNetworking,
  TwoPlayerClient, InputSender, LocalPlayerPrediction,
  RemotePlayerInterpolation, SIMULATION_TICK_SECONDS,
  COMBAT_HIT_EVENT, COMBAT_ELIMINATED_EVENT,
  type ParsedRoomState, type InputSample,
} from "../network/twoPlayer";
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
  private readonly remotePlayerManager: RemotePlayerManager;
  private readonly renderFrame: () => void;
  private readonly resizeEngine: () => void;
  private accumulator = 0;
  private started = false;
  private disposed = false;
  private readonly aimController = new AimController();
  public readonly currentAimDirection = new Vector3(0, 0, -1);
  private readonly twoPlayerClient: TwoPlayerClient;
  private readonly inputSender: InputSender;
  private readonly localPrediction: LocalPlayerPrediction;
  private readonly remoteInterpolation: RemotePlayerInterpolation;
  private readonly debugHud: MovementDebugHUD;
  private readonly combatHud: HealthHud;
  private twoPlayerAccumulator = 0;
  private twoPlayerConnected = false;
  private hudCleanup: (() => void) | null = null;
  private combatHudCleanup: (() => void) | null = null;
  private unsubscribeTwoPlayerState: (() => void) | null = null;
  private unsubscribeTwoPlayerConnection: (() => void) | null = null;
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
    // Wire the canonical two-player networking stack through the single
    // production factory so the runtime is guaranteed exactly ONE network
    // client. This is the wiring the single-client contract test asserts on
    // (see GameRuntime.singleClient.contract.test.ts).
    const networking = createGameNetworking();
    this.twoPlayerClient = networking.client;
    this.inputSender = networking.inputSender;
    this.localPrediction = networking.localPrediction;
    this.remoteInterpolation = networking.remoteInterpolation;
    this.debugHud = new MovementDebugHUD(canvas); this.combatHud = new HealthHud();
    this.remotePlayerManager = new RemotePlayerManager(scene);
    this.unsubscribeTwoPlayerState = this.twoPlayerClient.onStateChange((state) => this.handleTwoPlayerState(state));
    this.unsubscribeTwoPlayerConnection = this.twoPlayerClient.onConnectionChange((connected) => {
      this.twoPlayerConnected = connected;
      if (connected) { this.localPrediction.reset(); this.inputSender.reset(); this.remoteInterpolation.reset(); this.remoteWasEliminated = false; }
      this.debugHud.state.connectionState = connected ? "connected" : "disconnected";
    });
    this.unsubscribeHitEvent = this.twoPlayerClient.onEvent(COMBAT_HIT_EVENT, (p) => this.handleHitEvent(p as HitResultEvent));
    this.unsubscribeEliminatedEvent = this.twoPlayerClient.onEvent(COMBAT_ELIMINATED_EVENT, (p) => this.handleEliminatedEvent(p as PlayerEliminatedEvent));
    this.renderFrame = () => {
      if (!this.scene.isDisposed) {
        const ld = this.inputManager.consumeLookDelta();
        this.cameraController.applyLook(ld.x, ld.y);
        const dt = Math.min(Math.max(this.engine.getDeltaTime() / 1000, 0), MAX_FRAME_DELTA);
        if (this.twoPlayerConnected) {
          this.twoPlayerAccumulator += dt;
          let t = 0;
          while (this.twoPlayerAccumulator >= SIMULATION_TICK_SECONDS && t < MAX_2P_TICKS) {
            this.stepTwoPlayerTick(); this.twoPlayerAccumulator -= SIMULATION_TICK_SECONDS; t++;
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
  private stepTwoPlayerTick(): void {
    const m = this.inputManager.getMovementInput();
    const fireIntent = this.inputManager.isFiring();
    const seq = this.inputSender.nextSequence;
    const sample: InputSample = { moveX: m.x, moveZ: m.z, yaw: this.cameraController.getYaw(), pitch: this.cameraController.getPitch(), jump: this.inputManager.pollJumpPressed(), crouch: false, primaryFire: fireIntent };
    const predicted = this.localPrediction.predict(sample);
    this.localPrediction.predictFire(seq, fireIntent);
    this.inputSender.send(sample, this.twoPlayerClient, { x: predicted.x, y: predicted.y, z: predicted.z, velocityY: predicted.velocityY, grounded: predicted.grounded });
    this.playerController.setMeshTransform({ x: predicted.x, y: predicted.y, z: predicted.z }, predicted.yaw);
  }
  private handleTwoPlayerState(state: ParsedRoomState): void {
    const sid = this.twoPlayerClient.sessionId;
    if (!sid) return;
    const pids = Object.keys(state.players);
    const local = state.players[sid];
    if (local) {
      this.localPrediction.onServerState({ x: local.x, y: local.y, z: local.z, yaw: local.yaw, velocityY: local.vy, grounded: local.vy === 0, sequence: local.sequence, health: local.health, shield: local.shield, energy: local.energy, ammo: local.ammo, lastFireSequence: local.lastFireSequence, isEliminated: local.isEliminated }, this.inputSender.getInputsAfter(local.sequence));
      this.inputSender.pruneUpTo(local.sequence);
      if (this.localPrediction.isEliminated) this.combatHud.showEliminationOverlay();
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
    const sid = this.twoPlayerClient.sessionId;
    if (!sid) return;
    if (event.targetId !== sid) this.remoteHitFlashFrames = 6;
  }
  private handleEliminatedEvent(event: PlayerEliminatedEvent): void {
    const sid = this.twoPlayerClient.sessionId;
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
    const c = this.localPrediction.getCombatState();
    this.combatHud.setHealth(c.health, MAX_HEALTH); this.combatHud.setShield(c.shield, MAX_SHIELD);
    this.combatHud.setAmmo(c.ammo); this.combatHud.setWeapon("Assault Rifle");
  }
  private createRemoteMesh(): void {
    this.disposeRemoteMesh();
    this.remoteMaterial = new StandardMaterial("remote-2d-material", this.scene);
    this.remoteMaterial.diffuseColor = new Color3(0.2, 0.62, 0.95); this.remoteMaterial.emissiveColor = new Color3(0, 0.1, 0.2);
    this.remoteMesh = MeshBuilder.CreateCapsule("remote-player-2d", { height: 1.8, radius: 0.35, tessellation: 16 }, this.scene);
    this.remoteMesh.material = this.remoteMaterial;
    this.remoteMarkerMat = new StandardMaterial("remote-2d-marker-mat", this.scene); this.remoteMarkerMat.diffuseColor = new Color3(1, 1, 1);
    this.remoteMarker = MeshBuilder.CreateBox("remote-2d-marker", { width: 0.22, height: 0.08, depth: 0.06 }, this.scene);
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
    const s = this.debugHud.state; const pred = this.localPrediction.getCurrentState();
    s.localX = pred.x; s.localY = pred.y; s.localZ = pred.z;
    s.sequence = this.inputSender.nextSequence; s.lastCorrectionDistance = this.localPrediction.lastCorrectionDistance;
  }
  public start(): void {
    if (this.disposed) throw new Error("Cannot start a disposed GameRuntime.");
    if (this.started) return;
    window.addEventListener("resize", this.resizeEngine);
    this.engine.runRenderLoop(this.renderFrame); this.engine.resize(); this.started = true;
    this.hudCleanup = this.debugHud.attach(); this.combatHudCleanup = this.combatHud.attach();
    this.twoPlayerClient.start().catch((err) => { console.warn("[buildshift:2d] failed to connect:", err); });
  }
  public dispose(): void {
    if (this.disposed) return;
    if (this.started) { window.removeEventListener("resize", this.resizeEngine); this.engine.stopRenderLoop(this.renderFrame); this.started = false; }
    this.inputManager.dispose();
    this.unsubscribeTwoPlayerState?.(); this.unsubscribeTwoPlayerConnection?.();
    this.unsubscribeHitEvent?.(); this.unsubscribeEliminatedEvent?.();
    this.twoPlayerClient.dispose(); this.disposeRemoteMesh();
    this.hudCleanup?.(); this.combatHudCleanup?.(); this.combatHud.dispose();
    this.debugHud.dispose(); this.playerController.dispose(); this.cameraController.dispose();
    this.remotePlayerManager.dispose(); this.scene.dispose(); this.engine.dispose();
    this.disposed = true;
  }
}
