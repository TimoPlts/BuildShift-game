/**
 * Drift tests for the shared weapon / player combat configuration.
 *
 * Mirrors the style of `game-config.test.ts`: small, focused assertions on the
 * exact values so any accidental re-tune of a weapon or player combat default
 * fails the build loudly. The authoritative server and the client both read
 * these from `@buildshift/game-config`, so pinning them here guards the
 * combat contract.
 */
import { describe, expect, it } from "vitest";
import {
  ASSAULT_RIFLE,
  MAX_HEALTH,
  MAX_SHIELD,
  PLAYER,
  SHOTGUN,
  WEAPONS,
  getWeaponById,
} from "./index.js";

describe("SHOTGUN (canonical weapon config)", () => {
  it("has the expected combat values", () => {
    expect(SHOTGUN.id).toBe("shotgun");
    expect(SHOTGUN.kind).toBe("hitscan");
    expect(SHOTGUN.damage).toBe(80);
    expect(SHOTGUN.fireIntervalTicks).toBe(35);
    expect(SHOTGUN.maxAmmo).toBe(5);
    expect(SHOTGUN.maxReserve).toBe(20);
    expect(SHOTGUN.reloadTicks).toBe(45);
  });
});

describe("ASSAULT_RIFLE (canonical weapon config)", () => {
  it("has the expected combat values", () => {
    expect(ASSAULT_RIFLE.id).toBe("assault_rifle");
    expect(ASSAULT_RIFLE.kind).toBe("hitscan");
    expect(ASSAULT_RIFLE.damage).toBe(20);
    expect(ASSAULT_RIFLE.fireIntervalTicks).toBe(8);
    expect(ASSAULT_RIFLE.maxAmmo).toBe(30);
    expect(ASSAULT_RIFLE.maxReserve).toBe(60);
    expect(ASSAULT_RIFLE.reloadTicks).toBe(60);
  });
});

describe("WEAPONS (shared weapon roster)", () => {
  it("exposes shotgun, assault_rifle, and the legacy blaster", () => {
    expect(WEAPONS.map((w) => w.id).sort()).toEqual(
      ["assault_rifle", "blaster", "shotgun"].sort(),
    );
  });

  it("has unique weapon ids", () => {
    const ids = WEAPONS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves a weapon by id and returns undefined for unknown ids", () => {
    expect(getWeaponById("shotgun")?.id).toBe("shotgun");
    expect(getWeaponById("assault_rifle")?.id).toBe("assault_rifle");
    expect(getWeaponById("blaster")?.id).toBe("blaster");
    expect(getWeaponById("does-not-exist")).toBeUndefined();
  });
});

describe("Player combat defaults", () => {
  it("uses MAX_HEALTH 100 and MAX_SHIELD 50", () => {
    expect(MAX_HEALTH).toBe(100);
    expect(MAX_SHIELD).toBe(50);
  });

  it("mirrors the legacy PLAYER accessors (regression)", () => {
    expect(PLAYER.maxHealth).toBe(MAX_HEALTH);
    expect(PLAYER.maxShield).toBe(MAX_SHIELD);
  });
});
