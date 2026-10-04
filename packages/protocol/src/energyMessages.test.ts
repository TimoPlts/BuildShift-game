/**
 * Contract tests for the 1v1 Energy Box Fight first slice:
 *  - the `WeaponSwitch` / `StartReload` client → server messages,
 *  - the `currentWeapon` + per-weapon `weapons` state on `PlayerStateSchema`
 *    (and the `WeaponAmmoStateSchema` wire schema),
 *  - the `BuildEdit` / `BuildEditResult` messages + the structure `openings`
 *    vocabulary, and
 *  - the opening-pattern id guards.
 *
 * These pin the exact shared names / shapes so the authoritative server and
 * the client stay in agreement.
 */
import { describe, expect, it } from "vitest";
import {
  BUILD_EDIT_EVENTS,
  OPENING_PATTERNS,
  PlayerStateSchema,
  WeaponAmmoStateSchema,
  isStructureOpeningPattern,
  type BuildEdit,
  type BuildEditResult,
  type PlayerStateSchemaInstance,
  type StartReload,
  type StructureOpening,
  type StructureState,
  type WeaponAmmoState,
  type WeaponSwitch,
} from "./index.js";

describe("WeaponSwitch (client → server)", () => {
  it("carries the target weapon id", () => {
    const msg: WeaponSwitch = { targetWeaponId: "shotgun" };
    expect(msg.targetWeaponId).toBe("shotgun");
  });

  it("supports every valid weapon id", () => {
    const a: WeaponSwitch = { targetWeaponId: "shotgun" };
    const b: WeaponSwitch = { targetWeaponId: "assault_rifle" };
    expect(a.targetWeaponId).toBe("shotgun");
    expect(b.targetWeaponId).toBe("assault_rifle");
  });
});

describe("StartReload (client → server)", () => {
  it("may be empty (reloads the current weapon)", () => {
    const msg: StartReload = {};
    expect(msg.weaponId).toBeUndefined();
  });

  it("may carry an explicit weapon id", () => {
    const msg: StartReload = { weaponId: "shotgun" };
    expect(msg.weaponId).toBe("shotgun");
  });
});

describe("PlayerStateSchema weapon state", () => {
  it("supports reading and writing currentWeapon", () => {
    const p = new (PlayerStateSchema as any)() as PlayerStateSchemaInstance;
    p.currentWeapon = "shotgun";
    expect(p.currentWeapon).toBe("shotgun");
    p.currentWeapon = "assault_rifle";
    expect(p.currentWeapon).toBe("assault_rifle");
  });

  it("leaves currentWeapon unset until the server assigns it on join", () => {
    const p = new (PlayerStateSchema as any)() as PlayerStateSchemaInstance;
    // A fresh schema does not carry a weapon yet; the authoritative server
    // assigns currentWeapon when a player joins (Colyseus t.string() is not
    // pre-seeded with a default).
    expect(p.currentWeapon).toBeUndefined();
  });

  it("has an empty weapons map on construction", () => {
    const p = new (PlayerStateSchema as any)() as PlayerStateSchemaInstance;
    expect(p.weapons).toBeDefined();
    expect(p.weapons.size).toBe(0);
  });

  it("supports adding, reading, and removing per-weapon ammo entries", () => {
    const p = new (PlayerStateSchema as any)() as PlayerStateSchemaInstance;

    const shotgun = new (WeaponAmmoStateSchema as any)();
    shotgun.magazineAmmo = 8;
    shotgun.reserveAmmo = 24;
    shotgun.isReloading = false;
    shotgun.reloadProgress = 0;
    p.weapons.set("shotgun", shotgun);

    expect(p.weapons.size).toBe(1);
    expect(p.weapons.get("shotgun")).toBe(shotgun);
    expect(shotgun.magazineAmmo).toBe(8);
    expect(shotgun.reserveAmmo).toBe(24);

    // A second weapon entry can be added alongside the first.
    const rifle = new (WeaponAmmoStateSchema as any)();
    rifle.magazineAmmo = 30;
    rifle.reserveAmmo = 60;
    rifle.isReloading = true;
    rifle.reloadProgress = 0.5;
    p.weapons.set("assault_rifle", rifle);
    expect(p.weapons.size).toBe(2);
    expect(p.weapons.get("assault_rifle")).toBe(rifle);

    // Removing a weapon leaves the others intact.
    p.weapons.delete("shotgun");
    expect(p.weapons.size).toBe(1);
    expect(p.weapons.has("shotgun")).toBe(false);
    expect(p.weapons.has("assault_rifle")).toBe(true);
  });
});

describe("WeaponAmmoStateSchema (per-weapon wire schema)", () => {
  it("supports reading and writing all fields", () => {
    const w = new (WeaponAmmoStateSchema as any)() as InstanceType<
      typeof WeaponAmmoStateSchema
    >;
    w.magazineAmmo = 5;
    w.reserveAmmo = 15;
    w.isReloading = true;
    w.reloadProgress = 0.75;

    expect(w.magazineAmmo).toBe(5);
    expect(w.reserveAmmo).toBe(15);
    expect(w.isReloading).toBe(true);
    expect(w.reloadProgress).toBe(0.75);
  });

  it("reflects the plain WeaponAmmoState contract shape", () => {
    // A plain-data instance of the same logical shape.
    const plain: WeaponAmmoState = {
      magazineAmmo: 0,
      reserveAmmo: 24,
      isReloading: false,
      reloadProgress: 0,
    };
    expect(plain.magazineAmmo).toBe(0);
    expect(plain.reserveAmmo).toBe(24);
    expect(plain.isReloading).toBe(false);
    expect(plain.reloadProgress).toBe(0);
  });
});

describe("OPENING_PATTERNS (build-edit vocabulary)", () => {
  it("exposes exactly the four documented patterns", () => {
    expect([...OPENING_PATTERNS].sort()).toEqual(
      ["door_top", "half_bottom", "none", "window_center"].sort(),
    );
  });

  it("has unique pattern values", () => {
    expect(new Set(OPENING_PATTERNS).size).toBe(OPENING_PATTERNS.length);
  });

  it("guards each valid pattern and rejects unknown / non-strings", () => {
    expect(isStructureOpeningPattern("door_top")).toBe(true);
    expect(isStructureOpeningPattern("window_center")).toBe(true);
    expect(isStructureOpeningPattern("half_bottom")).toBe(true);
    expect(isStructureOpeningPattern("none")).toBe(true);
    expect(isStructureOpeningPattern("roof")).toBe(false);
    expect(isStructureOpeningPattern("")).toBe(false);
    expect(isStructureOpeningPattern(42)).toBe(false);
    expect(isStructureOpeningPattern(null)).toBe(false);
  });
});

describe("StructureState openings (build-edit geometry)", () => {
  it("may carry an array of active opening descriptors", () => {
    const openings: StructureOpening[] = [
      { pattern: "door_top" },
      { pattern: "window_center" },
    ];
    const structure: StructureState = {
      structureId: "s-1",
      buildType: "wall",
      grid: { x: 0, y: 0, z: 0 },
      rotation: 0,
      ownerId: "session-a",
      createdSequence: 3,
      openings,
    };
    expect(structure.openings).toHaveLength(2);
    expect(structure.openings?.[0].pattern).toBe("door_top");
    expect(structure.openings?.[1].pattern).toBe("window_center");
  });

  it("is valid with no openings (field is optional)", () => {
    const structure: StructureState = {
      structureId: "s-2",
      buildType: "floor",
      grid: { x: 1, y: 0, z: 2 },
      rotation: 0,
      ownerId: "session-b",
      createdSequence: 4,
    };
    expect(structure.openings).toBeUndefined();
  });
});

describe("BuildEdit (client → server)", () => {
  it("carries a structure id and an opening edit pattern", () => {
    const msg: BuildEdit = { structureId: "s-1", editPattern: "door_top" };
    expect(msg.structureId).toBe("s-1");
    expect(msg.editPattern).toBe("door_top");
  });

  it("supports the 'none' pattern (clear openings)", () => {
    const msg: BuildEdit = { structureId: "s-1", editPattern: "none" };
    expect(msg.editPattern).toBe("none");
  });
});

describe("BuildEditResult (server → client)", () => {
  it("carries structureId, success, and an updated structure on success", () => {
    const updated: StructureState = {
      structureId: "s-1",
      buildType: "wall",
      grid: { x: 0, y: 0, z: 0 },
      rotation: 0,
      ownerId: "session-a",
      createdSequence: 3,
      openings: [{ pattern: "door_top" }],
    };
    const result: BuildEditResult = {
      structureId: "s-1",
      success: true,
      updatedStructure: updated,
    };
    expect(result.structureId).toBe("s-1");
    expect(result.success).toBe(true);
    expect(result.updatedStructure?.openings?.[0].pattern).toBe("door_top");
  });

  it("omits updatedStructure on rejection", () => {
    const result: BuildEditResult = {
      structureId: "s-1",
      success: false,
    };
    expect(result.success).toBe(false);
    expect(result.updatedStructure).toBeUndefined();
  });
});

describe("BUILD_EDIT_EVENTS (build-edit identifiers)", () => {
  it("declares distinct request and result identifiers", () => {
    expect(typeof BUILD_EDIT_EVENTS.EDIT_REQUEST).toBe("string");
    expect(typeof BUILD_EDIT_EVENTS.EDIT_RESULT).toBe("string");
    expect(BUILD_EDIT_EVENTS.EDIT_REQUEST).toBe("build:edit_request");
    expect(BUILD_EDIT_EVENTS.EDIT_RESULT).toBe("build:edit_result");
    expect(BUILD_EDIT_EVENTS.EDIT_REQUEST).not.toBe(BUILD_EDIT_EVENTS.EDIT_RESULT);
  });
});
