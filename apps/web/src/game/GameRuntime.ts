import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import { createFoundationScene } from "./scene/createFoundationScene";

/** Owns the Babylon engine, scene, render loop, and browser lifecycle hooks. */
export class GameRuntime {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly renderFrame: () => void;
  private readonly resizeEngine: () => void;
  private started = false;
  private disposed = false;

  public constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true);

    try {
      this.scene = createFoundationScene(this.engine, canvas);
    } catch (error) {
      this.engine.dispose();
      throw error;
    }

    this.renderFrame = () => {
      if (!this.scene.isDisposed) {
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

    this.scene.dispose();
    this.engine.dispose();
    this.disposed = true;
  }
}
