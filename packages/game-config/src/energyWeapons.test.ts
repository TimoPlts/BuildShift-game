/**
 * Drift tests for the Energy Box Fight weapon configuration.
 *
 * Mirrors the style of `weapons.test.ts`: small, focused assertions on the
 * exact shotgun balance values and the shared id vocabulary so any accidental
 * re-tune fails the build loudly. The authoritative server and the client both
 * read these from `@buildshift/game-config`, so pinning them here guards the
 * Energy Box Fight weapon contract.
 */
import { describe, expect, it } from "vitest";
import {
  ENERGY_SHOTGUN,
  ENERGY_WEAPONS,
  ENERGY_WEAPON_IDS,
  getEnergyWeaponById,
  isEnergyWeaponId,
} from "./index.js";

describe("ENERGY_SHOTGUN (Energy Box Fight pellet weapon)", () => {
  it("has the expected id and pellet fields", () => {
    expect(ENERGY_SHOTGUN.id).toBe("shotgun");
    expect(ENERGY_SHOTGUN.pelletCount).toBe(8);
    expect(ENERGY_SHOTGUN.perPelletDamage).toBe(12);
    expect(ENERGY_SHOTGUN.spreadAngleDeg).toBe(12);
  });

  it("has the expected range-falloff, magazine, and reload fields", () => {
    expect(ENERGY_SHOTGUN.rangeFalloffStart).toBe(5);
    expect(ENERGY_SHOTGUN.rangeFalloffEnd).toBe(20);
    expect(ENERGY_SHOTGUN.magazineCapacity).toBe(8);
    expect(ENERGY_SHOTGUN.reloadDurationMs).toBe(2500);
  });

  it("is internally consistent (falloff window is positive, pellets > 0)", () => {
    expect(ENERGY_SHOTGUN.pelletCount).toBeGreaterThan(0);
    expect(ENERGY_SHOTGUN.perPelletDamage).toBeGreaterThan(0);
    expect(ENERGY_SHOTGUN.spreadAngleDeg).toBeGreaterThan(0);
    expect(ENERGY_SHOTGUN.rangeFalloffEnd).toBeGreaterThan(ENERGY_SHOTGUN.rangeFalloffStart);
    expect(ENERGY_SHOTGUN.magazineCapacity).toBeGreaterThan(0);
    expect(ENERGY_SHOTGUN.reloadDurationMs).toBeGreaterThan(0);
  });
});

describe("Energy Box Fight weapon id vocabulary", () => {
  it("exposes shotgun and assault_rifle as valid ids", () => {
    expect(ENERGY_WEAPON_IDS).toEqual(["shotgun", "assault_rifle"]);
    expect(isEnergyWeaponId("shotgun")).toBe(true);
    expect(isEnergyWeaponId("assault_rifle")).toBe(true);
  });

  it("rejects unknown / non-string ids", () => {
    expect(isEnergyWeaponId("blaster")).toBe(false);
    expect(isEnergyWeaponId("")).toBe(false);
    expect(isEnergyWeaponId(42)).toBe(false);
    expect(isEnergyWeaponId(null)).toBe(false);
  });

  it("has unique id values", () => {
    expect(new Set(ENERGY_WEAPON_IDS).size).toBe(ENERGY_WEAPON_IDS.length);
  });
});

describe("ENERGY_WEAPONS (Energy Box Fight weapon roster)", () => {
  it("exposes the shotgun and resolves it by id", () => {
    expect(ENERGY_WEAPONS.map((w) => w.id)).toEqual(["shotgun"]);
    expect(getEnergyWeaponById("shotgun")?.id).toBe("shotgun");
    expect(getEnergyWeaponById("shotgun")).toBe(ENERGY_SHOTGUN);
  });

  it("resolves undefined for ids not in the roster", () => {
    expect(getEnergyWeaponById("assault_rifle")).toBeUndefined();
    expect(getEnergyWeaponById("does-not-exist")).toBeUndefined();
  });
});
