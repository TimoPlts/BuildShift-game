import { useEffect, useRef, useState } from "react";
import { GameRuntime } from "./GameRuntime";

/**
 * React owns the canvas mount point, the crosshair, and the pointer-lock
 * instruction overlay. It never owns camera transforms, player position,
 * mouse deltas, or movement simulation — those stay in the game runtime.
 * The overlay only mirrors the browser's own pointer-lock state through a
 * single `pointerlockchange` listener for UI purposes.
 */
export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pointerLocked, setPointerLocked] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const runtime = new GameRuntime(canvas);
    runtime.start();

    const handlePointerLockChange = () => {
      setPointerLocked(document.pointerLockElement === canvas);
    };
    handlePointerLockChange();
    document.addEventListener("pointerlockchange", handlePointerLockChange);

    return () => {
      document.removeEventListener("pointerlockchange", handlePointerLockChange);
      runtime.dispose();
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="game-canvas"
        aria-label="BuildShift 3D game viewport"
      />
      {pointerLocked && <div className="crosshair" aria-hidden="true" />}
      {!pointerLocked && (
        <div className="pointer-lock-overlay">
          <strong>Click to play</strong>
          <p>WASD to move • Mouse to look • Esc to release</p>
        </div>
      )}
    </>
  );
}
