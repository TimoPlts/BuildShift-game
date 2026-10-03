/**
 * Protocol contract tests for match lifecycle types.
 *
 * Validates the protocol-level interfaces that both the authoritative server
 * and the client depend on for the 1v1 Energy Box Fight match loop:
 *
 * - `RoundState` enum vocabulary (COUNTDOWN, PLAYING, ROUND_OVER, MATCH_OVER)
 * - `MatchState` shape (state, roundNumber, score record with numeric values)
 * - `RoundResetPayload` shape (spawnPosition, resetHealth, resetEnergy, clearBuilds)
 * - `WIN_ROUNDS` constant equals 3 (first-to-3 match win threshold)
 *
 * These tests pin the wire contract so any silent rename or shape change
 * fails the build loudly.
 */
import { describe, expect, it } from "vitest";
import {
  RoundState,
  FIRST_TO_N,
  type MatchState,
  type RoundResetPayload,
} from "@buildshift/protocol";
import { WIN_ROUNDS } from "@buildshift/game-config";

// ─────────────────────────────────────────────────────────────────────────────
// RoundState enum
// ─────────────────────────────────────────────────────────────────────────────

describe("RoundState enum (match lifecycle vocabulary)", () => {
  it("includes COUNTDOWN", () => {
    expect(RoundState.COUNTDOWN).toBe("COUNTDOWN");
  });

  it("includes PLAYING", () => {
    expect(RoundState.PLAYING).toBe("PLAYING");
  });

  it("includes ROUND_OVER", () => {
    expect(RoundState.ROUND_OVER).toBe("ROUND_OVER");
  });

  it("includes MATCH_OVER", () => {
    expect(RoundState.MATCH_OVER).toBe("MATCH_OVER");
  });

  it("has exactly four lifecycle states", () => {
    const values = Object.values(RoundState);
    expect(values).toHaveLength(4);
    expect(values).toContain("COUNTDOWN");
    expect(values).toContain("PLAYING");
    expect(values).toContain("ROUND_OVER");
    expect(values).toContain("MATCH_OVER");
  });

  it("uses string values matching their key names (protocol stability)", () => {
    // The wire protocol relies on the string values being stable.
    // If a key is renamed, the string value must stay the same.
    expect(RoundState.COUNTDOWN).toBe("COUNTDOWN");
    expect(RoundState.PLAYING).toBe("PLAYING");
    expect(RoundState.ROUND_OVER).toBe("ROUND_OVER");
    expect(RoundState.MATCH_OVER).toBe("MATCH_OVER");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MatchState shape
// ─────────────────────────────────────────────────────────────────────────────

describe("MatchState interface (authoritative match state)", () => {
  it("includes a state field matching RoundState", () => {
    const state: MatchState = {
      state: RoundState.PLAYING,
      roundNumber: 1,
      score: { "player-a": 0, "player-b": 0 },
    };
    expect(state.state).toBe(RoundState.PLAYING);
  });

  it("includes a roundNumber field that is a positive integer", () => {
    const state: MatchState = {
      state: RoundState.COUNTDOWN,
      roundNumber: 1,
      score: {},
    };
    expect(typeof state.roundNumber).toBe("number");
    expect(state.roundNumber).toBeGreaterThanOrEqual(1);
  });

  it("includes a score record with numeric values keyed by player id", () => {
    const state: MatchState = {
      state: RoundState.PLAYING,
      roundNumber: 2,
      score: { "player-a": 1, "player-b": 0 },
    };
    expect(typeof state.score).toBe("object");
    expect(state.score["player-a"]).toBe(1);
    expect(state.score["player-b"]).toBe(0);
    // Verify all score values are numbers
    for (const [key, value] of Object.entries(state.score)) {
      expect(typeof value, `score["${key}"] must be a number`).toBe("number");
    }
  });

  it("supports a score record with multiple players at various counts", () => {
    const state: MatchState = {
      state: RoundState.ROUND_OVER,
      roundNumber: 3,
      score: { "session-1": 2, "session-2": 1 },
    };
    expect(state.score["session-1"]).toBe(2);
    expect(state.score["session-2"]).toBe(1);
  });

  it("supports an empty score record (start of match)", () => {
    const state: MatchState = {
      state: RoundState.COUNTDOWN,
      roundNumber: 1,
      score: {},
    };
    expect(Object.keys(state.score)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RoundResetPayload shape
// ─────────────────────────────────────────────────────────────────────────────

describe("RoundResetPayload interface (round reset broadcast)", () => {
  function makePayload(overrides: Partial<RoundResetPayload> = {}): RoundResetPayload {
    return {
      spawnPosition: { x: 0, y: 0.9, z: 6 },
      resetHealth: 100,
      resetEnergy: 50,
      clearBuilds: true,
      ...overrides,
    };
  }

  it("includes a spawnPosition with x, y, z numeric fields", () => {
    const payload = makePayload();
    expect(payload.spawnPosition).toBeDefined();
    expect(typeof payload.spawnPosition.x).toBe("number");
    expect(typeof payload.spawnPosition.y).toBe("number");
    expect(typeof payload.spawnPosition.z).toBe("number");
  });

  it("has spawnPosition values that are finite numbers", () => {
    const payload = makePayload({
      spawnPosition: { x: -5, y: 1.2, z: -3 },
    });
    expect(Number.isFinite(payload.spawnPosition.x)).toBe(true);
    expect(Number.isFinite(payload.spawnPosition.y)).toBe(true);
    expect(Number.isFinite(payload.spawnPosition.z)).toBe(true);
  });

  it("includes a resetHealth (max health) numeric field", () => {
    const payload = makePayload();
    expect(typeof payload.resetHealth).toBe("number");
    expect(payload.resetHealth).toBeGreaterThan(0);
  });

  it("includes a resetEnergy (max energy) numeric field", () => {
    const payload = makePayload();
    expect(typeof payload.resetEnergy).toBe("number");
    expect(payload.resetEnergy).toBeGreaterThanOrEqual(0);
  });

  it("includes a clearBuilds boolean flag", () => {
    const payloadTrue = makePayload({ clearBuilds: true });
    const payloadFalse = makePayload({ clearBuilds: false });
    expect(typeof payloadTrue.clearBuilds).toBe("boolean");
    expect(payloadTrue.clearBuilds).toBe(true);
    expect(payloadFalse.clearBuilds).toBe(false);
  });

  it("carries a representative full payload", () => {
    const payload = makePayload({
      spawnPosition: { x: 3, y: 0.5, z: -2 },
      resetHealth: 100,
      resetEnergy: 40,
      clearBuilds: true,
    });
    expect(payload).toEqual({
      spawnPosition: { x: 3, y: 0.5, z: -2 },
      resetHealth: 100,
      resetEnergy: 40,
      clearBuilds: true,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WIN_ROUNDS constant (match win threshold)
// ─────────────────────────────────────────────────────────────────────────────

describe("WIN_ROUNDS (match win threshold constant)", () => {
  it("equals 3 (first-to-3 match)", () => {
    expect(WIN_ROUNDS).toBe(3);
  });

  it("is a positive integer", () => {
    expect(Number.isInteger(WIN_ROUNDS)).toBe(true);
    expect(WIN_ROUNDS).toBeGreaterThan(0);
  });

  it("matches the protocol-level FIRST_TO_N constant (cross-package consistency)", () => {
    // FIRST_TO_N is the deprecated protocol-level mirror of WIN_ROUNDS.
    // Both must agree so the server (which reads WIN_ROUNDS) and any
    // legacy client code (which reads FIRST_TO_N) use the same threshold.
    expect(FIRST_TO_N).toBe(WIN_ROUNDS);
    expect(FIRST_TO_N).toBe(3);
  });
});
