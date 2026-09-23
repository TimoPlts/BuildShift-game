import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import { InputManager } from "./input/InputManager";
import { PlayerController } from "./player/PlayerController";
import { createFoundationScene } from "./scene/createFoundationScene";

const MAX_FRAME_DELTA_SECONDS = 0.1;

/** Owns the Babylon engine, scene, render loop, and browser lifecycle hooks. */
export class GameRuntime {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly inputManager: InputManager;
  private readonly playerController: PlayerController;
  private readonly renderFrame: () => void;
  private readonly resizeEngine: () => void;
  private started = false;
  private disposed = false;

  public constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true);

    try {
      this.scene = createFoundationScene(this.engine, canvas);
      this.inputManager = new InputManager();
      try {
        this.playerController = new PlayerController(this.scene, this.inputManager);
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
        this.playerController.update(deltaSeconds);
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
    this.inputManager.dispose();
    this.scene.dispose();
    this.engine.dispose();
    this.disposed = true;
  }
}
