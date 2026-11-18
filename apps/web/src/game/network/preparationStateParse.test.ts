/**
 * Replicated preparation signals (CONTRACT.md §4) parsing:
 *  - room `preparationActive` — a plain boolean, defensive default false;
 *  - player `preparationSide` — "negative" / "positive" string, empty before
 *    assignment; the client NEVER invents a side for malformed wires.
 */
import { describe, expect, it } from "vitest";
import { parseMatchState } from "./matchStateParse";
import { parsePlayerEntry, parsePlayers } from "./playerStateParse";

const BASE_PLAYER = {
  x: 0,
  y: 1,
  z: 0,
  yaw: 0,
  velocityY: 0,
  lastProcessedSequence: 0,
};

describe("parseMatchState.preparationActive", () => {
  it("defaults to false for missing / malformed / non-true values", () => {
    expect(parseMatchState({}).preparationActive).toBe(false);
    expect(parseMatchState(undefined).preparationActive).toBe(false);
    expect(
      parseMatchState({ matchPhase: "COUNTDOWN", preparationActive: "true" }).preparationActive,
    ).toBe(false);
    expect(
      parseMatchState({ matchPhase: "COUNTDOWN", preparationActive: 1 }).preparationActive,
    ).toBe(false);
  });

  it("is true only for a literal replicated true", () => {
    expect(
      parseMatchState({ matchPhase: "COUNTDOWN", preparationActive: true }).preparationActive,
    ).toBe(true);
  });
});

describe("parsePlayerEntry.preparationSide", () => {
  it("carries the assigned side verbatim", () => {
    expect(
      parsePlayerEntry({ ...BASE_PLAYER, preparationSide: "negative" })!.preparationSide,
    ).toBe("negative");
    expect(
      parsePlayerEntry({ ...BASE_PLAYER, preparationSide: "positive" })!.preparationSide,
    ).toBe("positive");
  });

  it("defaults to empty before assignment and for non-string wires", () => {
    expect(parsePlayerEntry({ ...BASE_PLAYER })!.preparationSide).toBe("");
    expect(
      parsePlayerEntry({ ...BASE_PLAYER, preparationSide: 7 })!.preparationSide,
    ).toBe("");
  });

  it("survives through parsePlayers", () => {
    const players = parsePlayers({
      players: [["s1", { ...BASE_PLAYER, preparationSide: "positive" }]],
    });
    expect(players.s1!.preparationSide).toBe("positive");
  });
});
