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

    // StrictMode in dev mounts effects twice; we guard with a local "active"
    // flag so a stale (first) mount that never resolves can't leak resources.
    let active = true;
    let runtime: GameRuntime | undefined;

    GameRuntime.create(canvas)
      .then((r) => {
        if (!active) {
          r.dispose();
          return;
        }
        runtime = r;
        r.start();
      })
      .catch((error) => {
        console.error("Failed to start the game runtime:", error);
      });

    const handlePointerLockChange = () => {
      setPointerLocked(document.pointerLockElement === canvas);
    };
    handlePointerLockChange();
    document.addEventListener("pointerlockchange", handlePointerLockChange);

    return () => {
      active = false;
      document.removeEventListener("pointerlockchange", handlePointerLockChange);
      runtime?.dispose();
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
          <ul className="control-hints" aria-label="Controls">
            <li>
              <kbd>W A S D</kbd> move
            </li>
            <li>
              <kbd>Mouse</kbd> look
            </li>
            <li>
              <kbd>Space</kbd> jump
            </li>
            <li>
              <kbd>Esc</kbd> unlock cursor
            </li>
          </ul>
          <p>Physics playground: test movement, sliding, gravity and jumps</p>
        </div>
      )}
    </>
  );
}
