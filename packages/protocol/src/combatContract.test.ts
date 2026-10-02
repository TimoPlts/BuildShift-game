/**
 * Contract tests for the canonical hitscan combat protocol surface:
 *   - the combat `EVENTS` identifiers (plus a regression guard on the
 *     pre-existing `PLAYER_INPUT`),
 *   - the `HitResultEvent` / `PlayerEliminatedEvent` payloads (and the
 *     legacy `HitEventPayload`),
 *   - the `WeaponId` vocabulary, and
 *   - the `PlayerInput` per-tick input payload (now with a `0`/`1`
 *     `primaryFire` edge).
 *
 * These pin the exact shared names / shapes so the authoritative server and
 * the client stay in agreement.
 */
import { describe, expect, it } from "vitest";
import {
  EVENTS,
  type EventName,
  type HitEventPayload,
  type HitResultEvent,
  type PlayerEliminatedEvent,
  type PlayerInput,
  WEAPON_IDS,
  isWeaponId,
  type WeaponId,
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

describe("WeaponId (shared weapon vocabulary)", () => {
  it("exposes shotgun and assault_rifle as valid ids", () => {
    expect(WEAPON_IDS).toEqual(["shotgun", "assault_rifle"]);
    expect(isWeaponId("shotgun")).toBe(true);
    expect(isWeaponId("assault_rifle")).toBe(true);
  });

  it("rejects unknown / non-string ids", () => {
    expect(isWeaponId("blaster")).toBe(false);
    expect(isWeaponId("")).toBe(false);
    expect(isWeaponId(42)).toBe(false);
    expect(isWeaponId(null)).toBe(false);
  });

  it("is usable as the weaponId on a hit event", () => {
    const weaponId: WeaponId = "assault_rifle";
    const event: HitResultEvent = {
      shooterId: "a",
      targetId: "b",
      damage: 20,
      hitPoint: { x: 1, y: 1.5, z: -10 },
      weaponId,
    };
    expect(event.weaponId).toBe("assault_rifle");
  });
});

describe("HitResultEvent (canonical hit payload)", () => {
  it("has the expected structural shape", () => {
    const event: HitResultEvent = {
      shooterId: "session-a",
      targetId: "session-b",
      damage: 80,
      hitPoint: { x: 0, y: 1.5, z: -12 },
      weaponId: "shotgun",
    };

    expect(event.shooterId).toBe("session-a");
    expect(event.targetId).toBe("session-b");
    expect(event.damage).toBe(80);
    expect(event.hitPoint).toEqual({ x: 0, y: 1.5, z: -12 });
    expect(event.weaponId).toBe("shotgun");
  });
});

describe("PlayerEliminatedEvent (canonical elimination payload)", () => {
  it("has the expected structural shape", () => {
    const event: PlayerEliminatedEvent = {
      eliminatedId: "session-b",
      eliminatedById: "session-a",
    };

    expect(event.eliminatedId).toBe("session-b");
    expect(event.eliminatedById).toBe("session-a");
  });
});

describe("HitEventPayload (legacy combat message)", () => {
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
  it("has the expected structural shape with a 0/1 primaryFire edge", () => {
    const input: PlayerInput = {
      sequence: 7,
      moveX: 1,
      moveZ: -1,
      lookYaw: Math.PI / 2,
      lookPitch: 0,
      jump: false,
      primaryFire: 1,
    };

    expect(input.sequence).toBe(7);
    expect(input.moveX).toBe(1);
    expect(input.moveZ).toBe(-1);
    expect(input.lookYaw).toBeCloseTo(Math.PI / 2);
    expect(input.lookPitch).toBe(0);
    expect(input.jump).toBe(false);
    expect(input.primaryFire).toBe(1);
  });

  it("supports a primaryFire edge of 0 (no fire)", () => {
    const input: PlayerInput = {
      sequence: 8,
      moveX: 0,
      moveZ: 0,
      lookYaw: 0,
      lookPitch: 0,
      jump: false,
      primaryFire: 0,
    };

    expect(input.primaryFire).toBe(0);
  });
});
