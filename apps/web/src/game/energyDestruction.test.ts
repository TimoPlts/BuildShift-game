/**
 * Energy economy + destructible structures — client contract tests.
 * Covers: EnergyTracker, StructureDurabilityTracker, event parsers,
 * and round-state cleanup.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  ENERGY_LIMITS, STRUCTURE_DURABILITY_LIMITS,
  type EnergyUpdateEvent, type StructureDamageEvent, type StructureDestroyedEvent,
} from "@buildshift/protocol";
import { ENERGY, getStructureConfig, getStructureDurability } from "@buildshift/game-config";
import { EnergyTracker } from "./energy/energyTracker";
import { StructureDurabilityTracker } from "./energy/structureDurabilityTracker";
import {
  parseEnergyUpdateEvent, parseStructureDamageEvent, parseStructureDestroyedEvent,
} from "./energy/energyStateParse";
import { parseStructureDurability } from "./network/structureStateParse";

describe("EnergyTracker", () => {
  let t: EnergyTracker;
  beforeEach(() => { t = new EnergyTracker(); });

  it("applyReplicatedEnergy sets values", () => {
    t.applyReplicatedEnergy({ p1: 80, p2: 50 });
    expect(t.getEnergy("p1")).toBe(80);
    expect(t.getEnergy("p2")).toBe(50);
    expect(t.playerCount).toBe(2);
  });

  it("applyReplicatedEnergy clamps to maxEnergy", () => {
    t.applyReplicatedEnergy({ p1: 99999 });
    expect(t.getEnergy("p1")).toBe(ENERGY.maxEnergy);
  });

  it("applyReplicatedEnergy clamps to 0", () => {
    t.applyReplicatedEnergy({ p1: -10 });
    expect(t.getEnergy("p1")).toBe(0);
  });

  it("applyReplicatedEnergy replaces (not merges)", () => {
    t.applyReplicatedEnergy({ p1: 80, p2: 50 });
    t.applyReplicatedEnergy({ p1: 60 });
    expect(t.playerCount).toBe(1);
    expect(t.getEnergy("p2")).toBeUndefined();
  });

  it("applyEnergyUpdate sets single player", () => {
    t.applyEnergyUpdate({ playerId: "p1", energy: 72 });
    expect(t.getEnergy("p1")).toBe(72);
  });

  it("applyEnergyUpdate clamps", () => {
    t.applyEnergyUpdate({ playerId: "p1", energy: 99999 });
    expect(t.getEnergy("p1")).toBe(ENERGY.maxEnergy);
    t.applyEnergyUpdate({ playerId: "p2", energy: -5 });
    expect(t.getEnergy("p2")).toBe(0);
  });

  it("canAffordStructure with sufficient energy", () => {
    t.applyReplicatedEnergy({ p1: 100 });
    expect(t.canAffordStructure("p1", "wall")).toBe(true);
    expect(t.canAffordStructure("p1", "floor")).toBe(true);
  });

  it("canAffordStructure with insufficient energy", () => {
    t.applyReplicatedEnergy({ p1: 5 });
    expect(t.canAffordStructure("p1", "wall")).toBe(false);
    expect(t.canAffordStructure("p1", "floor")).toBe(true);
  });

  it("canAffordStructure unknown player", () => {
    expect(t.canAffordStructure("unknown", "wall")).toBe(false);
  });

  it("canAffordStructure unknown buildType", () => {
    t.applyReplicatedEnergy({ p1: 100 });
    expect(t.canAffordStructure("p1", "tower")).toBe(false);
  });

  it("reset clears all", () => {
    t.applyReplicatedEnergy({ p1: 80 });
    t.reset();
    expect(t.playerCount).toBe(0);
    expect(t.getEnergy("p1")).toBeUndefined();
  });

  it("hasEnergy", () => {
    expect(t.hasEnergy("p1")).toBe(false);
    t.applyEnergyUpdate({ playerId: "p1", energy: 50 });
    expect(t.hasEnergy("p1")).toBe(true);
  });
});

describe("StructureDurabilityTracker", () => {
  let t: StructureDurabilityTracker;
  beforeEach(() => { t = new StructureDurabilityTracker(); });

  it("applyReplicated initializes from build type", () => {
    t.applyReplicated({ s1: "wall" }, {});
    const d = t.getDurability("s1")!;
    expect(d.maxDurability).toBe(200);
    expect(d.currentDurability).toBe(200);
  });

  it("applyReplicated uses replicated durability when present", () => {
    t.applyReplicated({ s1: "wall" }, { s1: { maxDurability: 200, currentDurability: 150 } });
    expect(t.getDurability("s1")!.currentDurability).toBe(150);
  });

  it("applyReplicated removes absent structures", () => {
    t.applyReplicated({ s1: "wall", s2: "floor" }, {});
    t.applyReplicated({ s1: "wall" }, {});
    expect(t.getDurability("s2")).toBeNull();
    expect(t.structureCount).toBe(1);
  });

  it("applyDamage updates durability", () => {
    t.applyReplicated({ s1: "wall" }, {});
    t.applyDamage({ structureId: "s1", damage: 20, remainingDurability: 180, sourcePlayerId: "p1", sourceWeaponId: "assault_rifle" });
    expect(t.getDurability("s1")!.currentDurability).toBe(180);
  });

  it("applyDamage marks destroyed at 0", () => {
    t.applyReplicated({ s1: "cone" }, {});
    t.applyDamage({ structureId: "s1", damage: 80, remainingDurability: 0, sourcePlayerId: "p1", sourceWeaponId: "assault_rifle" });
    expect(t.isDestroyed("s1")).toBe(true);
    expect(t.getDurability("s1")).toBeNull();
  });

  it("applyDestroyed removes entry", () => {
    t.applyReplicated({ s1: "wall" }, {});
    t.applyDestroyed("s1");
    expect(t.isDestroyed("s1")).toBe(true);
    expect(t.getDurability("s1")).toBeNull();
    expect(t.structureCount).toBe(0);
  });

  it("applyDestroyed idempotent", () => {
    t.applyDestroyed("s1");
    t.applyDestroyed("s1");
    expect(t.isDestroyed("s1")).toBe(true);
  });

  it("applyDestroyed ignores empty id", () => {
    t.applyDestroyed("");
    expect(t.isDestroyed("")).toBe(false);
  });

  it("stale sync does not resurrect destroyed", () => {
    t.applyReplicated({ s1: "wall" }, {});
    t.applyDestroyed("s1");
    t.applyReplicated({ s1: "wall" }, {});
    expect(t.isDestroyed("s1")).toBe(true);
    expect(t.getDurability("s1")).toBeNull();
  });

  it("sync confirms removal of pending destroyed", () => {
    t.applyReplicated({ s1: "wall" }, {});
    t.applyDestroyed("s1");
    expect(t.pendingDestroyedIds).toContain("s1");
    t.applyReplicated({}, {});
    expect(t.pendingDestroyedIds).not.toContain("s1");
  });

  it("reset clears all", () => {
    t.applyReplicated({ s1: "wall" }, {});
    t.applyDestroyed("s1");
    t.reset();
    expect(t.structureCount).toBe(0);
    expect(t.isDestroyed("s1")).toBe(false);
    expect(t.pendingDestroyedIds).toHaveLength(0);
  });
});

describe("parseEnergyUpdateEvent", () => {
  it("valid", () => {
    const r = parseEnergyUpdateEvent({ playerId: "p1", energy: 50 });
    expect(r).toEqual({ playerId: "p1", energy: 50 });
  });
  it("null for non-object", () => { expect(parseEnergyUpdateEvent(null)).toBeNull(); });
  it("null for missing playerId", () => { expect(parseEnergyUpdateEvent({ energy: 50 })).toBeNull(); });
  it("null for missing energy", () => { expect(parseEnergyUpdateEvent({ playerId: "p1" })).toBeNull(); });
  it("null for energy above protocol max", () => {
    expect(parseEnergyUpdateEvent({ playerId: "p1", energy: ENERGY_LIMITS.max + 1 })).toBeNull();
  });
  it("null for negative energy", () => {
    expect(parseEnergyUpdateEvent({ playerId: "p1", energy: -1 })).toBeNull();
  });
});

describe("parseStructureDamageEvent", () => {
  const valid = { structureId: "s1", damage: 20, remainingDurability: 180, sourcePlayerId: "p1", sourceWeaponId: "assault_rifle" };
  it("valid", () => {
    const r = parseStructureDamageEvent(valid);
    expect(r).toEqual(valid);
  });
  it("null for non-object", () => { expect(parseStructureDamageEvent(null)).toBeNull(); });
  it("null for missing structureId", () => { expect(parseStructureDamageEvent({ ...valid, structureId: "" })).toBeNull(); });
  it("null for zero damage", () => { expect(parseStructureDamageEvent({ ...valid, damage: 0 })).toBeNull(); });
  it("null for negative damage", () => { expect(parseStructureDamageEvent({ ...valid, damage: -1 })).toBeNull(); });
  it("null for remaining above protocol max", () => {
    expect(parseStructureDamageEvent({ ...valid, remainingDurability: STRUCTURE_DURABILITY_LIMITS.max + 1 })).toBeNull();
  });
  it("null for unknown weapon", () => { expect(parseStructureDamageEvent({ ...valid, sourceWeaponId: "laser" })).toBeNull(); });
});

describe("parseStructureDestroyedEvent", () => {
  const valid = { structureId: "s1", destroyedByPlayerId: "p1", destroyedByWeaponId: "assault_rifle" };
  it("valid", () => { expect(parseStructureDestroyedEvent(valid)).toEqual(valid); });
  it("null for non-object", () => { expect(parseStructureDestroyedEvent(null)).toBeNull(); });
  it("null for missing structureId", () => { expect(parseStructureDestroyedEvent({ ...valid, structureId: "" })).toBeNull(); });
  it("null for missing destroyer", () => { expect(parseStructureDestroyedEvent({ ...valid, destroyedByPlayerId: "" })).toBeNull(); });
  it("null for unknown weapon", () => { expect(parseStructureDestroyedEvent({ ...valid, destroyedByWeaponId: "laser" })).toBeNull(); });
});

describe("parseStructureDurability", () => {
  it("valid", () => {
    expect(parseStructureDurability({ maxDurability: 200, currentDurability: 150 })).toEqual({ maxDurability: 200, currentDurability: 150 });
  });
  it("null for non-object", () => { expect(parseStructureDurability(null)).toBeNull(); });
  it("null for missing fields", () => { expect(parseStructureDurability({ maxDurability: 200 })).toBeNull(); });
  it("null for current > max", () => { expect(parseStructureDurability({ maxDurability: 100, currentDurability: 150 })).toBeNull(); });
  it("null for negative", () => { expect(parseStructureDurability({ maxDurability: -1, currentDurability: 0 })).toBeNull(); });
  it("null for above protocol max", () => {
    expect(parseStructureDurability({ maxDurability: STRUCTURE_DURABILITY_LIMITS.max + 1, currentDurability: 0 })).toBeNull();
  });
});

describe("round-state cleanup", () => {
  it("EnergyTracker.reset drops all for rejoin", () => {
    const t = new EnergyTracker();
    t.applyReplicatedEnergy({ p1: 80, p2: 50 });
    t.reset();
    expect(t.playerCount).toBe(0);
    t.applyReplicatedEnergy({ p1: ENERGY.startingEnergy });
    expect(t.getEnergy("p1")).toBe(ENERGY.startingEnergy);
  });

  it("StructureDurabilityTracker.reset clears for rejoin", () => {
    const t = new StructureDurabilityTracker();
    t.applyReplicated({ s1: "wall", s2: "floor" }, {});
    t.applyDestroyed("s1");
    t.reset();
    expect(t.structureCount).toBe(0);
    expect(t.isDestroyed("s1")).toBe(false);
    t.applyReplicated({ s3: "cone" }, {});
    expect(t.structureCount).toBe(1);
    expect(t.getDurability("s3")!.maxDurability).toBe(getStructureDurability("cone")!);
  });
});
