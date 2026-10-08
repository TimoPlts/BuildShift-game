import { useEffect, useRef, useState } from "react";
import { MatchPhase } from "@buildshift/protocol";
import { GameRuntime } from "./GameRuntime";
import type { MatchHudProps } from "../ui/MatchHud";
import { GameHud } from "../ui/hud/GameHud";
import type { LocalHudView } from "./localHudView";
import { mapMatchStateToHudProps } from "./matchHudMapper";
import { buildMatchLifecycleView, type MatchLifecycleView } from "./matchLifecycleView";
import type { ParsedMatchState } from "./network";

/**
 * Actions exposed by the game runtime for match lifecycle control.
 */
export interface GameRuntimeActions {
  leaveRoom: () => void;
  rejoinRoom: () => Promise<void>;
  /**
   * Request a rematch after the match has ended.
   *
   * Routes through the runtime's canonical rematch command without leaving
   * the authoritative room.
   * The parent (e.g. App) calls this from the MatchEndScreen's
   * "Play Again" / "Rematch" button.
   */
  requestRematch: () => boolean;
}

/**
 * Props for the GameCanvas component.
 */
export interface GameCanvasProps {
  /**
   * Callback invoked whenever the match lifecycle view changes.
   * The parent uses this to render the correct screen overlay.
   */
  onMatchLifecycleChange?: (view: MatchLifecycleView) => void;
  /**
   * Callback invoked once when the game runtime is ready,
   * providing the action methods for room lifecycle control.
   */
  onRuntimeReady?: (actions: GameRuntimeActions) => void;
}

/**
 * React owns the canvas mount point, the crosshair, and the pointer-lock
 * instruction overlay. It never owns camera transforms, player position,
 * mouse deltas, or movement simulation — those stay in the game runtime.
 */
export function GameCanvas({ onMatchLifecycleChange, onRuntimeReady }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [matchHudProps, setMatchHudProps] = useState<MatchHudProps | null>(null);
  const [localHud, setLocalHud] = useState<LocalHudView | null>(null);
  const onLifecycleChangeRef = useRef(onMatchLifecycleChange);
  const onRuntimeReadyRef = useRef(onRuntimeReady);
  onLifecycleChangeRef.current = onMatchLifecycleChange;
  onRuntimeReadyRef.current = onRuntimeReady;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let active = true;
    let runtime: GameRuntime | undefined;
    let unsubMatch: (() => void) | undefined;
    let unsubLocalHud: (() => void) | undefined;

    GameRuntime.create(canvas)
      .then((r) => {
        if (!active) {
          r.dispose();
          return;
        }
        runtime = r;
        r.start();

        // Prime the local HUD (vitals, energy, weapon, build state) from the
        // runtime's existing authoritative / predicted sources.
        setLocalHud(r.getLocalHudView());

        // Build and emit the initial lifecycle view (disconnected state).
        const initialView = buildMatchLifecycleView(
          r.getMatchState(),
          r.getSessionId(),
          r.getCountdownSeconds(),
          r.connected,
        );
        onLifecycleChangeRef.current?.(initialView);

        // Notify parent that runtime actions are available, including the
        // canonical in-room rematch action.
        onRuntimeReadyRef.current?.({
          leaveRoom: () => r.leaveRoom(),
          rejoinRoom: () => r.rejoinRoom(),
          requestRematch: () => r.requestRematch(),
        });

        // Subscribe to the authoritative match-state updates (score / phase /
        // banners) and to the runtime's local HUD snapshots (vitals, energy,
        // weapon, build state, authoritative round timer / countdown).
        unsubLocalHud = r.onLocalHudChange(setLocalHud);
        unsubMatch = r.onMatchStateChange((state: ParsedMatchState) => {
          const sid = r.getSessionId();
          if (!sid) return;

          // Build the lifecycle view to derive countdown and connection state.
          const view = buildMatchLifecycleView(
            state,
            sid,
            r.getCountdownSeconds(),
            r.connected,
          );

          // Wire the full lifecycle-derived props into the presentation-only
          // MatchHud: base score/phase data plus the optional countdown and
          // waiting-for-opponent indicator.
          const baseHud = mapMatchStateToHudProps(state, sid);
          setMatchHudProps({
            ...baseHud,
            waitingForOpponent:
              r.connected &&
              state.matchPhase === MatchPhase.COUNTDOWN &&
              state.currentRound === 0,
          });

          // Propagate the lifecycle view to the parent for overlay screens.
          onLifecycleChangeRef.current?.(view);
        });
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
      unsubMatch?.();
      unsubLocalHud?.();
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
      {matchHudProps !== null && <GameHud match={matchHudProps} local={localHud} />}
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
          <p>1v1 Energy Box Fight — first to 3 round wins takes the match</p>
        </div>
      )}
    </>
  );
}
