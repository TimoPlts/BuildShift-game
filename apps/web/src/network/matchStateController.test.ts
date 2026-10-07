/**
 * Unit tests for the MatchStateController (via network-layer re-export).
 * The canonical tests live in game/player/matchStateController.test.ts.
 */
import { describe, expect, it } from "vitest";
import { RoundState } from "@buildshift/protocol";
import { MatchStateController } from "./matchStateController";

describe("MatchStateController (network re-export) — basic", () => {
  it("starts in COUNTDOWN", () => {
    const c = new MatchStateController();
    expect(c.state).toBe(RoundState.COUNTDOWN);
    expect(c.inputEnabled).toBe(false);
    expect(c.predictionActive).toBe(false);
  });

  it("resetPrediction() is available and functional", () => {
    const c = new MatchStateController();
    c.setServerState(RoundState.PLAYING);
    expect(c.predictionActive).toBe(true);
    c.resetPrediction();
    expect(c.predictionActive).toBe(false);
  });

  it("full lifecycle works", () => {
    const c = new MatchStateController();
    c.setServerState(RoundState.PLAYING);
    c.setServerState(RoundState.ROUND_OVER);
    c.setServerState(RoundState.MATCH_OVER, "w");
    expect(c.matchOver).toBe(true);
  });
});
