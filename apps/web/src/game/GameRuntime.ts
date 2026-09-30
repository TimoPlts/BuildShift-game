import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import { PHYSICS_TIMING } from "@buildshift/game-config";
import { ThirdPersonCameraController } from "./camera/ThirdPersonCameraController";
import { InputManager } from "./input/InputManager";
import { PredictionOrchestrator } from "./network/predictionOrchestrator";
import { PredictionHistory } from "./network/predictionHistory";
import { ReconciliationEngine } from "./network/reconciliation";
import { ReconciliationCoordinator } from "./network/reconciliationCoordinator";
import { PlayerController } from "./player/PlayerController";
import { getFoundationNetwork } from "../network/networkInstance";
import { createFoundationScene } from "./scene/createFoundationScene";

/** Fixed physics timestep (s), from the shared config — 60 Hz. */
const FIXED_DT = PHYSICS_TIMING.fixedStepDurationSeconds;
/** Hard cap on a single frame's delta (s) — protects against stalled tabs. */
const MAX_FRAME_DELTA_SECONDS = 0.1;
/**
 * Hard cap on fixed steps per frame (the "spiral of death" guard). After this
 * many catch-up steps in one frame we drop the remaining accumulated time so
 * a long hitch never freezes the render loop.
 */
const MAX_FIXED_STEPS_PER_FRAME = 8;

/**
 * Owns the Babylon engine, scene, render loop, and browser lifecycle hooks.
 *
 * Per-frame update order (avoids a one-frame lag between movement and
 * camera follow):
 *
 * 1. consume input (accumulated mouse delta) and apply it to the camera —
 *    the visual camera always runs at render rate, never 30 Hz
 * 2. fixed-step prediction in two-substep batches: at the first 1/60
 *    substep of a batch capture ONE input sample (movement axes, yaw, pitch,
 *    jump edge — each read once) and send it to the network exactly once;
 *    both substeps then simulate with that same sample (second substep with
 *    jumpPressed forced false), matching the server's "one PlayerInputFrame
 *    = two 1/60 physics substeps" semantics
 * 3. update the camera position from the new player position
 * 4. render the scene
 */
export class GameRuntime {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly inputManager: InputManager;
  private readonly cameraController: ThirdPersonCameraController;
  private readonly playerController: PlayerController;
  private readonly prediction: PredictionOrchestrator;
  /**
   * The single, runtime-owned prediction history. Shared by BOTH the
   * prediction orchestrator (which records completed batches) and the live
   * reconciliation engine (which reads/rewinds them) — one source of truth.
   */
  private readonly predictionHistory = new PredictionHistory();
  /**
   * Pure coordinator that observes the network, tracks the local session, and
   * drives the reconciliation engine at the safe batch boundary.
   */
  private readonly reconciliationCoordinator: ReconciliationCoordinator;
  /** Unsubscribe for the page-lifetime network UI-state observer. */
  private readonly unsubscribeNetwork: () => void;
  private readonly foundationNetwork = getFoundationNetwork();
  private readonly unsubscribeInputCleared: () => void;
  private readonly renderFrame: () => void;
  private readonly resizeEngine: () => void;
  /** Time accumulator (seconds) for the fixed physics step. */
  private accumulator = 0;
  private started = false;
  private disposed = false;

  /**
   * Creates a ready-to-run runtime. This is async because the player's physics
   * world must finish loading the Rapier WASM (compat build) before the
   * character can be constructed. On any failure the partially-built Babylon
   * objects are disposed before the error is rethrown.
   */
  public static async create(canvas: HTMLCanvasElement): Promise<GameRuntime> {
    const engine = new Engine(canvas, true);
    try {
      const scene = createFoundationScene(engine);
      const inputManager = new InputManager(canvas);
      let cameraController: ThirdPersonCameraController | undefined;
      try {
        cameraController = new ThirdPersonCameraController(scene);
        const playerController = await PlayerController.create(scene);
        return new GameRuntime(
          engine,
          scene,
          inputManager,
          cameraController,
          playerController,
        );
      } catch (error) {
        cameraController?.dispose();
        inputManager.dispose();
        scene.dispose();
        throw error;
      }
    } catch (error) {
      engine.dispose();
      throw error;
    }
  }

  private constructor(
    engine: Engine,
    scene: Scene,
    inputManager: InputManager,
    cameraController: ThirdPersonCameraController,
    playerController: PlayerController,
  ) {
    this.engine = engine;
    this.scene = scene;
    this.inputManager = inputManager;
    this.cameraController = cameraController;
    this.playerController = playerController;
    // The orchestrator owns the batch bookkeeping for local prediction. Each
    // substep it captures ONE sample (driving both local prediction and the
    // single network frame) and simulates with the batch's explicit input —
    // the same semantics the server applies to one PlayerInputFrame.
    this.prediction = new PredictionOrchestrator({
      captureInput: () => {
        const movement = this.inputManager.getMovementInput();
        return {
          moveX: movement.x,
          moveZ: movement.z,
          lookYaw: this.cameraController.getYaw(),
          lookPitch: this.cameraController.getPitch(),
          jump: this.inputManager.pollJumpPressed(),
        };
      },
      sendSample: (sample) =>
        this.foundationNetwork.sendSequencedPlayerInput(sample),
      simulateSubstep: (input) => this.playerController.update(FIXED_DT, input),
      // Completed successfully-sent batches are checkpointed into the shared
      // history, captured from the local PlayerController after substep B.
      history: this.predictionHistory,
      capturePredictionState: () =>
        this.playerController.capturePredictionState(),
    });

    // Live reconciliation engine, rebuilt FRESH per session by the coordinator.
    // Its replay path is LOCAL-ONLY: it drives the same PlayerController.update
    // seam as prediction and never touches the network.
    this.reconciliationCoordinator = new ReconciliationCoordinator({
      history: this.predictionHistory,
      createEngine: () =>
        new ReconciliationEngine({
          history: this.predictionHistory,
          capturePredictionState: () =>
            this.playerController.capturePredictionState(),
          restorePredictionState: (state) =>
            this.playerController.restorePredictionState(state),
          setAuthoritativePosition: (position, yaw) =>
            this.playerController.setAuthoritativePosition(position, yaw),
          simulateSubstep: (input) =>
            this.playerController.update(FIXED_DT, input),
        }),
      hasActiveBatch: () => this.prediction.hasActiveBatch(),
    });

    // Observe the page-lifetime network: on every UI-state change the
    // coordinator tracks the local session and coalesces the latest local
    // authoritative snapshot. Reconciliation itself is deferred to the safe
    // batch boundary in the fixed-step loop — never mid-batch.
    this.unsubscribeNetwork = this.foundationNetwork.subscribe(() => {
      this.reconciliationCoordinator.onNetworkState(
        this.foundationNetwork.getUiState(),
      );
    });

    this.unsubscribeInputCleared = this.inputManager.subscribeInputCleared(
      this.handleInputCleared,
    );

    this.renderFrame = () => {
      if (!this.scene.isDisposed) {
        // 1. Camera look (consumed once per frame, independent of physics).
        // The visual third-person camera keeps updating every render frame;
        // only movement *prediction* is sampled at 30 Hz (per batch).
        const lookDelta = this.inputManager.consumeLookDelta();
        this.cameraController.applyLook(lookDelta.x, lookDelta.y);

        // 2. Fixed-step prediction: advance the character by whole 60 Hz
        // substeps, batched two per input sample (30 Hz cadence) so the local
        // prediction matches the server's authoritative semantics exactly —
        // one PlayerInputFrame feeds two 1/60 substeps.
        const deltaSeconds = Math.min(
          Math.max(this.engine.getDeltaTime() / 1000, 0),
          MAX_FRAME_DELTA_SECONDS,
        );
        this.accumulator += deltaSeconds;
        let steps = 0;
        while (
          this.accumulator >= FIXED_DT &&
          steps < MAX_FIXED_STEPS_PER_FRAME
        ) {
          // Safe batch boundary: authoritative reconciliation NEVER happens
          // mid-batch. When no prediction batch is in progress (the moment a
          // fresh one is about to start), apply the latest pending local
          // authoritative snapshot. A snapshot that arrived during substep A
          // stays pending and is reconciled here, once substep B has finished
          // and the batch is idle.
          if (!this.prediction.hasActiveBatch()) {
            this.reconciliationCoordinator.reconcileAtSafeBoundary();
          }
          this.prediction.stepSubstep();
          this.accumulator -= FIXED_DT;
          steps += 1;
        }
        if (steps >= MAX_FIXED_STEPS_PER_FRAME) {
          // Spiral-of-death guard: drop the un-simulated remainder so a long
          // hitch can't stall the render loop. Any half-finished batch is
          // discarded so the next substep starts a fresh capture — no stale
          // sample survives the hitch.
          this.accumulator = 0;
          this.prediction.resetBatch();
        }

        // 3. Camera follows the character's feet (centre - half height).
        this.cameraController.update(this.playerController.getFeetPosition());

        // 4. Render.
        this.scene.render();
      }
    };
    this.resizeEngine = () => {
      this.engine.resize();
    };
  }

  /**
   * Clear local buffered state and stop authoritative held movement without
   * waiting for another render/fixed step (hidden tabs may throttle both).
   *
   * The player's jump state (buffer + coyote) and the prediction batch are
   * both reset synchronously, then one neutral authoritative intent is sent
   * so the server stops applying the last held movement. After the reset the
   * next physics substep starts a FRESH prediction batch — no stale sample
   * survives.
   */
  private readonly handleInputCleared = (): void => {
    this.playerController.resetJumpState();
    this.prediction.clearAndSendNeutral({
      moveX: 0,
      moveZ: 0,
      lookYaw: this.cameraController.getYaw(),
      lookPitch: this.cameraController.getPitch(),
      jump: false,
    });
  };

  public start(): void {
    if (this.disposed) {
      throw new Error("Cannot start a disposed GameRuntime.");
    }

    if (this.started) {
      return;
    }

    window.addEventListener("resize", this.resizeEngine);
    this.engine.runRenderLoop(this.renderFrame);
    this.engine.resize();
    this.started = true;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    if (this.started) {
      window.removeEventListener("resize", this.resizeEngine);
      this.engine.stopRenderLoop(this.renderFrame);
      this.started = false;
    }

    // InputManager.dispose() clears input, synchronously sending one final
    // neutral frame while the clear subscription and controllers still live.
    this.inputManager.dispose();
    this.unsubscribeInputCleared();
    // Stop observing the page-lifetime network so no listener leaks after the
    // runtime is gone (the network itself lives on for the page).
    this.unsubscribeNetwork();
    this.playerController.dispose();
    this.cameraController.dispose();
    this.scene.dispose();
    this.engine.dispose();
    this.disposed = true;
  }
}
