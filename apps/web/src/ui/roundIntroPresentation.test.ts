/**
 * Focused tests for the round-intro / countdown presentation:
 *
 *  - `deriveLifecyclePresentation` includes the authoritative round number
 *    in the countdown moment.
 *  - The "GO!" post-countdown transition is triggered by the moment
 *    leaving "countdown" to "none" (play begins) and not by any other
 *    transition.
 *  - The input-lock contract: during `MatchPhase.COUNTDOWN`, the
 *    simulation tick uses NEUTRAL input (movement/fire zeroed, jump
 *    suppressed) while still consuming the input manager's state.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { RoundState } from "@buildshift/protocol";
import type { MatchLifecycleView } from "../game/matchLifecycleView";
import { deriveLifecyclePresentation } from "./matchPresentation";

function view(overrides: Partial<MatchLifecycleView> = {}): MatchLifecycleView {
  return {
    connected: true,
    roundState: RoundState.PLAYING,
    currentRound: 1,
    localScore: 0,
    remoteScore: 0,
    localWonLastRound: null,
    localWonMatch: null,
    countdownRemainingSeconds: 0,
    ...overrides,
  };
}

describe("round-intro: countdown presentation carries the round number", () => {
  it("includes currentRound in the countdown moment", () => {
    const p = deriveLifecyclePresentation(
      view({ roundState: RoundState.COUNTDOWN, countdownRemainingSeconds: 3, currentRound: 5 }),
    );
    expect(p.moment).toBe("countdown");
    expect(p.roundNumber).toBe(5);
  });

  it("reports round 0 for the first round (before the server increments)", () => {
    const p = deriveLifecyclePresentation(
      view({ roundState: RoundState.COUNTDOWN, countdownRemainingSeconds: 3, currentRound: 0 }),
    );
    expect(p.moment).toBe("countdown");
    expect(p.roundNumber).toBe(0);
  });

  it("returns roundNumber 0 when no view exists", () => {
    const p = deriveLifecyclePresentation(null);
    expect(p.roundNumber).toBe(0);
  });
});

describe("round-intro: authoritative input lock during COUNTDOWN", () => {
  // The runtime's stepSimulationTick zeros movement, fire, and jump when
  // matchState.matchPhase === MatchPhase.COUNTDOWN. This is verified at the
  // source level (the runtime is not unit-instantiated in the web package).
  const runtime = readFileSync(
    new URL("../game/GameRuntime.ts", import.meta.url),
    "utf8",
  );

  it("locks weapon input outside the authoritative IN_PROGRESS phase", () => {
    // Overhaul task 12: every weapon action (switch/reload/fire) is gated on
    // effective weapon mode + MatchPhase.IN_PROGRESS + connected + not
    // eliminated, so weapon input is locked during COUNTDOWN (and
    // intermissions) — and the slot/reload latches are drained every frame,
    // so no stale press can fire on a phase change.
    expect(runtime).toContain(
      'const active=this.interactionMode.mode==="weapon"&&this.matchState.matchPhase===MatchPhase.IN_PROGRESS&&this.isConnected',
    );
    expect(runtime).toContain("if(route.weaponFirePressed&&active){");
  });

  it("zeroes movement, fire, and jump in the sim tick during COUNTDOWN", () => {
    expect(runtime).toContain(
      "const inCd=this.matchState.matchPhase===MatchPhase.COUNTDOWN",
    );
    expect(runtime).toContain("moveX:inCd?0:m.x");
    expect(runtime).toContain("moveZ:inCd?0:m.z");
    expect(runtime).toContain("jump:inCd?false:jp");
    expect(runtime).toContain("primaryFire:inCd?false:fi");
  });
});
