/**
 * Drift tests for the shared weapon / player combat configuration.
 *
 * Mirrors the style of `game-config.test.ts`: small, focused assertions on the
 * exact values so any accidental re-tune of the blaster or player health fails
 * the build loudly. The authoritative server and the client both read these
 * from `@buildshift/game-config`, so pinning them here guards the combat
 * contract.
 */
import { describe, expect, it } from "vitest";
import { PLAYER, WEAPONS, getWeaponById } from "./index.js";

describe("WEAPONS (shared weapon config)", () => {
  it("contains exactly the blaster hitscan weapon", () => {
    expect(WEAPONS.map((w) => w.id)).toEqual(["blaster"]);
  });

  it("defines the blaster with the expected combat values", () => {
    const blaster = WEAPONS[0];
    expect(blaster.id).toBe("blaster");
    expect(blaster.kind).toBe("hitscan");
    expect(blaster.damage).toBe(20);
    expect(blaster.range).toBe(50);
    expect(blaster.fireCooldownMs).toBe(333);
  });

  it("resolves a weapon by id and returns undefined for unknown ids", () => {
    expect(getWeaponById("blaster")?.id).toBe("blaster");
    expect(getWeaponById("does-not-exist")).toBeUndefined();
  });
});

describe("PLAYER (shared combat tuning)", () => {
  it("uses maxHealth 100", () => {
    expect(PLAYER.maxHealth).toBe(100);
  });
});
