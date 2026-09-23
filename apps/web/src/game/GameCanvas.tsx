import { useEffect, useRef } from "react";
import { GameRuntime } from "./GameRuntime";

/** React owns only the canvas mount point; Babylon owns the 3D lifecycle. */
export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const runtime = new GameRuntime(canvas);
    runtime.start();

    return () => {
      runtime.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="game-canvas"
      aria-label="BuildShift 3D game viewport"
    />
  );
}
