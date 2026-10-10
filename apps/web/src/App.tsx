import { useState, useCallback, useRef } from "react";
import { GameCanvas, type GameRuntimeActions } from "./game/GameCanvas";
import type { MatchLifecycleView } from "./game/matchLifecycleView";
import {
  CountdownOverlay,
  RoundEndBanner,
  MatchEndScreen,
} from "./ui";
import { useMatchPresentation } from "./ui/useMatchPresentation";

/**
 * App — the top-level BuildShift 1v1 Energy Box Fight shell.
 *
 * Wires the full match lifecycle screen transitions through the single
 * presentation layer (`useMatchPresentation`), which derives every moment
 * exclusively from the authoritative, normalized match lifecycle view:
 *
 *  - COUNTDOWN  → game view + CountdownOverlay (the only countdown display)
 *  - PLAYING    → normal gameplay (in-game HUD only)
 *  - ROUND_OVER → game view + RoundEndBanner (enter/hold/exit lifecycle;
 *                 the banner keeps rendering briefly after the phase moves
 *                 on so its exit transition can complete)
 *  - MATCH_OVER → MatchEndScreen (full-screen result, final score, and the
 *                 rematch-readiness state counting down from the
 *                 authoritative match-end moment)
 *
 * The in-game HUD (inside GameCanvas) presents only persistent, non-blocking
 * information (score, round, timer, phase) and never doubles a lifecycle
 * moment presented here.
 */
export function App() {
  const [lifecycle, setLifecycle] = useState<MatchLifecycleView | null>(null);
  const actionsRef = useRef<GameRuntimeActions | null>(null);

  const presentation = useMatchPresentation(lifecycle);

  const handleLifecycleChange = useCallback((view: MatchLifecycleView) => {
    setLifecycle(view);
  }, []);

  const handleRuntimeReady = useCallback((actions: GameRuntimeActions) => {
    actionsRef.current = actions;
  }, []);

  const handlePlayAgain = useCallback(() => {
    actionsRef.current?.requestRematch();
  }, []);

  const handleLeave = useCallback(() => {
    actionsRef.current?.leaveRoom();
  }, []);

  return (
    <main className="game-shell">
      <GameCanvas
        onMatchLifecycleChange={handleLifecycleChange}
        onRuntimeReady={handleRuntimeReady}
      />

      {/* ── Pre-round countdown / round-intro (the only countdown UI) ── */}
      {presentation.countdownSeconds > 0 && (
        <CountdownOverlay
          remainingSeconds={presentation.countdownSeconds}
          roundNumber={presentation.roundNumber}
          visible={true}
          phase="counting"
        />
      )}

      {/* ── Post-countdown "GO!" transition to live play ── */}
      {presentation.goTransition && (
        <CountdownOverlay
          remainingSeconds={0}
          visible={true}
          phase="go"
        />
      )}

      {/* ── Round win/loss banner (mounted through its exit transition) ── */}
      {presentation.roundResult !== null && (
        <RoundEndBanner
          localWon={presentation.roundResult.localWon}
          visible={presentation.roundResultVisible}
          roundNumber={presentation.roundResult.roundNumber}
          localScore={presentation.roundResult.localScore}
          remoteScore={presentation.roundResult.remoteScore}
        />
      )}

      {/* ── Final victory/defeat screen with the rematch state ── */}
      {presentation.matchResult !== null && (
        <MatchEndScreen
          localWon={presentation.matchResult.localWon}
          localScore={presentation.matchResult.localScore}
          remoteScore={presentation.matchResult.remoteScore}
          totalRounds={presentation.matchResult.totalRounds}
          rematchAvailable={presentation.rematchAvailable}
          rematchWindowSeconds={presentation.rematchWindowSeconds}
          onPlayAgain={handlePlayAgain}
          onLeave={handleLeave}
        />
      )}
    </main>
  );
}
