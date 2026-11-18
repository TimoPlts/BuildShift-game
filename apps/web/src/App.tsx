import { useState, useCallback, useRef, useMemo } from "react";
import { GameCanvas, type GameRuntimeActions } from "./game/GameCanvas";
import type { MatchLifecycleView } from "./game/matchLifecycleView";
import {
  CountdownOverlay,
  PreparationBanner,
  RoundEndBanner,
  MatchEndScreen,
  derivePreparationUi,
  FIGHT_CUE_LABEL,
} from "./ui";
import { useMatchPresentation } from "./ui/useMatchPresentation";
import { AiChatPanel } from "./ui/ai-chat";

/**
 * App — the top-level BuildShift 1v1 Energy Box Fight shell.
 *
 * Wires the full match lifecycle screen transitions through the single
 * presentation layer (`useMatchPresentation`), which derives every moment
 * exclusively from the authoritative, normalized match lifecycle view:
 *
 *  - COUNTDOWN + preparation → game view + PreparationBanner (BUILD phase: the
 *    authoritative preparation countdown is the only clock in the game, and
 *    the strip stays pointer-transparent so the arena stays visible/buildable)
 *  - COUNTDOWN, room not full → the same strip reads "WAITING FOR OPPONENT"
 *  - the instant preparation ends → a brief FIGHT gate-opening cue
 *  - PLAYING    → normal gameplay (in-game HUD only, **no round timer**: a
 *    round ends on an authoritative elimination or the leaving/forfeit
 *    exception, never on time)
 *  - ROUND_OVER → game view + RoundEndBanner (enter/hold/exit lifecycle;
 *                 the banner keeps rendering briefly after the phase moves
 *                 on so its exit transition can complete)
 *  - MATCH_OVER → MatchEndScreen (full-screen result, final score, and the
 *                 rematch-readiness state counting down from the
 *                 authoritative match-end moment)
 *
 * The in-game HUD (inside GameCanvas) presents only persistent, non-blocking
 * information (score, round, phase) and never doubles a lifecycle moment
 * presented here.
 */
export function App() {
  const [lifecycle, setLifecycle] = useState<MatchLifecycleView | null>(null);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const actionsRef = useRef<GameRuntimeActions | null>(null);

  const presentation = useMatchPresentation(lifecycle);

  // The build-preparation moment, derived from the same authoritative
  // lifecycle view (waiting / preparing / ready) — see preparationPresentation.
  const preparation = useMemo(() => derivePreparationUi(lifecycle), [lifecycle]);

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

  /**
   * Gameplay-input suppression seam: while the AI Guide chat input is
   * focused, gameplay controls must not fire; blur / close / unmount
   * restore normal input.
   */
  const handleAiChatInputFocus = useCallback((focused: boolean) => {
    actionsRef.current?.setGameplayInputSuppressed(focused);
  }, []);

  return (
    <main className="game-shell">
      <GameCanvas
        onMatchLifecycleChange={handleLifecycleChange}
        onRuntimeReady={handleRuntimeReady}
      />

      {/* ── Build-preparation phase: waiting for a second player, then the
            compact BUILD strip with the only countdown the player sees.
            Non-blocking and pointer-transparent on purpose: the arena (and the
            player's own prebuilt structures) stay visible and buildable. ── */}
      <PreparationBanner
        mode={preparation.mode}
        remainingSeconds={preparation.remainingSeconds}
        sideHint={preparation.sideHint}
        roundNumber={preparation.roundNumber}
      />

      {/* ── Gate-opening cue when the barriers drop and play begins ── */}
      {presentation.goTransition && (
        <CountdownOverlay
          remainingSeconds={0}
          visible={true}
          phase="go"
          goLabel={FIGHT_CUE_LABEL}
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

      {/* ── In-game AI Guide / How-to-Play chat (mocked backend in tests) ──
       * Mounted at page level so the conversation (and its conversation id)
       * stays alive for the whole session, open or closed. */}
      <AiChatPanel
        open={aiChatOpen}
        onOpenChange={setAiChatOpen}
        onInputFocusChange={handleAiChatInputFocus}
      />
    </main>
  );
}
