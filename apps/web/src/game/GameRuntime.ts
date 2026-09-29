import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import { PHYSICS_TIMING } from "@buildshift/game-config";
import { ThirdPersonCameraController } from "./camera/ThirdPersonCameraController";
import { InputManager } from "./input/InputManager";
import { PlayerController } from "./player/PlayerController";
import { PredictionInputBatcher } from "./network/predictionInputBatcher";
import {
  runPredictionSubstep,
} from "./network/predictionStep";
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
 * 1. consume input (keyboard state + accumulated mouse delta)
 * 2. apply mouse look to the camera yaw/pitch (render-rate, never 30 Hz)
 * 3. advance the fixed-step prediction loop: every TWO 1/60 substeps is one
 *    prediction batch — capture one input sample at the first substep, send
 *    it once to the server (30 Hz), and reuse the SAME sample (with the jump
 *    edge only on substep 1) for both local substeps, mirroring the
 *    authoritative server's "one frame → two substeps" cadence
 * 4. update the camera position from the new player position
 * 5. render the scene
 */
export class GameRuntime {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly inputManager: InputManager;
  private readonly cameraController: ThirdPersonCameraController;
  private readonly playerController: PlayerController;
  /**
   * Owns the two-substep prediction cadence (one 30 Hz sample per two local
   * 1/60 substeps). The capture callback is a closure over the live browser
   * input; it is invoked exactly once per batch by the batcher.
   */
  private readonly predictionInputBatcher: PredictionInputBatcher;
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
    // One input snapshot per prediction batch: held movement keys, the
    // camera's current yaw/pitch (the third-person camera keeps updating at
    // render rate), and ONE polled jump edge. The SAME sample drives both
    // local substeps and the single 30 Hz network send, so local prediction
    // and the authoritative frame can never disagree.
    this.predictionInputBatcher = new PredictionInputBatcher(() => {
      const movement = this.inputManager.getMovementInput();
      return {
        moveX: movement.x,
        moveZ: movement.z,
        lookYaw: this.cameraController.getYaw(),
        lookPitch: this.cameraController.getPitch(),
        jump: this.inputManager.pollJumpPressed(),
      };
    });
    this.unsubscribeInputCleared = this.inputManager.subscribeInputCleared(
      this.handleInputCleared,
    );

    this.renderFrame = () => {
      if (!this.scene.isDisposed) {
        const deltaSeconds = Math.min(
          Math.max(this.engine.getDeltaTime() / 1000, 0),
          MAX_FRAME_DELTA_SECONDS,
        );

        // 1. Camera look (consumed once per frame, independent of physics).
        //    The third-person camera keeps updating at render rate; the
        //    prediction batcher snapshots its yaw/pitch once per batch.
        const lookDelta = this.inputManager.consumeLookDelta();
        this.cameraController.applyLook(lookDelta.x, lookDelta.y);

        // 2. Fixed-step prediction: advance the character by whole 1/60
        //    substeps, decoupling physics from the variable render rate for
        //    deterministic collision / gravity / jump behaviour. Every two
        //    substeps is one prediction batch: the batcher captures one input
        //    sample on the first substep and reuses it for the second (the
        //    jump edge is forwarded to the simulation only on substep 1), and
        //    exactly one 30 Hz network send is issued per batch — mirroring
        //    the authoritative server's "one frame → two substeps" cadence.
        //    The shared JumpController guarantees a single launch per press
        //    (buffer + coyote), so no double jump is possible even if the
        //    accumulator advances several steps in one frame.
        this.accumulator += deltaSeconds;
        let steps = 0;
        while (
          this.accumulator >= FIXED_DT &&
          steps < MAX_FIXED_STEPS_PER_FRAME
        ) {
          const { sendSample, sample } = runPredictionSubstep({
            deltaSeconds: FIXED_DT,
            batcher: this.predictionInputBatcher,
            simulation: this.playerController,
          });
          if (sendSample) {
            this.foundationNetwork.sendSequencedPlayerInput(sample);
          }
          this.accumulator -= FIXED_DT;
          steps += 1;
        }
        if (steps >= MAX_FIXED_STEPS_PER_FRAME) {
          // Spiral-of-death guard: drop the un-simulated remainder so a long
          // hitch can't stall the render loop.
          this.accumulator = 0;
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
   */
  private readonly handleInputCleared = (): void => {
    this.playerController.resetJumpState();
    // Discard any open/partial prediction batch so the next substep captures
    // fresh (now neutral) input instead of replaying a stale sample.
    this.predictionInputBatcher.reset();
    this.foundationNetwork.sendSequencedPlayerInput({
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
    this.playerController.dispose();
    this.cameraController.dispose();
    this.scene.dispose();
    this.engine.dispose();
    this.disposed = true;
  }
}
