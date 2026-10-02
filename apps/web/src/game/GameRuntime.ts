import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { PHYSICS_TIMING, PLAYER_COLLIDER, PLAYER_COLLIDER_TOTAL_HEIGHT } from "@buildshift/game-config";
import { MatchPhase, type HitResultEvent, type PlayerEliminatedEvent } from "@buildshift/protocol";
import { ThirdPersonCameraController } from "./camera/ThirdPersonCameraController";
import { InputManager } from "./input/InputManager";
import { AimController } from "./aim/AimController";
import { PlayerController } from "./player/PlayerController";
import { createFoundationScene } from "./scene/createFoundationScene";
import { HealthHud } from "./network/HealthHud";
import type { SubstepInput } from "./player/substepInput";
import {
  createGameNetworking, parseMatchState, computeMatchReset,
  INITIAL_MATCH_SNAPSHOT, COMBAT_HIT_EVENT, COMBAT_ELIMINATED_EVENT,
  SIMULATION_TICK_SECONDS, reconcileHealthDisplay,
  type ParsedRoomState, type ParsedMatchState, type MatchStateSnapshot, type InputSample,
} from "./network";
import { MovementDebugHUD } from "../ui/MovementDebugHUD";

const FIXED_DT = PHYSICS_TIMING.fixedStepDurationSeconds;
const MAX_FRAME_DELTA = 0.1;
const MAX_STEPS = 8;
const MAX_SIM_TICKS = 4;
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
  private simAccumulator = 0;
  private isConnected = false;
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
  private matchState: ParsedMatchState = parseMatchState({});
  private prevMatchSnapshot: MatchStateSnapshot = { ...INITIAL_MATCH_SNAPSHOT };
  private matchOver = false;

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
      this.isConnected = connected;
      if (connected) { this.predictionOrchestrator.reset(); this.inputBatcher.reset(); this.remoteInterpolation.reset(); this.remoteWasEliminated = false; this.remoteHitFlashFrames = 0; this.matchOver = false; this.prevMatchSnapshot = { ...INITIAL_MATCH_SNAPSHOT }; }
      this.debugHud.state.connectionState = connected ? "connected" : "disconnected";
    });
    this.unsubscribeHitEvent = this.networkClient.onEvent(COMBAT_HIT_EVENT, (p) => this.handleHitEvent(p as HitResultEvent));
    this.unsubscribeEliminatedEvent = this.networkClient.onEvent(COMBAT_ELIMINATED_EVENT, (p) => this.handleEliminatedEvent(p as PlayerEliminatedEvent));
    this.renderFrame = () => {
      if (!this.scene.isDisposed) {
        const ld = this.inputManager.consumeLookDelta();
        this.cameraController.applyLook(ld.x, ld.y);
        const dt = Math.min(Math.max(this.engine.getDeltaTime() / 1000, 0), MAX_FRAME_DELTA);
        if (this.isConnected) {
          this.simAccumulator += dt; let t = 0;
          while (this.simAccumulator >= SIMULATION_TICK_SECONDS && t < MAX_SIM_TICKS) { this.stepSimulationTick(); this.simAccumulator -= SIMULATION_TICK_SECONDS; t++; }
          if (t >= MAX_SIM_TICKS) this.simAccumulator = 0;
        } else {
          this.accumulator += dt; let s = 0;
          while (this.accumulator >= FIXED_DT && s < MAX_STEPS) { this.playerController.update(FIXED_DT, NEUTRAL); this.accumulator -= FIXED_DT; s++; }
          if (s >= MAX_STEPS) this.accumulator = 0;
        }
        if (this.isConnected) { this.updateRemotePlayers(); this.updateCombatHud(); }
        this.cameraController.update(this.playerController.getFeetPosition());
        this.aimController.getAimDirection(this.cameraController.getCamera(), this.currentAimDirection);
        this.updateDebugHud();
        this.scene.render();
      }
    };
    this.resizeEngine = () => { this.engine.resize(); };
  }

  public start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.hudCleanup = this.debugHud.attach();
    this.combatHudCleanup = this.combatHud.attach();
    window.addEventListener("resize", this.resizeEngine);
    this.engine.runRenderLoop(this.renderFrame);
    void this.networkClient.start().catch((err: unknown) => { console.error("GameRuntime: network connection failed", err); });
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
    this.handleMatchState(state.match);
    const pids = Object.keys(state.players);
    const local = state.players[sid];
    if (local) {
      this.predictionOrchestrator.onServerState({ x: local.x, y: local.y, z: local.z, yaw: local.yaw, velocityY: local.vy, grounded: local.vy === 0, sequence: local.sequence, health: local.health, shield: local.shield, energy: local.energy, ammo: local.ammo, lastFireSequence: local.lastFireSequence, isEliminated: local.isEliminated }, this.inputBatcher.getInputsAfter(local.sequence));
      this.inputBatcher.pruneUpTo(local.sequence);
    }
    for (const pid of pids) {
      if (pid === sid) continue;
      const r = state.players[pid];
      if (r) { this.remoteInterpolation.addState({ x: r.x, y: r.y, z: r.z, yaw: r.yaw, velocityY: r.vy, grounded: false }, performance.now()); if (r.isEliminated) this.remoteWasEliminated = true; }
    }
    if (!pids.some((p) => p !== sid) && this.remoteInterpolation.hasData) { this.remoteInterpolation.reset(); this.remoteWasEliminated = false; }
  }

  private handleMatchState(match: ParsedMatchState): void {
    this.matchState = match;
    const snapshot: MatchStateSnapshot = { matchPhase: match.matchPhase, currentRound: match.currentRound, roundScore: match.roundScore, lastRoundResult: match.lastRoundResult };
    const decision = computeMatchReset(this.prevMatchSnapshot, snapshot);
    this.prevMatchSnapshot = snapshot;
    if (decision.matchEnded) this.matchOver = true;
    if (decision.shouldReset) this.clearRoundState();
  }

  private clearRoundState(): void {
    this.predictionOrchestrator.reset();
    this.inputBatcher.reset();
    this.remoteInterpolation.reset();
    this.remoteWasEliminated = false;
    this.remoteHitFlashFrames = 0;
  }

  public getMatchState(): ParsedMatchState { return this.matchState; }
  public isMatchOver(): boolean { return this.matchOver || this.matchState.matchPhase === MatchPhase.MATCH_ENDED; }

  private handleHitEvent(event: HitResultEvent): void {
    const sid = this.networkClient.sessionId;
    if (!sid) return;
    if (event.targetId !== sid) this.remoteHitFlashFrames = 6;
  }

  private handleEliminatedEvent(event: PlayerEliminatedEvent): void {
    const sid = this.networkClient.sessionId;
    if (!sid) return;
    if (event.eliminatedId !== sid) this.remoteWasEliminated = true;
  }

  private updateRemotePlayers(): void {
    if (!this.remoteInterpolation.hasData) { this.setRemoteVisible(false); return; }
    this.ensureRemoteMesh();
    const pos = this.remoteInterpolation.getInterpolated(performance.now());
    this.remoteMesh!.position.set(pos.x, pos.y, pos.z);
    this.remoteMesh!.rotation.y = pos.yaw;
    if (this.remoteMaterial) {
      if (this.remoteWasEliminated) {
        this.remoteMaterial.emissiveColor = new Color3(0.1, 0.0, 0.0);
        this.remoteMaterial.diffuseColor = new Color3(0.3, 0.1, 0.1);
      } else if (this.remoteHitFlashFrames > 0) {
        this.remoteHitFlashFrames--;
        this.remoteMaterial.emissiveColor = new Color3(1.0, 0.3, 0.0);
      } else {
        this.remoteMaterial.emissiveColor = new Color3(0.05, 0.02, 0.15);
        this.remoteMaterial.diffuseColor = new Color3(0.9, 0.25, 0.25);
      }
    }
  }

  private updateCombatHud(): void {
    const c = this.predictionOrchestrator.getCombatState();
    reconcileHealthDisplay(this.combatHud, { health: c.health, shield: c.shield, ammo: c.ammo, isEliminated: c.isEliminated });
  }

  private updateDebugHud(): void {
    const local = this.playerController.getPosition();
    const remote = this.remoteInterpolation.lastState;
    this.debugHud.state.localX = local.x; this.debugHud.state.localY = local.y; this.debugHud.state.localZ = local.z;
    if (remote) { this.debugHud.state.remoteX = remote.x; this.debugHud.state.remoteY = remote.y; this.debugHud.state.remoteZ = remote.z; this.debugHud.state.remotePresent = true; }
    else { this.debugHud.state.remotePresent = false; }
    this.debugHud.state.sequence = this.inputBatcher.lastSentSequence;
    this.debugHud.state.lastCorrectionDistance = this.predictionOrchestrator.lastCorrectionDistance;
  }

  private ensureRemoteMesh(): void {
    if (this.remoteMesh) return;
    this.remoteMaterial = new StandardMaterial("remote-player-material", this.scene);
    this.remoteMaterial.diffuseColor = new Color3(0.9, 0.25, 0.25);
    this.remoteMaterial.emissiveColor = new Color3(0.05, 0.02, 0.15);
    this.remoteMesh = MeshBuilder.CreateCapsule("remote-player", { height: PLAYER_COLLIDER_TOTAL_HEIGHT, radius: PLAYER_COLLIDER.radius, tessellation: 16 }, this.scene);
    this.remoteMesh.material = this.remoteMaterial;
    this.remoteMarkerMat = new StandardMaterial("remote-player-marker", this.scene);
    this.remoteMarkerMat.diffuseColor = new Color3(0.95, 0.95, 0.95);
    this.remoteMarker = MeshBuilder.CreateBox("remote-player-marker", { width: 0.22, height: 0.08, depth: 0.06 }, this.scene);
    this.remoteMarker.material = this.remoteMarkerMat;
    this.remoteMarker.parent = this.remoteMesh;
    this.remoteMarker.position.set(0, 0.2, -0.35);
  }

  private setRemoteVisible(v: boolean): void {
    if (this.remoteMesh) this.remoteMesh.setEnabled(v);
    if (this.remoteMarker) this.remoteMarker.setEnabled(v);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("resize", this.resizeEngine);
    this.engine.stopRenderLoop(this.renderFrame);
    this.engine.dispose();
    this.unsubscribeState?.(); this.unsubscribeConnection?.();
    this.unsubscribeHitEvent?.(); this.unsubscribeEliminatedEvent?.();
    this.hudCleanup?.(); this.combatHudCleanup?.();
    this.networkClient.dispose();
    this.debugHud.dispose(); this.combatHud.dispose();
    if (this.remoteMesh) this.remoteMesh.dispose();
    if (this.remoteMarker) this.remoteMarker.dispose();
    if (this.remoteMaterial) this.remoteMaterial.dispose();
    if (this.remoteMarkerMat) this.remoteMarkerMat.dispose();
    this.playerController.dispose();
    this.inputManager.dispose();
    this.cameraController.dispose();
  }
}
