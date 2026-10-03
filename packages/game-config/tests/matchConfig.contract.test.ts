/**
 * Contract tests for match configuration constants.
 *
 * Validates the game-config match/round constants that drive the match
 * lifecycle: the win threshold and timing values.
 */
import { describe, expect, it } from "vitest";
import {
  WIN_ROUNDS,
  ROUNDS_TO_WIN,
  ROUND_COUNTDOWN_SECONDS,
  ROUND_RESET_DELAY_SECONDS,
} from "@buildshift/game-config";

// ─────────────────────────────────────────────────────────────────────────────
// WIN_ROUNDS constant
// ─────────────────────────────────────────────────────────────────────────────

describe("WIN_ROUNDS (match win threshold)", () => {
  it("equals 3 (first-to-3 match)", () => {
    expect(WIN_ROUNDS).toBe(3);
  });

  it("is a positive integer", () => {
    expect(Number.isInteger(WIN_ROUNDS)).toBe(true);
    expect(WIN_ROUNDS).toBeGreaterThan(0);
  });

  it("ROUNDS_TO_WIN is an alias for WIN_ROUNDS (backward compat)", () => {
    expect(ROUNDS_TO_WIN).toBe(WIN_ROUNDS);
    expect(ROUNDS_TO_WIN).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round timing constants
// ─────────────────────────────────────────────────────────────────────────────

describe("ROUND_COUNTDOWN_SECONDS", () => {
  it("is a positive number", () => {
    expect(typeof ROUND_COUNTDOWN_SECONDS).toBe("number");
    expect(ROUND_COUNTDOWN_SECONDS).toBeGreaterThan(0);
  });
});

describe("ROUND_RESET_DELAY_SECONDS", () => {
  it("is a positive number", () => {
    expect(typeof ROUND_RESET_DELAY_SECONDS).toBe("number");
    expect(ROUND_RESET_DELAY_SECONDS).toBeGreaterThan(0);
  });
});
