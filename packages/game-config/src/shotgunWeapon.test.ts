/**
 * Drift tests for the 1v1 Energy Box Fight weapon roster
 * (`shotgunWeapon.ts`).
 *
 * Mirrors the style of `weapons.test.ts` / `energyWeapons.test.ts`: small,
 * focused assertions on the exact shotgun / assault-rifle balance values and
 * the string-id lookup so any accidental re-tune fails the build loudly.
 */
import { describe, expect, it } from "vitest";
import {
  ASSAULT_RIFLE_WEAPON,
  ENERGY_FIGHT_WEAPONS,
  ENERGY_FIGHT_WEAPON_IDS,
  SHOTGUN_WEAPON,
  getEnergyFightWeaponById,
  isEnergyFightWeaponId,
} from "./index.js";

describe("SHOTGUN_WEAPON (1v1 Energy Box Fight pellet weapon)", () => {
  it("has the expected id, kind, and pellet fields", () => {
    expect(SHOTGUN_WEAPON.id).toBe("shotgun");
    expect(SHOTGUN_WEAPON.kind).toBe("shotgun");
    expect(SHOTGUN_WEAPON.pellets).toBe(8);
    expect(SHOTGUN_WEAPON.perPelletDamage).toBe(12);
    expect(SHOTGUN_WEAPON.spreadDegrees).toBe(12);
  });

  it("has the expected fire / magazine / reload / range fields", () => {
    expect(SHOTGUN_WEAPON.fireRatePerSec).toBe(2);
    expect(SHOTGUN_WEAPON.magazineSize).toBe(4);
    expect(SHOTGUN_WEAPON.reloadTimeMs).toBe(2500);
    expect(SHOTGUN_WEAPON.range).toBe(20);
  });

  it("is internally consistent", () => {
    expect(SHOTGUN_WEAPON.pellets).toBeGreaterThan(0);
    expect(SHOTGUN_WEAPON.perPelletDamage).toBeGreaterThan(0);
    expect(SHOTGUN_WEAPON.spreadDegrees).toBeGreaterThan(0);
    expect(SHOTGUN_WEAPON.fireRatePerSec).toBeGreaterThan(0);
    expect(SHOTGUN_WEAPON.magazineSize).toBeGreaterThan(0);
    expect(SHOTGUN_WEAPON.reloadTimeMs).toBeGreaterThan(0);
    expect(SHOTGUN_WEAPON.range).toBeGreaterThan(0);
  });
});

describe("ASSAULT_RIFLE_WEAPON (1v1 Energy Box Fight hitscan weapon)", () => {
  it("has the expected id, kind, and single-shot fields", () => {
    expect(ASSAULT_RIFLE_WEAPON.id).toBe("assault_rifle");
    expect(ASSAULT_RIFLE_WEAPON.kind).toBe("assault_rifle");
    expect(ASSAULT_RIFLE_WEAPON.perShotDamage).toBe(20);
    expect(ASSAULT_RIFLE_WEAPON.fireRatePerSec).toBe(12.5);
    expect(ASSAULT_RIFLE_WEAPON.magazineSize).toBe(30);
    expect(ASSAULT_RIFLE_WEAPON.reloadTimeMs).toBe(1800);
    expect(ASSAULT_RIFLE_WEAPON.range).toBe(60);
  });
});

describe("ENERGY_FIGHT_WEAPONS (1v1 Energy Box Fight weapon roster)", () => {
  it("exposes both weapons keyed by their stable string id", () => {
    expect(ENERGY_FIGHT_WEAPONS.shotgun).toBe(SHOTGUN_WEAPON);
    expect(ENERGY_FIGHT_WEAPONS.assault_rifle).toBe(ASSAULT_RIFLE_WEAPON);
    expect(Object.keys(ENERGY_FIGHT_WEAPONS).sort()).toEqual([
      "assault_rifle",
      "shotgun",
    ]);
  });

  it("resolves each weapon by id and returns undefined for unknown ids", () => {
    expect(getEnergyFightWeaponById("shotgun")?.id).toBe("shotgun");
    expect(getEnergyFightWeaponById("assault_rifle")?.id).toBe("assault_rifle");
    expect(getEnergyFightWeaponById("does-not-exist")).toBeUndefined();
    expect(getEnergyFightWeaponById("")).toBeUndefined();
  });

  it("discriminates on kind (shotgun has pellets, rifle has perShotDamage)", () => {
    const shotgun = getEnergyFightWeaponById("shotgun");
    const rifle = getEnergyFightWeaponById("assault_rifle");
    expect(shotgun?.kind).toBe("shotgun");
    expect(rifle?.kind).toBe("assault_rifle");
    if (shotgun?.kind === "shotgun") {
      expect(shotgun.pellets).toBe(8);
    }
    if (rifle?.kind === "assault_rifle") {
      expect(rifle.perShotDamage).toBe(20);
    }
  });
});

describe("Energy Box Fight weapon id vocabulary", () => {
  it("exposes shotgun and assault_rifle as valid ids", () => {
    expect(ENERGY_FIGHT_WEAPON_IDS).toEqual(["shotgun", "assault_rifle"]);
    expect(isEnergyFightWeaponId("shotgun")).toBe(true);
    expect(isEnergyFightWeaponId("assault_rifle")).toBe(true);
  });

  it("rejects unknown / non-string ids", () => {
    expect(isEnergyFightWeaponId("blaster")).toBe(false);
    expect(isEnergyFightWeaponId("")).toBe(false);
    expect(isEnergyFightWeaponId(42)).toBe(false);
    expect(isEnergyFightWeaponId(null)).toBe(false);
  });
});
