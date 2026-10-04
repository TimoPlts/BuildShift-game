import { useState, useCallback, useRef } from "react";
import { RoundState } from "@buildshift/protocol";
import { GameCanvas, type GameRuntimeActions } from "./game/GameCanvas";
import type { MatchLifecycleView } from "./game/matchLifecycleView";
import {
  CountdownOverlay,
  RoundEndBanner,
  MatchEndScreen,
} from "./ui";

/**
 * App — the top-level BuildShift 1v1 Energy Box Fight shell.
 *
 * Wires the full match lifecycle screen transitions:
 *  - COUNTDOWN  → game view + CountdownOverlay
 *  - PLAYING    → normal gameplay
 *  - ROUND_OVER → game view + RoundEndBanner
 *  - MATCH_OVER → MatchEndScreen (full-screen result with actions)
 *
 * The GameCanvas owns the game runtime (Babylon scene, physics, network).
 * App subscribes to the normalized MatchLifecycleView via a callback and
 * renders the appropriate presentation overlay on top of the canvas.
 */
export function App() {
  const [lifecycle, setLifecycle] = useState<MatchLifecycleView | null>(null);
  const actionsRef = useRef<GameRuntimeActions | null>(null);

  const handleLifecycleChange = useCallback((view: MatchLifecycleView) => {
    setLifecycle(view);
  }, []);

  const handleRuntimeReady = useCallback((actions: GameRuntimeActions) => {
    actionsRef.current = actions;
  }, []);

  const handlePlayAgain = useCallback(() => {
    actionsRef.current?.rejoinRoom();
  }, []);

  const handleLeave = useCallback(() => {
    actionsRef.current?.leaveRoom();
  }, []);

  const { roundState, connected } = lifecycle ?? {
    roundState: RoundState.COUNTDOWN,
    connected: false,
  };

  return (
    <main className="game-shell">
      <GameCanvas
        onMatchLifecycleChange={handleLifecycleChange}
        onRuntimeReady={handleRuntimeReady}
      />

      {/* ── Match lifecycle overlays (only when connected) ── */}
      {connected && (
        <>
          {/* COUNTDOWN: show the pre-round countdown over the game view */}
          {roundState === RoundState.COUNTDOWN && lifecycle && (
            <CountdownOverlay
              remainingSeconds={lifecycle.countdownRemainingSeconds}
              visible={true}
            />
          )}

          {/* ROUND_OVER: show the round result banner over the game view */}
          {roundState === RoundState.ROUND_OVER && lifecycle && lifecycle.localWonLastRound !== null && (
            <RoundEndBanner
              localWon={lifecycle.localWonLastRound}
              visible={true}
              roundNumber={lifecycle.currentRound}
            />
          )}

          {/* MATCH_OVER: show the full match end screen */}
          {roundState === RoundState.MATCH_OVER && lifecycle && lifecycle.localWonMatch !== null && (
            <MatchEndScreen
              localWon={lifecycle.localWonMatch}
              localScore={lifecycle.localScore}
              remoteScore={lifecycle.remoteScore}
              onPlayAgain={handlePlayAgain}
              onLeave={handleLeave}
            />
          )}
        </>
      )}
    </main>
  );
}
