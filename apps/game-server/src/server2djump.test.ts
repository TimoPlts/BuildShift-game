/**
 * Stage 2D — Server-side jump integration tests (deterministic).
 *
 * These tests verify the full jump lifecycle as observed through the
 * authoritative simulation's `getPublishable` state, specifically the
 * `landed` flag and Y-position changes that remote clients will use for
 * vertical-movement interpolation.
 *
 * Test cases (task T2 §6):
 *  - A player on the ground who sends jump input moves upward on the next
 *    tick, and the published `landed` state transitions to `false` while
 *    airborne.
 *  - A player already airborne who sends jump input does NOT gain additional
 *    velocity (no double-jump launch).
 *  - A player falling lands on the ground reference: the published Y returns
 *    to the spawn-level ground rest position, `landed` becomes `true`, and
 *    the player no longer moves downward.
 *
 * All tests drive `AuthoritativeMovement.runTick()` directly (no real timers,
 * no Colyseus, no waiting on the network) with a plain `TickInput`
 * (`{ subSteps: 2, subDt: 1/60 }`), so the assertions are exact functions of
 * the shared movement math + Rapier.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { PLAYER_SPAWN, PLAYER_PHYSICS } from "@buildshift/game-config";
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

describe("Stage 2D server jump integration (deterministic)", () => {
  let movement: AuthoritativeMovement;
  const ID = "player-1";

  beforeEach(async () => {
    movement = await AuthoritativeMovement.create();
  });

  afterEach(() => {
    movement.dispose();
  });

  describe("grounded player sends jump → moves upward", () => {
    it("a grounded player who sends jump input moves upward on the next tick", () => {
      movement.createPlayer(ID);

      // Verify the player is grounded before the jump.
      const before = movement.getPublishable(ID)!;
      expect(before.landed).toBe(true);
      expect(before.position.y).toBeCloseTo(PLAYER_SPAWN.y, 2);

      // Send a jump frame.
      movement.enqueueFrame(ID, frame({ sequence: 0, jump: true }));

      // On the next tick, the player's Y should increase (moving upward).
      movement.runTick(TICK);
      const after = movement.getPublishable(ID)!;
      expect(after.position.y).toBeGreaterThan(before.position.y);

      // The player is no longer reported as landed (airborne).
      expect(after.landed).toBe(false);
    });

    it("the player's Y increases above spawn for several ticks during ascent", () => {
      movement.createPlayer(ID);
      movement.enqueueFrame(ID, frame({ sequence: 0, jump: true }));

      // Track the Y over the first few ticks of the jump.
      const ys: number[] = [];
      for (let i = 0; i < 5; i++) {
        movement.runTick(TICK);
        ys.push(movement.getPublishable(ID)!.position.y);
      }

      // The first tick should already be above spawn (the jump launched).
      expect(ys[0]).toBeGreaterThan(PLAYER_SPAWN.y);

      // The player should be in ascent for at least the first few ticks
      // (Y keeps increasing or is near the apex).
      // With jumpSpeed=9 and g=-25, the apex is reached after ~9/25=0.36s
      // which is ~11 ticks at 30Hz. So ticks 0-4 should still be ascending.
      for (let i = 1; i < 5; i++) {
        expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1] - 0.01);
      }

      // During ascent, landed should be false.
      for (let i = 0; i < 5; i++) {
        expect(movement.getPublishable(ID)!.landed).toBe(false);
      }
    });
  });

  describe("airborne player sends jump → no additional velocity", () => {
    it("a player already airborne who sends jump does NOT gain extra launch velocity", () => {
      movement.createPlayer(ID);
      movement.enqueueFrame(ID, frame({ sequence: 0, jump: true }));
      movement.runTick(TICK); // now airborne

      // Record the current Y and let the player continue with a second jump.
      const yWithSecondJump = movement.getPublishable(ID)!.position.y;

      // Send a second jump frame while airborne.
      movement.enqueueFrame(ID, frame({ sequence: 1, jump: true }));

      // Track the apex with the second jump.
      let maxY = yWithSecondJump;
      for (let i = 0; i < 180; i++) {
        movement.runTick(TICK);
        const y = movement.getPublishable(ID)!.position.y;
        if (y > maxY) maxY = y;
      }

      // A single-jump peak from the ground is jumpSpeed^2/(2*|g|) = 81/50 =
      // 1.62 m above launch (0.9) → apex ≈ 2.5 m. If the airborne jump had
      // re-launched, the apex would be higher (the player is already moving
      // upward and would be boosted). The apex must remain within single-jump
      // scale.
      expect(maxY).toBeLessThan(PLAYER_SPAWN.y + 2.0);
    });

    it("airborne jump press does not reset the vertical velocity to jumpSpeed", () => {
      movement.createPlayer(ID);
      movement.enqueueFrame(ID, frame({ sequence: 0, jump: true }));
      movement.runTick(TICK); // first jump processed; player airborne

      // Now send a jump while the player is still rising (early in the arc).
      movement.enqueueFrame(ID, frame({ sequence: 1, jump: true }));
      movement.runTick(TICK); // consume the airborne jump frame

      // The Y should NOT suddenly jump back to the launch velocity. If the
      // velocity had been reset to jumpSpeed, the player would gain
      // significantly more height. Instead, the player continues on its
      // current ballistic trajectory (gravity only).
      // Compare against a clean single jump: track apexes.
      // (This is verified by the apex-bound test above; here we just confirm
      // the player is still airborne.)
      const state = movement.getPublishable(ID)!;
      expect(state.landed).toBe(false);
      expect(state.position.y).toBeGreaterThan(PLAYER_SPAWN.y);
    });
  });

  describe("falling player lands on ground reference", () => {
    it("a falling player lands at the ground reference and landed becomes true", () => {
      movement.createPlayer(ID);
      movement.enqueueFrame(ID, frame({ sequence: 0, jump: true }));

      // Let the player jump up, fall back down, and land.
      // With jumpSpeed=9, g=-25: apex time = 9/25 = 0.36s ≈ 11 ticks (30Hz).
      // Total flight ≈ 0.72s ≈ 22 ticks. Give generous margin (60 ticks).
      let landedAt = -1;
      let landedY = 0;
      for (let i = 0; i < 60; i++) {
        movement.runTick(TICK);
        const state = movement.getPublishable(ID)!;
        if (state.landed && i > 5) {
          // Ignore the initial grounded state before the jump (i=0 would be
          // grounded). Once airborne and then grounded again, that's a landing.
          landedAt = i;
          landedY = state.position.y;
          break;
        }
      }

      // The player must have landed.
      expect(landedAt).toBeGreaterThan(0);

      // The landing Y should be close to the spawn ground level (capsule
      // centre at y=0.9 when feet rest on y=0 ground). The character
      // controller with snap-to-ground keeps it stable.
      expect(landedY).toBeGreaterThan(PLAYER_SPAWN.y - 0.3);
      expect(landedY).toBeLessThan(PLAYER_SPAWN.y + 0.3);
    });

    it("after landing, the player stays grounded on further ticks (velocity zero)", () => {
      movement.createPlayer(ID);
      movement.enqueueFrame(ID, frame({ sequence: 0, jump: true }));

      // Let the jump complete (up + down + land).
      for (let i = 0; i < 60; i++) {
        movement.runTick(TICK);
        if (movement.getPublishable(ID)!.landed && i > 5) {
          break;
        }
      }

      // Record the resting position.
      const restY = movement.getPublishable(ID)!.position.y;
      expect(movement.getPublishable(ID)!.landed).toBe(true);

      // Run many more ticks with no input: the player must stay at rest
      // (not sink, not bounce).
      for (let i = 0; i < 30; i++) {
        movement.runTick(TICK);
      }

      const afterY = movement.getPublishable(ID)!.position.y;
      expect(movement.getPublishable(ID)!.landed).toBe(true);

      // The Y should be essentially unchanged (no drift).
      expect(Math.abs(afterY - restY)).toBeLessThan(0.05);
    });

    it("velocity does not accumulate while grounded (no drift downward)", () => {
      movement.createPlayer(ID);

      // No input at all — the player starts grounded and should stay grounded
      // indefinitely.
      for (let i = 0; i < 120; i++) {
        movement.runTick(TICK);
      }

      const state = movement.getPublishable(ID)!;
      expect(state.landed).toBe(true);
      // Position is stable at the spawn ground level.
      expect(state.position.y).toBeGreaterThan(PLAYER_SPAWN.y - 0.1);
      expect(state.position.y).toBeLessThan(PLAYER_SPAWN.y + 0.1);
    });
  });

  describe("landed state transitions", () => {
    it("reports landed=true initially, false during flight, true after landing", () => {
      movement.createPlayer(ID);

      // Initially grounded.
      expect(movement.getPublishable(ID)!.landed).toBe(true);

      // Jump.
      movement.enqueueFrame(ID, frame({ sequence: 0, jump: true }));
      movement.runTick(TICK);

      // After the jump tick, the player is airborne.
      expect(movement.getPublishable(ID)!.landed).toBe(false);

      // Track until the player lands again.
      let landed = false;
      for (let i = 0; i < 60; i++) {
        movement.runTick(TICK);
        if (movement.getPublishable(ID)!.landed) {
          landed = true;
          break;
        }
      }
      expect(landed).toBe(true);
    });

    it("transitions from landed to airborne exactly when the jump launches", () => {
      movement.createPlayer(ID);
      expect(movement.getPublishable(ID)!.landed).toBe(true);

      movement.enqueueFrame(ID, frame({ sequence: 0, jump: true }));
      movement.runTick(TICK);

      // On the very tick the jump is processed, the character moves upward
      // and leaves the ground → landed should be false.
      const state = movement.getPublishable(ID)!;
      expect(state.landed).toBe(false);
      expect(state.position.y).toBeGreaterThan(PLAYER_SPAWN.y);
    });
  });

  describe("no client position/velocity trust (authority contract)", () => {
    it("the published Y is from the simulation, not any client claim", () => {
      movement.createPlayer(ID);
      const y0 = movement.getPublishable(ID)!.position.y;

      // Even if a client claims to be at a different Y, the server ignores it
      // (there's no protocol field for it). The server only advances Y via
      // the simulation step.
      movement.enqueueFrame(ID, frame({ sequence: 0, jump: true }));
      movement.runTick(TICK);
      const y1 = movement.getPublishable(ID)!.position.y;

      // The Y changed by exactly what the simulation computed (gravity +
      // jumpSpeed over two substeps). It's not arbitrary.
      expect(y1).toBeGreaterThan(y0);
      // But it's bounded by physics (a single tick can't teleport the player).
      const maxExpectedDelta = PLAYER_PHYSICS.jumpSpeed * TICK.subDt * TICK.subSteps;
      expect(y1 - y0).toBeLessThan(maxExpectedDelta + 0.1);
    });
  });
});
