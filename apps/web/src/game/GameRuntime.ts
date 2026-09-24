import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import { ThirdPersonCameraController } from "./camera/ThirdPersonCameraController";
import { InputManager } from "./input/InputManager";
import { PlayerController } from "./player/PlayerController";
import { FIXED_DT } from "./physics/PhysicsWorld";
import { createFoundationScene } from "./scene/createFoundationScene";

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
 * 2. apply mouse look to the camera yaw/pitch
 * 3. update the player using the current camera yaw
 * 4. update the camera position from the new player position
 * 5. render the scene
 */
export class GameRuntime {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly inputManager: InputManager;
  private readonly cameraController: ThirdPersonCameraController;
  private readonly playerController: PlayerController;
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
        const playerController = await PlayerController.create(
          scene,
          inputManager,
        );
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

    this.renderFrame = () => {
      if (!this.scene.isDisposed) {
        const deltaSeconds = Math.min(
          Math.max(this.engine.getDeltaTime() / 1000, 0),
          MAX_FRAME_DELTA_SECONDS,
        );

        // 1. Camera look (consumed once per frame, independent of physics).
        const lookDelta = this.inputManager.consumeLookDelta();
        this.cameraController.applyLook(lookDelta.x, lookDelta.y);
        const cameraYaw = this.cameraController.getYaw();

        // 2. If raw input was cleared this frame (pointer lock released,
        //    window blurred, tab hidden, or disposed), drop the controller's
        //    buffered jump / coyote state so a stale buffered press can never
        //    fire on a later grounded step.
        if (this.inputManager.consumeInputCleared()) {
          this.playerController.resetJumpState();
        }

        // 3. Fixed-step physics: advance the character by whole 60 Hz steps,
        //    decoupling physics from the variable render rate for deterministic
        //    collision / gravity / jump behaviour. The jump key edge is polled
        //    *inside* each step (by PlayerController), not here at render time,
        //    so a press can never be consumed before a simulation step runs.
        //    The shared JumpController guarantees a single launch per press
        //    (buffer + coyote), so no double jump is possible even if the
        //    accumulator advances several steps in one frame.
        this.accumulator += deltaSeconds;
        let steps = 0;
        while (
          this.accumulator >= FIXED_DT &&
          steps < MAX_FIXED_STEPS_PER_FRAME
        ) {
          this.playerController.update(FIXED_DT, cameraYaw);
          this.accumulator -= FIXED_DT;
          steps += 1;
        }
        if (steps >= MAX_FIXED_STEPS_PER_FRAME) {
          // Spiral-of-death guard: drop the un-simulated remainder so a long
          // hitch can't stall the render loop.
          this.accumulator = 0;
        }

        // 4. Camera follows the character's feet (centre - half height).
        this.cameraController.update(this.playerController.getFeetPosition());

        // 5. Render.
        this.scene.render();
      }
    };
    this.resizeEngine = () => {
      this.engine.resize();
    };
  }

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

    this.playerController.dispose();
    this.cameraController.dispose();
    this.inputManager.dispose();
    this.scene.dispose();
    this.engine.dispose();
    this.disposed = true;
  }
}
