/**
 * Contract tests for the first combat milestone's protocol surface:
 *   - the combat `EVENTS` identifiers (plus a regression guard on the
 *     pre-existing `PLAYER_INPUT`),
 *   - the `HitEventPayload` message type, and
 *   - the `PlayerInput` per-tick input payload.
 *
 * These pin the exact shared names / shapes so the authoritative server and
 * the client stay in agreement.
 */
import { describe, expect, it } from "vitest";
import {
  EVENTS,
  type EventName,
  type HitEventPayload,
  type PlayerInput,
} from "./index.js";

describe("EVENTS (combat milestone)", () => {
  it("declares the three combat event identifiers as strings", () => {
    expect(typeof EVENTS.HIT).toBe("string");
    expect(typeof EVENTS.ELIMINATED).toBe("string");
    expect(typeof EVENTS.HEALTH_UPDATE).toBe("string");
    expect(EVENTS.HIT).toBe("combat:hit");
    expect(EVENTS.ELIMINATED).toBe("combat:eliminated");
    expect(EVENTS.HEALTH_UPDATE).toBe("combat:health");
  });

  it("still exposes the pre-existing PLAYER_INPUT identifier (regression)", () => {
    expect(EVENTS.PLAYER_INPUT).toBe("player:input");
  });

  it("has unique event name values", () => {
    const values = Object.values(EVENTS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("types every declared event as an EventName", () => {
    // Compile-time: each key maps to an EventName.
    const names: EventName[] = [
      EVENTS.PLAYER_INPUT,
      EVENTS.HIT,
      EVENTS.ELIMINATED,
      EVENTS.HEALTH_UPDATE,
    ];
    expect(names).toHaveLength(4);
  });
});

describe("HitEventPayload (combat message)", () => {
  it("has the expected structural shape", () => {
    const payload: HitEventPayload = {
      shooterId: "session-a",
      targetId: "session-b",
      damage: 20,
      remainingHealth: 80,
    };

    expect(payload.shooterId).toBe("session-a");
    expect(payload.targetId).toBe("session-b");
    expect(payload.damage).toBe(20);
    expect(payload.remainingHealth).toBe(80);
  });

  it("supports a zero remainingHealth (elimination) payload", () => {
    const payload: HitEventPayload = {
      shooterId: "a",
      targetId: "b",
      damage: 100,
      remainingHealth: 0,
    };

    expect(payload.remainingHealth).toBe(0);
  });
});

describe("PlayerInput (plain per-tick input payload)", () => {
  it("has the expected structural shape", () => {
    const input: PlayerInput = {
      sequence: 7,
      moveX: 1,
      moveZ: -1,
      lookYaw: Math.PI / 2,
      lookPitch: 0,
      jump: false,
      primaryFire: true,
    };

    expect(input.sequence).toBe(7);
    expect(input.moveX).toBe(1);
    expect(input.moveZ).toBe(-1);
    expect(input.lookYaw).toBeCloseTo(Math.PI / 2);
    expect(input.lookPitch).toBe(0);
    expect(input.jump).toBe(false);
    expect(input.primaryFire).toBe(true);
  });
});
