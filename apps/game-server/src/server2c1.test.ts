/**
 * Stage 2C1 — authoritative movement simulation tests.
 *
 * These are DETERMINISTIC: they drive `AuthoritativeMovement.runTick()`
 * directly (no real timers, no Colyseus, no waiting on the network) by passing
 * a plain `TickInput` (`{ subSteps: 2, subDt: 1/60 }`), so the assertions below
 * are exact functions of the shared movement math + Rapier, not of wall-clock
 * timing.
 *
 * Covered (task §11 matrix):
 *  - JOIN: a player starts at `PLAYER_SPAWN`, yaw 0, `acknowledgedSequence -1`;
 *  - ACK SEMANTICS: an enqueued frame is NOT acknowledged until a tick has
 *    actually simulated it; a queued-but-unprocessed frame is never acked;
 *  - SEQUENCE: duplicate/stale/non-monotonic sequences are rejected, gaps are
 *    accepted, malformed (negative) sequences are rejected, unknown players
 *    are rejected;
 *  - MOVEMENT: yaw-0 forward→-Z / backward→+Z / right→-X / left→+X; yaw π/2
 *    forward→+X; diagonal is normalized; held input persists across
 *    no-new-frame ticks; a zero-input frame stops movement after it is
 *    processed;
 *  - JUMP: a single `jump:true` raises the authoritative Y and is NOT replayed
 *    as a second edge; no double jump;
 *  - COLLISION: the player cannot pass through an arena collider (the central
 *    box), and the player lands on / stays on the ground;
 *  - LIFECYCLE: `removePlayer` drops the simulation; `dispose` is idempotent
 *    and safe to re-call.
 *
 * A second file (`server2c1wire.test.ts`) holds the real SDK/wire integration
 * test.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { PLAYER_SPAWN } from "@buildshift/game-config";
import type { PlayerInputFrame } from "@buildshift/protocol";

import {
  AuthoritativeMovement,
  type TickInput,
} from "./physics/authoritativeMovement.js";

/**
 * One authoritative tick as the room would run it: 30 Hz tick, two 60 Hz
 * physics substeps.
 */
const TICK: TickInput = { subSteps: 2, subDt: 1 / 60 };

/** Distance a player covers in one tick at `moveSpeed = 6` (m/tick). */
const DIST_PER_TICK = 6 * TICK.subDt * TICK.subSteps; // = 0.2

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

describe("Stage 2C1 authoritative movement (deterministic)", () => {
  let movement: AuthoritativeMovement;
  const ID = "player-1";

  beforeEach(async () => {
    movement = await AuthoritativeMovement.create();
  });

  afterEach(() => {
    movement.dispose();
  });

  afterAll(() => {
    // No leaked per-test world; nothing global to tear down (Rapier init is a
    // shared, process-lifetime singleton).
  });

  describe("join", () => {
    it("starts a player at PLAYER_SPAWN with yaw 0 and no acknowledged sequence", () => {
      movement.createPlayer(ID);
      const pub = movement.getPublishable(ID);
      expect(pub).not.toBeNull();
      expect(pub!.position.x).toBeCloseTo(PLAYER_SPAWN.x, 3);
      expect(pub!.position.y).toBeCloseTo(PLAYER_SPAWN.y, 3);
      expect(pub!.position.z).toBeCloseTo(PLAYER_SPAWN.z, 3);
      expect(pub!.yaw).toBe(0);
      expect(pub!.acknowledgedSequence).toBe(-1);
      expect(movement.hasPlayer(ID)).toBe(true);
    });
  });

  describe("ack semantics", () => {
    it("does NOT acknowledge an enqueued frame before a tick processes it", () => {
      movement.createPlayer(ID);
      const result = movement.enqueueFrame(ID, frame({ sequence: 0 }));
      expect(result).toBe("accepted");

      // Nothing simulated yet → still -1 (NOT immediately acked).
      expect(movement.getPublishable(ID)!.acknowledgedSequence).toBe(-1);
    });

    it("acknowledges a frame to its sequence once the tick has simulated it", () => {
      movement.createPlayer(ID);
      movement.enqueueFrame(ID, frame({ sequence: 0 }));

      movement.runTick(TICK);
      expect(movement.getPublishable(ID)!.acknowledgedSequence).toBe(0);
    });

    it("does not acknowledge a queued frame until its own later tick", () => {
      movement.createPlayer(ID);
      movement.enqueueFrame(ID, frame({ sequence: 0 }));
      movement.enqueueFrame(ID, frame({ sequence: 1 }));

      // First tick processes the FIRST queued frame only → ack 0.
      movement.runTick(TICK);
      expect(movement.getPublishable(ID)!.acknowledgedSequence).toBe(0);

      // Second tick processes the second frame → ack 1.
      movement.runTick(TICK);
      expect(movement.getPublishable(ID)!.acknowledgedSequence).toBe(1);
    });
  });

  describe("sequence rules", () => {
    it("rejects a duplicate (equal) received sequence", () => {
      movement.createPlayer(ID);
      expect(movement.enqueueFrame(ID, frame({ sequence: 5 }))).toBe(
        "accepted",
      );
      expect(movement.enqueueFrame(ID, frame({ sequence: 5 }))).toBe(
        "rejected-sequence",
      );
    });

    it("rejects a stale / lower (non-monotonic) received sequence", () => {
      movement.createPlayer(ID);
      expect(movement.enqueueFrame(ID, frame({ sequence: 6 }))).toBe(
        "accepted",
      );
      expect(movement.enqueueFrame(ID, frame({ sequence: 3 }))).toBe(
        "rejected-sequence",
      );
    });

    it("accepts a sequence gap (does not require sequence == prev + 1)", () => {
      movement.createPlayer(ID);
      expect(movement.enqueueFrame(ID, frame({ sequence: 5 }))).toBe(
        "accepted",
      );
      expect(movement.enqueueFrame(ID, frame({ sequence: 10 }))).toBe(
        "accepted",
      );
    });

    it("rejects a malformed (negative) sequence", () => {
      movement.createPlayer(ID);
      expect(movement.enqueueFrame(ID, frame({ sequence: -1 }))).toBe(
        "rejected-malformed",
      );
    });

    it("rejects fractional and unsafe-integer sequences defensively", () => {
      movement.createPlayer(ID);
      for (const sequence of [1.5, Number.MAX_SAFE_INTEGER + 1]) {
        expect(movement.enqueueFrame(ID, frame({ sequence }))).toBe(
          "rejected-malformed",
        );
      }
    });

    it("rejects input for an unknown player", () => {
      expect(movement.enqueueFrame("ghost", frame({ sequence: 0 }))).toBe(
        "rejected-unknown-player",
      );
    });
  });

  describe("movement (camera-relative, shared math)", () => {
    it("moves toward -Z for forward (moveZ=-1) at yaw 0", () => {
      movement.createPlayer(ID);
      const z0 = movement.getPublishable(ID)!.position.z;
      movement.enqueueFrame(ID, frame({ sequence: 0, moveZ: -1 }));
      movement.runTick(TICK);
      const z1 = movement.getPublishable(ID)!.position.z;
      // Forward is -Z; magnitude is one tick's worth (~0.2 m).
      expect(z1).toBeLessThan(z0);
      expect(z0 - z1).toBeGreaterThan(DIST_PER_TICK - 0.05);
      expect(z0 - z1).toBeLessThan(DIST_PER_TICK + 0.05);
    });

    it("moves toward +Z for backward (moveZ=+1) at yaw 0", () => {
      movement.createPlayer(ID);
      const z0 = movement.getPublishable(ID)!.position.z;
      movement.enqueueFrame(ID, frame({ sequence: 0, moveZ: 1 }));
      movement.runTick(TICK);
      const z1 = movement.getPublishable(ID)!.position.z;
      expect(z1).toBeGreaterThan(z0);
      expect(z1 - z0).toBeGreaterThan(DIST_PER_TICK - 0.05);
      expect(z1 - z0).toBeLessThan(DIST_PER_TICK + 0.05);
    });

    it("moves toward -X for right (moveX=+1) at yaw 0", () => {
      movement.createPlayer(ID);
      const x0 = movement.getPublishable(ID)!.position.x;
      movement.enqueueFrame(ID, frame({ sequence: 0, moveX: 1 }));
      movement.runTick(TICK);
      const x1 = movement.getPublishable(ID)!.position.x;
      // The shared convention: visual camera-right is world -X at yaw 0.
      expect(x1).toBeLessThan(x0);
      expect(x0 - x1).toBeGreaterThan(DIST_PER_TICK - 0.05);
      expect(x0 - x1).toBeLessThan(DIST_PER_TICK + 0.05);
    });

    it("moves toward +X for left (moveX=-1) at yaw 0", () => {
      movement.createPlayer(ID);
      const x0 = movement.getPublishable(ID)!.position.x;
      movement.enqueueFrame(ID, frame({ sequence: 0, moveX: -1 }));
      movement.runTick(TICK);
      const x1 = movement.getPublishable(ID)!.position.x;
      expect(x1).toBeGreaterThan(x0);
      expect(x1 - x0).toBeGreaterThan(DIST_PER_TICK - 0.05);
      expect(x1 - x0).toBeLessThan(DIST_PER_TICK + 0.05);
    });

    it("moves toward +X for forward at yaw π/2", () => {
      movement.createPlayer(ID);
      const x0 = movement.getPublishable(ID)!.position.x;
      movement.enqueueFrame(
        ID,
        frame({ sequence: 0, moveZ: -1, lookYaw: Math.PI / 2 }),
      );
      movement.runTick(TICK);
      const x1 = movement.getPublishable(ID)!.position.x;
      expect(x1).toBeGreaterThan(x0);
      expect(x1 - x0).toBeGreaterThan(DIST_PER_TICK - 0.05);
      expect(x1 - x0).toBeLessThan(DIST_PER_TICK + 0.05);
    });

    it("normalizes a diagonal input to a single tick's total distance", () => {
      movement.createPlayer(ID);
      const p0 = movement.getPublishable(ID)!;
      movement.enqueueFrame(ID, frame({ sequence: 0, moveX: 1, moveZ: -1 }));
      movement.runTick(TICK);
      const p1 = movement.getPublishable(ID)!;
      const dx = p1.position.x - p0.position.x;
      const dz = p1.position.z - p0.position.z;
      const total = Math.hypot(dx, dz);
      // Diagonal is normalized → total distance per tick equals a straight
      // tick (~0.2 m), not √2× larger.
      expect(total).toBeGreaterThan(DIST_PER_TICK - 0.06);
      expect(total).toBeLessThan(DIST_PER_TICK + 0.06);
      // Both axes move (a genuine diagonal).
      expect(Math.abs(dx)).toBeGreaterThan(0.05);
      expect(Math.abs(dz)).toBeGreaterThan(0.05);
    });

    it("keeps held input moving after a tick with no new frame", () => {
      movement.createPlayer(ID);
      const z0 = movement.getPublishable(ID)!.position.z;
      movement.enqueueFrame(ID, frame({ sequence: 0, moveZ: -1 }));

      // Tick 1 consumes the frame (held = forward).
      movement.runTick(TICK);
      const z1 = movement.getPublishable(ID)!.position.z;

      // Tick 2 has NO new frame → held persists → keeps moving forward.
      movement.runTick(TICK);
      const z2 = movement.getPublishable(ID)!.position.z;

      expect(z1 < z0).toBe(true);
      expect(z2 < z1).toBe(true);
      // Both ticks moved by roughly one tick's distance.
      expect(z0 - z1).toBeGreaterThan(DIST_PER_TICK - 0.05);
      expect(z1 - z2).toBeGreaterThan(DIST_PER_TICK - 0.05);
    });

    it("stops horizontal movement once a zero-input frame is processed", () => {
      movement.createPlayer(ID);
      movement.enqueueFrame(ID, frame({ sequence: 0, moveZ: -1 }));
      movement.runTick(TICK); // consumed: forward
      const zA = movement.getPublishable(ID)!.position.z;

      // A zero-input frame replaces the held axes → no movement next tick.
      movement.enqueueFrame(ID, frame({ sequence: 1, moveX: 0, moveZ: 0 }));
      movement.runTick(TICK); // consumes the zero frame
      const zB = movement.getPublishable(ID)!.position.z;

      expect(Math.abs(zB - zA)).toBeLessThan(0.01);
    });
  });

  describe("jump", () => {
    it("raises the authoritative Y on a single jump:true", () => {
      movement.createPlayer(ID);
      const y0 = movement.getPublishable(ID)!.position.y;
      movement.enqueueFrame(ID, frame({ sequence: 0, jump: true }));
      movement.runTick(TICK);
      const y1 = movement.getPublishable(ID)!.position.y;
      expect(y1).toBeGreaterThan(y0);
    });

    it("a single jump:true is not replayed as a second edge (single jump peak)", () => {
      movement.createPlayer(ID);
      movement.enqueueFrame(ID, frame({ sequence: 0, jump: true }));

      // Simulate until the player leaves and returns; track the apex.
      let maxY = movement.getPublishable(ID)!.position.y;
      for (let i = 0; i < 180; i++) {
        movement.runTick(TICK);
        const y = movement.getPublishable(ID)!.position.y;
        if (y > maxY) maxY = y;
      }

      // A single jump peaks at jumpSpeed^2 / (2*|g|) ≈ 1.62 m above launch
      // (~0.9 m) → apex ≈ 2.5 m. A replayed (double) edge would roughly double
      // the height (≈ 3.2+ m). Bound the apex to prove a single edge.
      expect(maxY).toBeGreaterThan(PLAYER_SPAWN.y + 1.0);
      expect(maxY).toBeLessThan(PLAYER_SPAWN.y + 2.0);
    });

    it("does not double-jump while airborne", () => {
      movement.createPlayer(ID);
      movement.enqueueFrame(ID, frame({ sequence: 0, jump: true }));
      movement.runTick(TICK); // airborne now

      // A second jump frame while airborne must NOT re-launch (no extra
      // velocity kick). Compare the apex against a clean single jump.
      movement.enqueueFrame(ID, frame({ sequence: 1, jump: true }));
      let maxY = movement.getPublishable(ID)!.position.y;
      for (let i = 0; i < 180; i++) {
        movement.runTick(TICK);
        const y = movement.getPublishable(ID)!.position.y;
        if (y > maxY) maxY = y;
      }

      // Still a single-jump-scale apex — the airborne jump press was ignored.
      expect(maxY).toBeLessThan(PLAYER_SPAWN.y + 2.0);
    });

    it("does not double-jump from a later press during ascent", () => {
      movement.createPlayer(ID);
      movement.enqueueFrame(ID, frame({ sequence: 0, jump: true }));
      movement.runTick(TICK);
      movement.runTick(TICK);
      movement.runTick(TICK);

      movement.enqueueFrame(ID, frame({ sequence: 1, jump: true }));
      let maxY = movement.getPublishable(ID)!.position.y;
      for (let i = 0; i < 180; i++) {
        movement.runTick(TICK);
        maxY = Math.max(maxY, movement.getPublishable(ID)!.position.y);
      }

      expect(maxY).toBeLessThan(PLAYER_SPAWN.y + 2.0);
    });
  });

  describe("collision", () => {
    it("cannot pass through the central arena collider", () => {
      movement.createPlayer(ID);
      // Spawn is at z≈6; the central box's near face is at z≈1.25, so sustained
      // forward motion is blocked by the capsule radius before z≈1.6.
      movement.enqueueFrame(ID, frame({ sequence: 0, moveZ: -1 }));
      let lastZ = movement.getPublishable(ID)!.position.z;
      let minZ = lastZ;
      for (let i = 0; i < 200; i++) {
        movement.runTick(TICK); // held forward persists
        const z = movement.getPublishable(ID)!.position.z;
        minZ = Math.min(minZ, z);
        lastZ = z;
      }
      // The player never penetrated the box (its front face is at z≈1.25,
      // capsule radius 0.35 → centre stops ≈1.6).
      expect(minZ).toBeGreaterThan(1.2);
      expect(lastZ).toBeGreaterThan(1.2);
    });

    it("lands on and stays on the ground (grounding works)", () => {
      movement.createPlayer(ID);
      // No input: the player falls from spawn and rests on the ground platform
      // (capsule centre ≈ ground top + capsule halfHeight ≈ 0.55).
      let y = movement.getPublishable(ID)!.position.y;
      for (let i = 0; i < 300; i++) {
        movement.runTick(TICK);
      }
      y = movement.getPublishable(ID)!.position.y;
      // Rested on the ground: capsule centre sits a little above y=0 and has
      // not sunk through it.
      expect(y).toBeGreaterThan(0.3);
      expect(y).toBeLessThan(1.2);
      // Further ticks do not drive it below the ground.
      for (let i = 0; i < 20; i++) movement.runTick(TICK);
      const yAfter = movement.getPublishable(ID)!.position.y;
      expect(yAfter).toBeGreaterThan(0.3);
      expect(yAfter).toBeCloseTo(y, 1);
    });
  });

  describe("lifecycle", () => {
    it("removePlayer drops the simulation player", () => {
      movement.createPlayer(ID);
      expect(movement.hasPlayer(ID)).toBe(true);
      expect(movement.getPublishable(ID)).not.toBeNull();

      movement.removePlayer(ID);
      expect(movement.hasPlayer(ID)).toBe(false);
      expect(movement.getPublishable(ID)).toBeNull();
    });

    it("removePlayer and dispose are idempotent (safe to re-call)", () => {
      movement.createPlayer(ID);
      movement.removePlayer(ID);
      expect(() => movement.removePlayer(ID)).not.toThrow();
      expect(() => movement.dispose()).not.toThrow();
      // Disposing an already-empty world does not throw.
      expect(() => movement.dispose()).not.toThrow();
    });
  });
});
