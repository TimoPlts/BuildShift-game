/**
 * Stage 2D — deterministic spawn-slot allocation tests.
 *
 * Proves the server's `AuthoritativeMovement` assigns distinct, non-overlapping
 * spawn slots to simultaneous players, that a released slot is reusable, that
 * leaving one player does not move another, and that movement still works from
 * each slot. Driven deterministically (no timers / network) via the
 * simulation's public API; `SPAWN_SLOTS` is imported to assert exact slot
 * placement.
 *
 * A real-wire variant already exists (`server2dwire.test.ts`), which is updated
 * for the new slot-1 second-joiner spawn.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PLAYER_SPAWN } from "@buildshift/game-config";
import type { PlayerInputFrame } from "@buildshift/protocol";

import { AuthoritativeMovement, SPAWN_SLOTS } from "./physics/authoritativeMovement.js";

/** One authoritative tick (30 Hz, two 60 Hz substeps). Structural — matches the
 *  simulation's `TickInput` without importing its (non-exported) type. */
const TICK = { subSteps: 2, subDt: 1 / 60 };

const A = "player-a";
const B = "player-b";
const C = "player-c";

/** A valid frame builder (defaults to the protocol-valid neutral frame). */
function frame(partial: Partial<PlayerInputFrame>): PlayerInputFrame {
  return {
    sequence: 0,
    moveX: 0,
    moveZ: 0,
    lookYaw: 0,
    lookPitch: 0,
    jump: false,
    ...partial,
  };
}

/** Euclidean distance between two publishable positions. */
function dist(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

describe("Stage 2D spawn-slot allocation (deterministic)", () => {
  let movement: AuthoritativeMovement;

  beforeEach(async () => {
    movement = await AuthoritativeMovement.create();
  });

  afterEach(() => {
    movement.dispose();
  });

  it("a single player spawns at slot 0 (the original baseline spawn)", () => {
    movement.createPlayer(A);
    const p = movement.getPublishable(A)!.position;
    expect(p.x).toBeCloseTo(SPAWN_SLOTS[0].x, 5);
    expect(p.z).toBeCloseTo(SPAWN_SLOTS[0].z, 5);
    expect(p.x).toBeCloseTo(PLAYER_SPAWN.x, 5);
    expect(p.z).toBeCloseTo(PLAYER_SPAWN.z, 5);
  });

  it("assigns player A and player B to DIFFERENT spawn positions", () => {
    movement.createPlayer(A);
    movement.createPlayer(B);
    const pa = movement.getPublishable(A)!.position;
    const pb = movement.getPublishable(B)!.position;
    expect(dist(pa, pb)).toBeGreaterThan(0);
    // A is first → slot 0; B is second → slot 1.
    expect(pa.x).toBeCloseTo(SPAWN_SLOTS[0].x, 5);
    expect(pa.z).toBeCloseTo(SPAWN_SLOTS[0].z, 5);
    expect(pb.x).toBeCloseTo(SPAWN_SLOTS[1].x, 5);
    expect(pb.z).toBeCloseTo(SPAWN_SLOTS[1].z, 5);
  });

  it("both spawn positions are finite and on valid (flat) ground", () => {
    movement.createPlayer(A);
    movement.createPlayer(B);
    for (const id of [A, B]) {
      const p = movement.getPublishable(id)!.position;
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
      // Capsule-centre height matches the shared spawn height (feet on ground).
      expect(p.y).toBeCloseTo(SPAWN_SLOTS[0].y, 5);
    }
  });

  it("players do not overlap at spawn (separated by more than one capsule)", () => {
    movement.createPlayer(A);
    movement.createPlayer(B);
    const pa = movement.getPublishable(A)!.position;
    const pb = movement.getPublishable(B)!.position;
    // Two capsules of radius 0.35 must not intersect at spawn: centre distance
    // should comfortably exceed the 0.7 m combined radius.
    expect(dist(pa, pb)).toBeGreaterThan(0.7 + 0.2);
  });

  it("movement still works from each spawn slot", () => {
    movement.createPlayer(A);
    movement.createPlayer(B);
    movement.enqueueFrame(A, frame({ sequence: 0, moveZ: -1 }));
    movement.enqueueFrame(B, frame({ sequence: 0, moveZ: -1 }));
    movement.runTick(TICK);
    const a = movement.getPublishable(A)!.position;
    const b = movement.getPublishable(B)!.position;
    // Both advanced forward (−Z) from their own spawn.
    expect(a.z).toBeLessThan(SPAWN_SLOTS[0].z - 0.1);
    expect(b.z).toBeLessThan(SPAWN_SLOTS[1].z - 0.1);
    // Each player is still at its own slot's x (independent horizontal lanes).
    expect(a.x).toBeCloseTo(SPAWN_SLOTS[0].x, 2);
    expect(b.x).toBeCloseTo(SPAWN_SLOTS[1].x, 2);
  });

  it("one player leaving does not move the remaining player", () => {
    movement.createPlayer(A);
    movement.createPlayer(B);
    const aBefore = movement.getPublishable(A)!.position;

    movement.removePlayer(B);

    const aAfter = movement.getPublishable(A)!.position;
    expect(dist(aBefore, aAfter)).toBeLessThan(1e-6);
    expect(aAfter.x).toBeCloseTo(SPAWN_SLOTS[0].x, 5);
    expect(aAfter.z).toBeCloseTo(SPAWN_SLOTS[0].z, 5);
  });

  it("a later join reuses a released spawn slot", () => {
    movement.createPlayer(A); // slot 0
    movement.createPlayer(B); // slot 1
    movement.removePlayer(B); // releases slot 1

    movement.createPlayer(C);
    const c = movement.getPublishable(C)!.position;
    // The released slot 1 is reused for the new joiner (lowest free slot).
    expect(c.x).toBeCloseTo(SPAWN_SLOTS[1].x, 5);
    expect(c.z).toBeCloseTo(SPAWN_SLOTS[1].z, 5);
    // A is still on slot 0, unchanged.
    const a = movement.getPublishable(A)!.position;
    expect(a.x).toBeCloseTo(SPAWN_SLOTS[0].x, 5);
  });

  it("falls back to the baseline spawn once all slots are taken (>2 players)", () => {
    movement.createPlayer(A); // slot 0
    movement.createPlayer(B); // slot 1
    movement.createPlayer(C); // no free slot → baseline fallback (slot 0 pos)
    const c = movement.getPublishable(C)!.position;
    expect(c.x).toBeCloseTo(SPAWN_SLOTS[0].x, 5);
    expect(c.z).toBeCloseTo(SPAWN_SLOTS[0].z, 5);
  });

  it("slot bookkeeping does not leak after leave/dispose cycles", () => {
    movement.createPlayer(A);
    movement.createPlayer(B);
    movement.removePlayer(B);
    // Repeated join/leave of slot 1 always re-uses it (no drift, no leak).
    for (let i = 0; i < 5; i++) {
      movement.createPlayer(C);
      const c = movement.getPublishable(C)!.position;
      expect(c.x).toBeCloseTo(SPAWN_SLOTS[1].x, 5);
      movement.removePlayer(C);
    }
  });
});
