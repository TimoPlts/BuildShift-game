/**
 * Behavioral tests for crouch in {@link PredictionOrchestrator}:
 *  - a crouched tick advances the local player at the crouch speed (the
 *    shared-config `crouchSpeedFactor`), not the standing speed;
 *  - crouch state follows the input (down -> true, released -> false) and is
 *    exposed via {@link PredictionOrchestrator.getCrouched};
 *  - a server state snaps the local crouch to the authoritative value (the
 *    server keeps a player crouched while standing up is obstructed), so the
 *    local blend can be driven off it;
 *  - reset() clears the local crouch state.
 */
import { describe, expect, it } from "vitest";
import { PLAYER_MOVEMENT } from "@buildshift/game-config";
import { PredictionOrchestrator } from "./predictionOrchestrator";

const FACTOR = PLAYER_MOVEMENT.crouchSpeedFactor;

/** A single-tick movement input. */
function tick(moveX: number, crouch: boolean) {
  return { moveX, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch };
}

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** A minimal authoritative state carrying only the crouch flag (plus defaults). */
function serverState(sequence: number, crouch: boolean) {
  return {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    velocityY: 0,
    grounded: true,
    sequence,
    crouch,
  };
}

describe("PredictionOrchestrator crouch", () => {
  it("crouched ticks advance at the crouch speed (slower than standing)", () => {
    const po = new PredictionOrchestrator();

    po.reset();
    const stand = po.predict(tick(1, false));
    const standStep = dist(stand, { x: 0, y: 0, z: 0 });

    po.reset();
    const crouch = po.predict(tick(1, true));
    const crouchStep = dist(crouch, { x: 0, y: 0, z: 0 });

    expect(standStep).toBeGreaterThan(0);
    expect(crouchStep).toBeGreaterThan(0);
    // The crouched displacement is the standing displacement * the factor.
    expect(crouchStep).toBeCloseTo(standStep * FACTOR, 3);
    expect(crouchStep).toBeLessThan(standStep);
  });

  it("crouch state follows the input and is exposed via getCrouched", () => {
    const po = new PredictionOrchestrator();
    po.reset();
    expect(po.getCrouched()).toBe(false);

    po.predict(tick(1, false));
    expect(po.getCrouched()).toBe(false);

    po.predict(tick(1, true));
    expect(po.getCrouched()).toBe(true);

    po.predict(tick(1, false));
    expect(po.getCrouched()).toBe(false);
  });

  it("a server state snaps the local crouch to the authoritative value", () => {
    const po = new PredictionOrchestrator();
    po.reset();
    po.predict(tick(1, true));
    expect(po.getCrouched()).toBe(true);

    // Server confirms crouch=true.
    po.onServerState(serverState(1, true), []);
    expect(po.getCrouched()).toBe(true);

    // Server later reports crouch=false (the player stood up).
    po.onServerState(serverState(2, false), []);
    expect(po.getCrouched()).toBe(false);
  });

  it("reset() clears the local crouch state", () => {
    const po = new PredictionOrchestrator();
    po.predict(tick(1, true));
    expect(po.getCrouched()).toBe(true);

    po.reset();
    expect(po.getCrouched()).toBe(false);
  });
});
