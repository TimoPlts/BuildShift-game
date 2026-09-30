/**
 * Stage 2C2B — SERVER ACK-INVARIANT STRESS (deterministic).
 *
 * The client reconciliation contract (Stage 2C2) depends on exactly one
 * invariant of the server input queue:
 *
 *   acknowledgedSequence == highest input ACTUALLY simulated
 *
 * It must NEVER mean "highest received", "highest queued", or "latest packet".
 * These tests stress that invariant under backlog, sequence gaps, multiple
 * players, held input, jump edges, and rejected/malformed traffic — driving
 * `AuthoritativeMovement.runTick()` deterministically (no timers, no network)
 * with a plain `TickInput` (`{ subSteps: 2, subDt: 1/60 }`, the room's 30 Hz
 * tick over two 60 Hz substeps).
 *
 * A companion real-wire test lives in `server2c1wire.test.ts` ("progresses
 * acknowledgements in order through a burst").
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PLAYER_SPAWN } from "@buildshift/game-config";
import type { PlayerInputFrame } from "@buildshift/protocol";

import {
  AuthoritativeMovement,
  type TickInput,
} from "./physics/authoritativeMovement.js";

/** One authoritative tick as the room runs it (30 Hz, two 60 Hz substeps). */
const TICK: TickInput = { subSteps: 2, subDt: 1 / 60 };

/** Distance a player covers in one tick at moveSpeed = 6 (m/tick). */
const DIST_PER_TICK = 6 * TICK.subDt * TICK.subSteps; // = 0.2

const P1 = "player-1";
const P2 = "player-2";

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

/** Convenience reader for the published ack of a player. */
function ack(m: AuthoritativeMovement, id: string): number {
  return m.getPublishable(id)!.acknowledgedSequence;
}

describe("Stage 2C2B server ack-invariant stress (deterministic)", () => {
  let movement: AuthoritativeMovement;

  beforeEach(async () => {
    movement = await AuthoritativeMovement.create();
  });

  afterEach(() => {
    movement.dispose();
  });

  describe("burst / backlog", () => {
    it("keeps ack unchanged across a burst enqueued before any tick", () => {
      movement.createPlayer(P1);
      const N = 40;
      for (let s = 0; s < N; s++) {
        expect(movement.enqueueFrame(P1, frame({ sequence: s }))).toBe(
          "accepted",
        );
      }
      // Nothing simulated yet: ack is still -1 — NOT the highest received
      // (N-1) and NOT the highest queued.
      expect(ack(movement, P1)).toBe(-1);
    });

    it("consumes at most one queued frame per authoritative tick", () => {
      movement.createPlayer(P1);
      const N = 40;
      for (let s = 0; s < N; s++) movement.enqueueFrame(P1, frame({ sequence: s }));

      // After one tick, exactly the FIRST frame has been processed.
      movement.runTick(TICK);
      expect(ack(movement, P1)).toBe(0);
      // A second tick processes exactly the next frame — not a batch.
      movement.runTick(TICK);
      expect(ack(movement, P1)).toBe(1);
    });

    it("advances ack one processed frame at a time; never jumps to highest received", () => {
      movement.createPlayer(P1);
      const N = 50;
      for (let s = 0; s < N; s++) movement.enqueueFrame(P1, frame({ sequence: s }));

      let prev = -1;
      for (let i = 0; i < N; i++) {
        movement.runTick(TICK);
        const a = ack(movement, P1);
        // Each tick advances by exactly one processed frame.
        expect(a).toBe(prev + 1);
        // It never leaps to the highest received while frames remain queued.
        expect(a).toBeLessThanOrEqual(i);
        prev = a;
      }
      expect(prev).toBe(N - 1);
    });

    it("reaches the final sequence exactly after enough ticks, and no further", () => {
      movement.createPlayer(P1);
      const N = 25;
      for (let s = 0; s < N; s++) movement.enqueueFrame(P1, frame({ sequence: s }));

      for (let i = 0; i < N; i++) movement.runTick(TICK);
      // The backlog is fully drained; the ack is exactly the last sequence.
      expect(ack(movement, P1)).toBe(N - 1);

      // Extra ticks with an empty queue neither advance nor lower the ack.
      movement.runTick(TICK);
      movement.runTick(TICK);
      expect(ack(movement, P1)).toBe(N - 1);
    });
  });

  describe("sequence gaps", () => {
    it("ack follows the ACTUAL processed sequence values exactly (no +1 assumption)", () => {
      movement.createPlayer(P1);
      const seqs = [0, 3, 7, 12, 20, 21];
      for (const s of seqs) {
        expect(movement.enqueueFrame(P1, frame({ sequence: s }))).toBe(
          "accepted",
        );
      }

      for (let i = 0; i < seqs.length; i++) {
        movement.runTick(TICK);
        // The ack is the exact sequence value of the frame just simulated —
        // not prev+1, not the highest received.
        expect(ack(movement, P1)).toBe(seqs[i]);
      }

      // After the gap burst drains, the ack holds the last processed value.
      movement.runTick(TICK);
      expect(ack(movement, P1)).toBe(seqs[seqs.length - 1]);
    });
  });

  describe("two players", () => {
    it("keeps independent backlogs; each consumes at most one frame per tick", () => {
      movement.createPlayer(P1);
      movement.createPlayer(P2);
      // Different backlog sizes: p1 = 10 frames (0..9), p2 = 20 (0..19).
      for (let s = 0; s < 10; s++) movement.enqueueFrame(P1, frame({ sequence: s }));
      for (let s = 0; s < 20; s++) movement.enqueueFrame(P2, frame({ sequence: s }));

      for (let i = 0; i < 20; i++) {
        movement.runTick(TICK);
        // p1 drains after 10 ticks, then holds at its last sequence (9).
        expect(ack(movement, P1)).toBe(Math.min(i, 9));
        // p2 tracks its own backlog tick-for-tick (0..19).
        expect(ack(movement, P2)).toBe(i);
      }
    });

    it("one player's backlog never alters the other player's ack", () => {
      movement.createPlayer(P1);
      movement.createPlayer(P2);
      // p2 has a large backlog; p1 has a single frame.
      for (let s = 0; s < 30; s++) movement.enqueueFrame(P2, frame({ sequence: s }));
      movement.enqueueFrame(P1, frame({ sequence: 5 }));

      // While p2 drains many frames, p1's ack is fixed at its only frame.
      for (let i = 0; i < 30; i++) {
        movement.runTick(TICK);
        expect(ack(movement, P1)).toBe(5);
      }
      // p2 progressed all the way through its own backlog.
      expect(ack(movement, P2)).toBe(29);
    });

    it("movement state remains player-local (held yaw never crosses players)", () => {
      movement.createPlayer(P1);
      movement.createPlayer(P2);
      movement.enqueueFrame(P1, frame({ sequence: 0, lookYaw: 0.5, moveZ: -1 }));
      movement.enqueueFrame(P2, frame({ sequence: 0, lookYaw: -1.2, moveZ: 1 }));
      movement.runTick(TICK);
      // Each player publishes its own held yaw — no cross-talk.
      expect(movement.getPublishable(P1)!.yaw).toBeCloseTo(0.5, 5);
      expect(movement.getPublishable(P2)!.yaw).toBeCloseTo(-1.2, 5);
    });
  });

  describe("held input", () => {
    it("keeps the last processed movement held once the backlog drains", () => {
      movement.createPlayer(P1);
      movement.enqueueFrame(P1, frame({ sequence: 0, moveZ: -1 }));
      movement.enqueueFrame(P1, frame({ sequence: 1, moveZ: -1 }));
      movement.runTick(TICK); // consumes 0
      movement.runTick(TICK); // consumes 1

      const zA = movement.getPublishable(P1)!.position.z;
      // No more queued frames: the held moveZ=-1 persists → keeps moving.
      movement.runTick(TICK);
      const zB = movement.getPublishable(P1)!.position.z;
      movement.runTick(TICK);
      const zC = movement.getPublishable(P1)!.position.z;
      expect(zB).toBeLessThan(zA);
      expect(zC).toBeLessThan(zB);
      // Each held tick still covers roughly one tick's distance.
      expect(zA - zB).toBeGreaterThan(DIST_PER_TICK - 0.05);
      expect(zB - zC).toBeGreaterThan(DIST_PER_TICK - 0.05);
    });

    it("a queued zero-input frame stops held movement ONLY once it is processed", () => {
      movement.createPlayer(P1);
      const z0 = movement.getPublishable(P1)!.position.z;
      // Both frames are received before any tick.
      movement.enqueueFrame(P1, frame({ sequence: 0, moveZ: -1 })); // move
      movement.enqueueFrame(P1, frame({ sequence: 1, moveX: 0, moveZ: 0 })); // zero

      // Tick A consumes the MOVE frame. The zero frame is already in the queue
      // but NOT yet simulated → the player still moves this tick.
      movement.runTick(TICK);
      const zA = movement.getPublishable(P1)!.position.z;
      expect(zA).toBeLessThan(z0);
      expect(z0 - zA).toBeGreaterThan(DIST_PER_TICK - 0.05);

      // Tick B consumes the ZERO frame → held input becomes zero → stops.
      movement.runTick(TICK);
      const zB = movement.getPublishable(P1)!.position.z;
      // Tick C: nothing queued, held stays zero → still stopped.
      movement.runTick(TICK);
      const zC = movement.getPublishable(P1)!.position.z;

      // The stop happens exactly when the zero frame is processed (tick B):
      // it moved on the move frame's tick (A) and is at rest from tick B on.
      // A queued-but-unprocessed zero frame would NOT have stopped tick A.
      expect(Math.abs(zB - zA)).toBeLessThan(0.01);
      expect(Math.abs(zC - zB)).toBeLessThan(0.01);
    });
  });

  describe("jump (backlog)", () => {
    it("a queued jump frame applies its edge exactly once (no substep replay)", () => {
      movement.createPlayer(P1);
      movement.enqueueFrame(P1, frame({ sequence: 0, jump: true }));
      movement.runTick(TICK); // consumes the jump frame → single edge

      let maxY = movement.getPublishable(P1)!.position.y;
      for (let i = 0; i < 180; i++) {
        movement.runTick(TICK);
        maxY = Math.max(maxY, movement.getPublishable(P1)!.position.y);
      }
      // A single 60 Hz-substep edge peaks at jumpSpeed^2/(2|g|) ≈ 2.5 m above
      // launch. A replayed edge (applied on both substeps) would roughly double
      // it (≈ 3.2+ m). Bound the apex to prove a single edge.
      expect(maxY).toBeGreaterThan(PLAYER_SPAWN.y + 1.0);
      expect(maxY).toBeLessThan(PLAYER_SPAWN.y + 2.0);
    });

    it("a jump frame behind other queued frames still fires its edge exactly once", () => {
      movement.createPlayer(P1);
      // The jump frame sits BEHIND a move frame in the backlog.
      movement.enqueueFrame(P1, frame({ sequence: 0, moveZ: -1 }));
      movement.enqueueFrame(P1, frame({ sequence: 1, jump: true }));
      movement.runTick(TICK); // consumes 0 (move)
      movement.runTick(TICK); // consumes 1 (jump) → edge fires once here

      let maxY = movement.getPublishable(P1)!.position.y;
      for (let i = 0; i < 180; i++) {
        movement.runTick(TICK);
        maxY = Math.max(maxY, movement.getPublishable(P1)!.position.y);
      }
      // Single-edge apex scale — the backlog did not replay the edge.
      expect(maxY).toBeGreaterThan(PLAYER_SPAWN.y + 1.0);
      expect(maxY).toBeLessThan(PLAYER_SPAWN.y + 2.0);
    });
  });

  describe("malformed / stale", () => {
    it("rejected frames do not alter queue or ack progression", () => {
      movement.createPlayer(P1);
      movement.enqueueFrame(P1, frame({ sequence: 0 })); // accepted
      movement.enqueueFrame(P1, frame({ sequence: 1 })); // accepted

      // Injections that must be REJECTED and have zero effect on the queue.
      expect(movement.enqueueFrame(P1, frame({ sequence: 1 }))).toBe(
        "rejected-sequence",
      ); // duplicate
      expect(movement.enqueueFrame(P1, frame({ sequence: 0 }))).toBe(
        "rejected-sequence",
      ); // stale / lower
      expect(movement.enqueueFrame(P1, frame({ sequence: 2 }))).toBe(
        "accepted",
      ); // a real new frame
      expect(movement.enqueueFrame(P1, frame({ sequence: -1 }))).toBe(
        "rejected-malformed",
      );

      // The queue holds exactly [0, 1, 2]; the ack advances 0 → 1 → 2 and
      // stops there (no phantom frames from the rejections).
      movement.runTick(TICK);
      expect(ack(movement, P1)).toBe(0);
      movement.runTick(TICK);
      expect(ack(movement, P1)).toBe(1);
      movement.runTick(TICK);
      expect(ack(movement, P1)).toBe(2);
      movement.runTick(TICK);
      expect(ack(movement, P1)).toBe(2); // drained; no advance
    });

    it("a malformed frame interleaved in a burst is skipped, not queued", () => {
      movement.createPlayer(P1);
      const good = [0, 1, 2, 3];
      for (const s of good) {
        movement.enqueueFrame(P1, frame({ sequence: s }));
        // A malformed duplicate of the same sequence must not enter the queue.
        expect(movement.enqueueFrame(P1, frame({ sequence: s }))).toBe(
          "rejected-sequence",
        );
      }
      for (const s of good) {
        movement.runTick(TICK);
        expect(ack(movement, P1)).toBe(s);
      }
      movement.runTick(TICK);
      expect(ack(movement, P1)).toBe(good[good.length - 1]);
    });
  });
});
