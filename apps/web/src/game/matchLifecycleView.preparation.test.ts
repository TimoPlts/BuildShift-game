/**
 * Unit coverage for the preparation fields on the authoritative
 * match-lifecycle view (R2 of the round-prep QA review): the replicated
 * room flag (`preparationActive`, parsed off the room state) and the local
 * player's replicated side (`preparationSide`, parsed off the local player
 * and handed to the builder per call) must reach the view on EVERY path —
 * first-round preparation, waiting, pause/resume inside COUNTDOWN, and the
 * reset / disconnect re-zeroing — so the presentation layer never has to
 * guess the moment from the round number alone.
 *
 * Pure tests over the real parser + real builder: no runtime, no DOM.
 */
import { MatchPhase, RoundState } from "@buildshift/protocol";
import { describe, expect, it } from "vitest";
import { buildMatchLifecycleView } from "./matchLifecycleView";
import { parseMatchState } from "./network/matchStateParse";
import { parsePlayerEntry } from "./network/playerStateParse";

/** Raw wire-shaped room fields for a fresh COUNTDOWN (round 0) room. */
function rawRoom(preparationActive?: unknown, currentRound = 0) {
  return {
    matchPhase: MatchPhase.COUNTDOWN,
    roundScore: { "session-a": 0, "session-b": 0 },
    currentRound,
    preparationActive,
  };
}

describe("buildMatchLifecycleView preparation fields", () => {
  it("first preparation (currentRound 0) carries preparing data, not waiting data", () => {
    const parsed = parseMatchState(rawRoom(true));
    const local = parsePlayerEntry({
      x: -10, y: 1, z: 0, yaw: 0, velocityY: 0,
      preparationSide: "negative",
    });
    const view = buildMatchLifecycleView(
      parsed,
      "session-a",
      8,
      true,
      local?.preparationSide ?? "",
    );
    // The banner's "preparing" inputs exist even though currentRound is 0:
    // anything keying round display off the round number must instead trust
    // preparationActive (QA risk note).
    expect(view.roundState).toBe(RoundState.COUNTDOWN);
    expect(view.currentRound).toBe(0);
    expect(view.preparationActive).toBe(true);
    expect(view.preparationSide).toBe("negative");
    expect(view.countdownRemainingSeconds).toBe(8);
  });

  it("a half-filled room (no replicated flag) stays waiting with no side", () => {
    // The server only sets preparationActive once BOTH players are present;
    // a missing / non-literal-true value parses to `false` (waiting).
    const parsed = parseMatchState(rawRoom(undefined));
    const view = buildMatchLifecycleView(parsed, "session-a", 8, true, "");
    expect(view.preparationActive).toBe(false);
    expect(view.preparationSide).toBe("");
    expect(view.currentRound).toBe(0);
  });

  it("side-hint data passes through for both vocabulary values", () => {
    for (const side of ["negative", "positive"] as const) {
      const parsed = parseMatchState(rawRoom(true));
      const local = parsePlayerEntry({
        x: 10, y: 1, z: 0, yaw: 0, velocityY: 0, preparationSide: side,
      });
      const view = buildMatchLifecycleView(
        parsed, "session-a", 5, true, local?.preparationSide ?? "",
      );
      expect(view.preparationSide).toBe(side);
    }
    // Non-string wires default to empty — the client never invents a side.
    // (Unknown STRING values pass through verbatim by parser contract; the
    // runtime gate whitelists them and the banner's side hint renders null,
    // so no row is ever guessed.)
    const malformed = parsePlayerEntry({
      x: 0, y: 1, z: 0, yaw: 0, velocityY: 0, preparationSide: 7,
    });
    expect(malformed?.preparationSide).toBe("");
  });

  it("preparation pause / resume inside COUNTDOWN round 0 re-projects every emission", () => {
    // Same phase, same scores, same round — ONLY the replicated preparation
    // flag (and the current side) toggles. The builder is pure, so every
    // snapshot's values are reflected with nothing carried over.
    const parsed = buildMatchLifecycleView(
      parseMatchState(rawRoom(true)), "session-a", 6, true, "positive",
    );
    expect(parsed.preparationActive).toBe(true);
    expect(parsed.preparationSide).toBe("positive");

    const paused = buildMatchLifecycleView(
      parseMatchState(rawRoom(false)), "session-a", 6, true, "",
    );
    expect(paused.preparationActive).toBe(false);
    expect(paused.preparationSide).toBe("");

    const resumed = buildMatchLifecycleView(
      parseMatchState(rawRoom(true)), "session-a", 4, true, "positive",
    );
    expect(resumed.preparationActive).toBe(true);
    expect(resumed.preparationSide).toBe("positive");
    // Nothing else moved — the toggle alone is the state change.
    expect(resumed.roundState).toBe(RoundState.COUNTDOWN);
    expect(resumed.currentRound).toBe(0);
  });

  it("stale preparation fields reset on the next round and on disconnect", () => {
    // Next round opened without preparation (grace window): the fresh
    // snapshot's values win — no sticky "preparing".
    const nextRound = buildMatchLifecycleView(
      parseMatchState({
        matchPhase: MatchPhase.COUNTDOWN,
        roundScore: { "session-a": 1, "session-b": 0 },
        currentRound: 1,
        preparationActive: false,
      }),
      "session-a",
      0,
      true,
      "",
    );
    expect(nextRound.preparationActive).toBe(false);
    expect(nextRound.preparationSide).toBe("");
    expect(nextRound.currentRound).toBe(1);

    // Disconnect: the side hint is zeroed with the countdown.
    const disconnected = buildMatchLifecycleView(
      parseMatchState(rawRoom(true)), "session-a", 8, false, "negative",
    );
    expect(disconnected.preparationSide).toBe("");

    // Fresh / never-joined room state parses preparation-free.
    const fresh = buildMatchLifecycleView(
      parseMatchState({}), null, 0, false, "",
    );
    expect(fresh.preparationActive).toBe(false);
    expect(fresh.preparationSide).toBe("");
  });
});
