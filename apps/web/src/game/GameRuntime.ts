import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { PHYSICS_TIMING } from "@buildshift/game-config";
import { ThirdPersonCameraController } from "./camera/ThirdPersonCameraController";
import { InputManager } from "./input/InputManager";
import { PredictionOrchestrator } from "./network/predictionOrchestrator";
import { PredictionHistory } from "./network/predictionHistory";
import { ReconciliationEngine } from "./network/reconciliation";
import { ReconciliationCoordinator } from "./network/reconciliationCoordinator";
import { RemotePlayerManager } from "./remote/RemotePlayerManager";
import { PlayerController } from "./player/PlayerController";
import { getFoundationNetwork } from "../network/networkInstance";
import { createFoundationScene } from "./scene/createFoundationScene";
import {
  TwoPlayerClient, InputSender, LocalPlayerPrediction,
  RemotePlayerInterpolation, SIMULATION_TICK_SECONDS,
  type ParsedRoomState, type InputSample,
} from "../network/twoPlayer";
import { MovementDebugHUD } from "../ui/MovementDebugHUD";

const FIXED_DT = PHYSICS_TIMING.fixedStepDurationSeconds;
const MAX_FRAME_DELTA = 0.1;
const MAX_STEPS = 8;
const MAX_2P_TICKS = 4;

export class GameRuntime {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly inputManager: InputManager;
  private readonly cameraController: ThirdPersonCameraController;
  private readonly playerController: PlayerController;
  private readonly prediction: PredictionOrchestrator;
  private readonly predictionHistory = new PredictionHistory();
  private readonly reconciliationCoordinator: ReconciliationCoordinator;
  private readonly remotePlayerManager: RemotePlayerManager;
  private readonly unsubscribeNetwork: () => void;
  private readonly foundationNetwork = getFoundationNetwork();
  private readonly unsubscribeInputCleared: () => void;
  private readonly renderFrame: () => void;
  private readonly resizeEngine: () => void;
  private accumulator = 0;
  private started = false;
  private disposed = false;

  // Stage 2D two-player system
  private readonly twoPlayerClient: TwoPlayerClient;
  private readonly inputSender: InputSender;
  private readonly localPrediction: LocalPlayerPrediction;
  private readonly remoteInterpolation: RemotePlayerInterpolation;
  private readonly debugHud: MovementDebugHUD;
  private twoPlayerAccumulator = 0;
  private twoPlayerConnected = false;
  private hudCleanup: (() => void) | null = null;
  private unsubscribeTwoPlayerState: (() => void) | null = null;
  private unsubscribeTwoPlayerConnection: (() => void) | null = null;
  private remoteMesh: AbstractMesh | null = null;
  private remoteMaterial: StandardMaterial | null = null;
  private remoteMarker: AbstractMesh | null = null;
  private remoteMarkerMat: StandardMaterial | null = null;

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
      } catch (e) {
        cam?.dispose(); inputManager.dispose(); scene.dispose(); throw e;
      }
    } catch (e) { engine.dispose(); throw e; }
  }

  private constructor(
    engine: Engine, scene: Scene, inputManager: InputManager,
    cameraController: ThirdPersonCameraController,
    playerController: PlayerController, canvas: HTMLCanvasElement,
  ) {
    this.engine = engine;
    this.scene = scene;
    this.inputManager = inputManager;
    this.cameraController = cameraController;
    this.playerController = playerController;

    // Stage 2D
    this.twoPlayerClient = new TwoPlayerClient();
    this.inputSender = new InputSender();
    this.localPrediction = new LocalPlayerPrediction();
    this.remoteInterpolation = new RemotePlayerInterpolation();
    this.debugHud = new MovementDebugHUD(canvas);

    // Legacy
    this.remotePlayerManager = new RemotePlayerManager(scene);
    this.prediction = new PredictionOrchestrator({
      captureInput: () => {
        const m = this.inputManager.getMovementInput();
        return {
          moveX: m.x, moveZ: m.z,
          lookYaw: this.cameraController.getYaw(),
          lookPitch: this.cameraController.getPitch(),
          jump: this.inputManager.pollJumpPressed(),
        };
      },
      sendSample: (s) => this.foundationNetwork.sendSequencedPlayerInput(s),
      simulateSubstep: (i) => this.playerController.update(FIXED_DT, i),
      history: this.predictionHistory,
      capturePredictionState: () => this.playerController.capturePredictionState(),
    });
    this.reconciliationCoordinator = new ReconciliationCoordinator({
      history: this.predictionHistory,
      createEngine: () => new ReconciliationEngine({
        history: this.predictionHistory,
        capturePredictionState: () => this.playerController.capturePredictionState(),
        restorePredictionState: (s) => this.playerController.restorePredictionState(s),
        setAuthoritativePosition: (p, y) => this.playerController.setAuthoritativePosition(p, y),
        simulateSubstep: (i) => this.playerController.update(FIXED_DT, i),
      }),
      hasActiveBatch: () => this.prediction.hasActiveBatch(),
    });
    this.unsubscribeNetwork = this.foundationNetwork.subscribe(() => {
      const s = this.foundationNetwork.getUiState();
      this.reconciliationCoordinator.onNetworkState(s);
      this.remotePlayerManager.sync(s.players, s.sessionId);
    });
    const ps = this.foundationNetwork.getUiState();
    this.reconciliationCoordinator.onNetworkState(ps);
    this.remotePlayerManager.sync(ps.players, ps.sessionId);
    this.unsubscribeInputCleared = this.inputManager.subscribeInputCleared(this.handleInputCleared);

    // Stage 2D: wire up state observers
    this.unsubscribeTwoPlayerState = this.twoPlayerClient.onStateChange(
      (state) => this.handleTwoPlayerState(state),
    );
    this.unsubscribeTwoPlayerConnection = this.twoPlayerClient.onConnectionChange(
      (connected) => {
        this.twoPlayerConnected = connected;
        if (connected) {
          this.localPrediction.reset();
          this.inputSender.reset();
          this.remoteInterpolation.reset();
        }
        this.debugHud.state.connectionState = connected ? "connected" : "disconnected";
      },
    );

    this.renderFrame = () => {
      if (!this.scene.isDisposed) {
        const lookDelta = this.inputManager.consumeLookDelta();
        this.cameraController.applyLook(lookDelta.x, lookDelta.y);

        const dt = Math.min(Math.max(this.engine.getDeltaTime() / 1000, 0), MAX_FRAME_DELTA);

        if (this.twoPlayerConnected) {
          this.twoPlayerAccumulator += dt;
          let t = 0;
          while (this.twoPlayerAccumulator >= SIMULATION_TICK_SECONDS && t < MAX_2P_TICKS) {
            this.stepTwoPlayerTick();
            this.twoPlayerAccumulator -= SIMULATION_TICK_SECONDS;
            t++;
          }
          if (t >= MAX_2P_TICKS) this.twoPlayerAccumulator = 0;
        } else {
          this.accumulator += dt;
          let s = 0;
          while (this.accumulator >= FIXED_DT && s < MAX_STEPS) {
            if (!this.prediction.hasActiveBatch()) {
              this.reconciliationCoordinator.reconcileAtSafeBoundary();
            }
            this.prediction.stepSubstep();
            this.accumulator -= FIXED_DT;
            s++;
          }
          if (s >= MAX_STEPS) { this.accumulator = 0; this.prediction.resetBatch(); }
        }

        if (this.twoPlayerConnected) this.updateRemotePlayers();
        this.cameraController.update(this.playerController.getFeetPosition());
        this.updateDebugHud();
        this.scene.render();
      }
    };
    this.resizeEngine = () => { this.engine.resize(); };
  }

  private stepTwoPlayerTick(): void {
    const m = this.inputManager.getMovementInput();
    const sample: InputSample = {
      moveX: m.x, moveZ: m.z,
      yaw: this.cameraController.getYaw(),
      pitch: this.cameraController.getPitch(),
      jump: this.inputManager.pollJumpPressed(),
      crouch: false,
    };
    const predicted = this.localPrediction.predict(sample);
    this.inputSender.send(sample, this.twoPlayerClient, {
      x: predicted.x, y: predicted.y, z: predicted.z,
      velocityY: predicted.velocityY, grounded: predicted.grounded,
    });
    this.playerController.setMeshTransform(
      { x: predicted.x, y: predicted.y, z: predicted.z }, predicted.yaw,
    );
  }

  private handleTwoPlayerState(state: ParsedRoomState): void {
    const sid = this.twoPlayerClient.sessionId;
    if (!sid) return;
    const pids = Object.keys(state.players);

    const local = state.players[sid];
    if (local) {
      this.localPrediction.onServerState(
        { x: local.x, y: local.y, z: local.z, yaw: local.yaw,
          velocityY: local.vy, grounded: local.vy === 0, sequence: local.sequence },
        this.inputSender.getInputsAfter(local.sequence),
      );
      this.inputSender.pruneUpTo(local.sequence);
    }

    for (const pid of pids) {
      if (pid === sid) continue;
      const r = state.players[pid];
      if (r) {
        this.remoteInterpolation.addState(
          { x: r.x, y: r.y, z: r.z, yaw: r.yaw, velocityY: r.vy, grounded: false },
          performance.now(),
        );
      }
    }
    if (!pids.some((p) => p !== sid) && this.remoteInterpolation.hasData) {
      this.remoteInterpolation.reset();
    }
  }

  private updateRemotePlayers(): void {
    if (!this.remoteInterpolation.hasData) {
      if (this.remoteMesh && !this.remoteMesh.isDisposed()) this.remoteMesh.setEnabled(false);
      this.debugHud.state.remotePresent = false;
      return;
    }
    const pos = this.remoteInterpolation.getInterpolated(performance.now());
    if (!this.remoteMesh || this.remoteMesh.isDisposed()) this.createRemoteMesh();
    if (this.remoteMesh) {
      this.remoteMesh.setEnabled(true);
      this.remoteMesh.position.set(pos.x, pos.y, pos.z);
      this.remoteMesh.rotation.y = pos.yaw;
    }
    this.debugHud.state.remotePresent = true;
    this.debugHud.state.remoteX = pos.x;
    this.debugHud.state.remoteY = pos.y;
    this.debugHud.state.remoteZ = pos.z;
  }

  private createRemoteMesh(): void {
    this.disposeRemoteMesh();
    this.remoteMaterial = new StandardMaterial("remote-2d-material", this.scene);
    this.remoteMaterial.diffuseColor = new Color3(0.2, 0.62, 0.95);
    this.remoteMaterial.emissiveColor = new Color3(0, 0.1, 0.2);
    this.remoteMesh = MeshBuilder.CreateCapsule("remote-player-2d",
      { height: 1.8, radius: 0.35, tessellation: 16 }, this.scene);
    this.remoteMesh.material = this.remoteMaterial;
    this.remoteMarkerMat = new StandardMaterial("remote-2d-marker-mat", this.scene);
    this.remoteMarkerMat.diffuseColor = new Color3(1, 1, 1);
    this.remoteMarker = MeshBuilder.CreateBox("remote-2d-marker",
      { width: 0.22, height: 0.08, depth: 0.06 }, this.scene);
    this.remoteMarker.material = this.remoteMarkerMat;
    this.remoteMarker.parent = this.remoteMesh;
    this.remoteMarker.position.set(0, 0.2, -0.35);
    this.remoteMarker.isPickable = false;
  }

  private disposeRemoteMesh(): void {
    if (this.remoteMarker) { this.remoteMarker.dispose(); this.remoteMarker = null; }
    if (this.remoteMesh) { this.remoteMesh.dispose(); this.remoteMesh = null; }
    if (this.remoteMaterial) { this.remoteMaterial.dispose(); this.remoteMaterial = null; }
    if (this.remoteMarkerMat) { this.remoteMarkerMat.dispose(); this.remoteMarkerMat = null; }
  }

  private updateDebugHud(): void {
    const s = this.debugHud.state;
    const pred = this.localPrediction.getCurrentState();
    s.localX = pred.x; s.localY = pred.y; s.localZ = pred.z;
    s.sequence = this.inputSender.nextSequence;
    s.lastCorrectionDistance = this.localPrediction.lastCorrectionDistance;
  }

  private readonly handleInputCleared = (): void => {
    this.playerController.resetJumpState();
    this.prediction.clearAndSendNeutral({
      moveX: 0, moveZ: 0,
      lookYaw: this.cameraController.getYaw(),
      lookPitch: this.cameraController.getPitch(),
      jump: false,
    });
    if (this.twoPlayerConnected) {
      this.inputSender.send(
        { moveX: 0, moveZ: 0, yaw: this.cameraController.getYaw(),
          pitch: this.cameraController.getPitch(), jump: false, crouch: false },
        this.twoPlayerClient,
        { x: 0, y: 0, z: 0, velocityY: 0, grounded: true },
      );
    }
  };

  public start(): void {
    if (this.disposed) throw new Error("Cannot start a disposed GameRuntime.");
    if (this.started) return;

    window.addEventListener("resize", this.resizeEngine);
    this.engine.runRenderLoop(this.renderFrame);
    this.engine.resize();
    this.started = true;

    // Stage 2D: attach the debug HUD and connect the two-player client.
    this.hudCleanup = this.debugHud.attach();
    this.twoPlayerClient.start().catch((err) => {
      console.warn("[buildshift:2d] failed to connect two-player room:", err);
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    if (this.started) {
      window.removeEventListener("resize", this.resizeEngine);
      this.engine.stopRenderLoop(this.renderFrame);
      this.started = false;
    }
    this.inputManager.dispose();
    this.unsubscribeInputCleared();
    this.unsubscribeNetwork();
    this.unsubscribeTwoPlayerState?.();
    this.unsubscribeTwoPlayerConnection?.();
    this.twoPlayerClient.dispose();
    this.disposeRemoteMesh();
    this.hudCleanup?.();
    this.debugHud.dispose();
    this.playerController.dispose();
    this.cameraController.dispose();
    this.remotePlayerManager.dispose();
    this.scene.dispose();
    this.engine.dispose();
    this.disposed = true;
  }
}
