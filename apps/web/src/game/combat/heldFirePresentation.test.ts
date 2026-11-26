/**
 * Behavioral regressions for {@link HeldFirePresentationGate} — the gate that
 * decides which simulation-tick fire intents present a local round (muzzle
 * flash + tracer + recoil + audio).
 *
 * Locks the autofire-tracer fixes:
 *  - held input produces one presentation per accepted round at the
 *    equipped weapon's tick cadence (no click-edge dependency);
 *  - the first round of a fresh hold is presented immediately;
 *  - rejected shots (cooldown, empty, reloading, eliminated) present nothing;
 *  - release / mode switch (fireHeld false) presents nothing and does not
 *    advance the gate;
 *  - cadence is sequence-based (frame-rate independent): a burst of
 *    evaluations at the same sequence presents once;
 *  - reset() re-arms the first shot (round/match reset).
 */
import { describe, expect, it } from "vitest";
import { ASSAULT_RIFLE, SHOTGUN } from "@buildshift/game-config";
import {
  HeldFirePresentationGate,
  type HeldFirePresentationRequest,
} from "./heldFirePresentation";

function req(over: Partial<HeldFirePresentationRequest> = {}): HeldFirePresentationRequest {
  return {
    fireHeld: true,
    sequence: 0,
    fireIntervalTicks: ASSAULT_RIFLE.fireIntervalTicks, // 8 ticks
    ammo: 30,
    reloading: false,
    eliminated: false,
    ...over,
  };
}

describe("HeldFirePresentationGate — held automatic fire", () => {
  it("presents the first round of a fresh hold immediately (no press-edge path needed)", () => {
    const gate = new HeldFirePresentationGate();
    expect(gate.allows(req({ sequence: 100 }))).toBe(true);
    expect(gate.lastFireSequence).toBe(100);
  });

  it("presents multiple accepted rounds across a sustained hold at the weapon cadence", () => {
    const gate = new HeldFirePresentationGate();
    const presented: number[] = [];
    // Simulate a sustained 4-second hold at 30 Hz (120 sim ticks, seq 0..119).
    for (let seq = 0; seq < 120; seq++) {
      if (gate.allows(req({ sequence: seq, ammo: 30 }))) presented.push(seq);
    }
    // Server-parity cadence: first tick, then every >= fireIntervalTicks.
    expect(presented.length).toBeGreaterThanOrEqual(2);
    expect(presented[0]).toBe(0);
    for (let i = 1; i < presented.length; i++) {
      expect(presented[i] - presented[i - 1]).toBeGreaterThanOrEqual(
        ASSAULT_RIFLE.fireIntervalTicks,
      );
    }
    // 120 ticks / 8-tick interval -> ~15 accepted rounds (not one).
    expect(presented.length).toBeGreaterThanOrEqual(14);
  });

  it("rejects cooldown-bound rounds while the hold continues", () => {
    const gate = new HeldFirePresentationGate();
    expect(gate.allows(req({ sequence: 0 }))).toBe(true);
    // Ticks 1..7 are inside the 8-tick cooldown: no feedback, no state move.
    for (let seq = 1; seq < ASSAULT_RIFLE.fireIntervalTicks; seq++) {
      expect(gate.allows(req({ sequence: seq }))).toBe(false);
      expect(gate.lastFireSequence).toBe(0);
    }
    // Boundary inclusive (same rule as the shared canFire gate).
    expect(gate.allows(req({ sequence: ASSAULT_RIFLE.fireIntervalTicks }))).toBe(true);
    expect(gate.lastFireSequence).toBe(ASSAULT_RIFLE.fireIntervalTicks);
  });

  it("is frame-rate independent: repeated evaluations at one sequence present once", () => {
    const gate = new HeldFirePresentationGate();
    expect(gate.allows(req({ sequence: 8 }))).toBe(true);
    // Same tick re-evaluated (any render cadence): no duplicate feedback.
    expect(gate.allows(req({ sequence: 8 }))).toBe(false);
    expect(gate.allows(req({ sequence: 8 }))).toBe(false);
    expect(gate.lastFireSequence).toBe(8);
  });

  it("uses the equipped weapon's cadence: the longer shotgun interval is enforced", () => {
    const gate = new HeldFirePresentationGate();
    expect(
      gate.allows(req({ sequence: 0, fireIntervalTicks: SHOTGUN.fireIntervalTicks })),
    ).toBe(true);
    for (let seq = 1; seq < SHOTGUN.fireIntervalTicks; seq++) {
      expect(
        gate.allows(req({ sequence: seq, fireIntervalTicks: SHOTGUN.fireIntervalTicks })),
      ).toBe(false);
    }
    expect(
      gate.allows(req({ sequence: SHOTGUN.fireIntervalTicks, fireIntervalTicks: SHOTGUN.fireIntervalTicks })),
    ).toBe(true);
  });

  it("presents nothing for rejected states: empty, reloading, eliminated", () => {
    const gate = new HeldFirePresentationGate();
    expect(gate.allows(req({ sequence: 0, ammo: 0 }))).toBe(false);
    expect(gate.allows(req({ sequence: 0, ammo: -1 }))).toBe(false);
    expect(gate.allows(req({ sequence: 0, reloading: true }))).toBe(false);
    expect(gate.allows(req({ sequence: 0, eliminated: true }))).toBe(false);
    // A rejected state never advances the gate — after the reload finishes
    // and ammo is back, the next held tick presents again.
    expect(gate.lastFireSequence).toBe(-1);
    expect(gate.allows(req({ sequence: 0 }))).toBe(true);
  });

  it("stops presenting on release / mode switch and does not spend cadence while idle", () => {
    const gate = new HeldFirePresentationGate();
    expect(gate.allows(req({ sequence: 0 }))).toBe(true);
    // Release (or route handoff to build/edit -> fireHeld false): no feedback.
    for (let seq = 1; seq <= 20; seq++) {
      expect(gate.allows(req({ sequence: seq, fireHeld: false }))).toBe(false);
    }
    // Re-press after a long gap: first round is immediate again.
    expect(gate.allows(req({ sequence: 21 }))).toBe(true);
    expect(gate.lastFireSequence).toBe(21);
  });

  it("re-arms the first shot after reset (round / match reset, reconnect)", () => {
    const gate = new HeldFirePresentationGate();
    expect(gate.allows(req({ sequence: 500 }))).toBe(true);
    expect(gate.allows(req({ sequence: 501 }))).toBe(false); // still cooling
    gate.reset();
    expect(gate.lastFireSequence).toBe(-1);
    // Sequences keep counting across rounds; the reset gate fires at once.
    expect(gate.allows(req({ sequence: 600 }))).toBe(true);
  });
});
