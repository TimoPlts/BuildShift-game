import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import { ThirdPersonCameraController } from "./camera/ThirdPersonCameraController";
import { InputManager } from "./input/InputManager";
import { PlayerController } from "./player/PlayerController";
import { createFoundationScene } from "./scene/createFoundationScene";

const MAX_FRAME_DELTA_SECONDS = 0.1;

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
  private started = false;
  private disposed = false;

  public constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true);

    try {
      this.scene = createFoundationScene(this.engine);
      this.inputManager = new InputManager(canvas);
      try {
        this.cameraController = new ThirdPersonCameraController(this.scene);
        try {
          this.playerController = new PlayerController(
            this.scene,
            this.inputManager,
          );
        } catch (error) {
          this.cameraController.dispose();
          throw error;
        }
      } catch (error) {
        this.inputManager.dispose();
        this.scene.dispose();
        throw error;
      }
    } catch (error) {
      this.engine.dispose();
      throw error;
    }

    this.renderFrame = () => {
      if (!this.scene.isDisposed) {
        // Temporary stalled-tab protection; authoritative fixed stepping comes later.
        const deltaSeconds = Math.min(
          Math.max(this.engine.getDeltaTime() / 1000, 0),
          MAX_FRAME_DELTA_SECONDS,
        );

        const lookDelta = this.inputManager.consumeLookDelta();
        this.cameraController.applyLook(lookDelta.x, lookDelta.y);

        const cameraYaw = this.cameraController.getYaw();
        this.playerController.update(deltaSeconds, cameraYaw);

        this.cameraController.update(this.playerController.getPosition());

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
