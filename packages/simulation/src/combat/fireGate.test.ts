/**
 * Unit tests for {@link canFire} — the shared fire-gate used by both the
 * predicting client (local fire) and the authoritative server (validation).
 *
 * The gate keys off the input *sequence*: a player may fire again only once
 * `fireIntervalTicks` ticks have elapsed since the sequence at which they
 * last fired. These tests pin the four behaviours the combat contract relies
 * on (first shot, within cooldown, exactly at the cooldown boundary, and
 * after elimination) plus a few extra guards (non-positive interval, default
 * config, monotonic ordering).
 */
import { describe, expect, it } from "vitest";
import { canFire } from "./fireGate.js";

/** A representative weapon cooldown in ticks. */
const INTERVAL = 8;

describe("canFire — first shot", () => {
  it("allows the first shot when lastFireSequence is the -1 sentinel", () => {
    // The player has never fired (sentinel -1) on tick 0.
    expect(canFire(-1, 0, INTERVAL)).toBe(true);
  });

  it("allows the first shot even when currentSequence is far ahead", () => {
    expect(canFire(-1, 100, INTERVAL)).toBe(true);
  });

  it("treats a non-finite lastFireSequence as 'never fired'", () => {
    expect(canFire(Number.NaN, 5, INTERVAL)).toBe(true);
  });
});

describe("canFire — within cooldown", () => {
  it("blocks a shot fired before the cooldown has elapsed", () => {
    // Last fired on tick 10; interval 8. Ticks 11..17 are still in cooldown.
    expect(canFire(10, 11, INTERVAL)).toBe(false);
    expect(canFire(10, 15, INTERVAL)).toBe(false);
    expect(canFire(10, 17, INTERVAL)).toBe(false);
  });

  it("blocks a shot on the exact same tick as the last shot", () => {
    expect(canFire(10, 10, INTERVAL)).toBe(false);
  });

  it("blocks a shot with a negative delta (out-of-order / lower sequence)", () => {
    expect(canFire(20, 10, INTERVAL)).toBe(false);
  });
});

describe("canFire — exactly at the cooldown boundary", () => {
  it("allows a shot when the cooldown has fully elapsed (delta == interval)", () => {
    // Last fired on tick 10; interval 8 → tick 18 is exactly at the boundary.
    expect(canFire(10, 18, INTERVAL)).toBe(true);
  });

  it("allows a shot fired after the boundary", () => {
    expect(canFire(10, 19, INTERVAL)).toBe(true);
    expect(canFire(10, 100, INTERVAL)).toBe(true);
  });
});

describe("canFire — after elimination", () => {
  it("blocks firing when the shooter is eliminated, even if cooldown has elapsed", () => {
    // Cooldown is fully elapsed (delta 100 >> 8) but the player is eliminated.
    expect(canFire(10, 110, INTERVAL, { isEliminated: true })).toBe(false);
  });

  it("blocks firing when the shooter is eliminated on their very first shot", () => {
    expect(canFire(-1, 0, INTERVAL, { isEliminated: true })).toBe(false);
  });

  it("allows firing again once the player is no longer eliminated", () => {
    // After a respawn (isEliminated false) with cooldown elapsed.
    expect(canFire(10, 100, INTERVAL, { isEliminated: false })).toBe(true);
  });
});

describe("canFire — extra guards", () => {
  it("always allows firing when the interval is zero (no cooldown)", () => {
    expect(canFire(10, 10, 0)).toBe(true);
    expect(canFire(10, 9, 0)).toBe(true);
  });

  it("always allows firing when the interval is negative (no cooldown)", () => {
    expect(canFire(10, 10, -5)).toBe(true);
  });

  it("defaults to an empty config (not eliminated) when omitted", () => {
    expect(canFire(-1, 0, INTERVAL)).toBe(true);
    expect(canFire(10, 100, INTERVAL)).toBe(true);
  });

  it("is independent of the specific weapon (pure tick math)", () => {
    // Shotgun (interval 35) vs assault rifle (interval 8) — same gate logic.
    expect(canFire(0, 34, 35)).toBe(false);
    expect(canFire(0, 35, 35)).toBe(true);
    expect(canFire(0, 7, 8)).toBe(false);
    expect(canFire(0, 8, 8)).toBe(true);
  });
});
