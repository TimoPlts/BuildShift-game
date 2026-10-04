/**
 * Protocol contract tests for the 1v1 Energy Box Fight weapon and
 * build-edit messages.
 *
 * Validates:
 *  - {@link SwitchWeaponRequest} with each valid {@link WeaponType} produces
 *    a well-formed object matching the exported interface;
 *  - {@link WeaponState} fields have correct types and bounds
 *    (`reloadProgress` in [0, 1]);
 *  - {@link FireRequest} includes `weaponType` and a 3D `aimDirection` vector;
 *  - {@link BuildEditCommand} with each valid {@link BuildEditType} and a
 *    `structureId` produces a well-formed object;
 *  - {@link BuildEditResult} has `success` boolean and optional `reason` string;
 *  - game-config: shotgun has `pelletCount=8` and `spreadDeg=12`;
 *    assault_rifle has `magazineSize=30`.
 *
 * These are pure type-shape and config-value tests with no server or client
 * code needed.
 */
import { describe, expect, it } from "vitest";

import {
  WEAPON_TYPES,
  isWeaponType,
  type WeaponType,
  type SwitchWeaponRequest,
  type Vec3,
  type FireRequest,
  BUILD_EDIT_TYPES,
  isBuildEditType,
  type BuildEditType,
  type BuildEditCommand,
} from "../index.js";

// Import the energyBoxFight WeaponState (with reloadProgress) and BuildEditResult
// (with optional reason) directly from the module, since the index re-exports
// a different BuildEditResult from buildEditMessages.ts.
import {
  type WeaponState,
  type BuildEditResult,
} from "../messages/energyBoxFightMessages.js";

// Import game-config weapon balance values.
import { weapons } from "@buildshift/game-config";

// ─────────────────────────────────────────────────────────────────────────────
// SwitchWeaponRequest
// ─────────────────────────────────────────────────────────────────────────────

describe("SwitchWeaponRequest", () => {
  it("produces a well-formed object for each valid WeaponType", () => {
    for (const weaponType of WEAPON_TYPES) {
      const request: SwitchWeaponRequest = { targetWeapon: weaponType };
      expect(request).toBeDefined();
      expect(request.targetWeapon).toBe(weaponType);
      expect(isWeaponType(request.targetWeapon)).toBe(true);
    }
  });

  it("accepts 'assault_rifle' as targetWeapon", () => {
    const request: SwitchWeaponRequest = { targetWeapon: "assault_rifle" };
    expect(request.targetWeapon).toBe("assault_rifle");
  });

  it("accepts 'shotgun' as targetWeapon", () => {
    const request: SwitchWeaponRequest = { targetWeapon: "shotgun" };
    expect(request.targetWeapon).toBe("shotgun");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WeaponState (energyBoxFightMessages)
// ─────────────────────────────────────────────────────────────────────────────

describe("WeaponState", () => {
  it("has the correct field types for a non-reloading weapon", () => {
    const state: WeaponState = {
      weaponType: "assault_rifle",
      currentAmmo: 25,
      maxAmmo: 30,
      isReloading: false,
      reloadProgress: 0,
    };
    expect(state.weaponType).toBe("assault_rifle");
    expect(typeof state.currentAmmo).toBe("number");
    expect(state.currentAmmo).toBe(25);
    expect(typeof state.maxAmmo).toBe("number");
    expect(state.maxAmmo).toBe(30);
    expect(typeof state.isReloading).toBe("boolean");
    expect(state.isReloading).toBe(false);
    expect(typeof state.reloadProgress).toBe("number");
    expect(state.reloadProgress).toBe(0);
  });

  it("has the correct field types for a reloading weapon", () => {
    const state: WeaponState = {
      weaponType: "shotgun",
      currentAmmo: 0,
      maxAmmo: 6,
      isReloading: true,
      reloadProgress: 0.5,
    };
    expect(state.weaponType).toBe("shotgun");
    expect(state.currentAmmo).toBe(0);
    expect(state.maxAmmo).toBe(6);
    expect(state.isReloading).toBe(true);
    expect(state.reloadProgress).toBe(0.5);
  });

  it("reloadProgress is valid at the lower bound (0)", () => {
    const state: WeaponState = {
      weaponType: "shotgun",
      currentAmmo: 0,
      maxAmmo: 6,
      isReloading: true,
      reloadProgress: 0,
    };
    expect(state.reloadProgress).toBeGreaterThanOrEqual(0);
    expect(state.reloadProgress).toBeLessThanOrEqual(1);
  });

  it("reloadProgress is valid at the upper bound (1)", () => {
    const state: WeaponState = {
      weaponType: "assault_rifle",
      currentAmmo: 30,
      maxAmmo: 30,
      isReloading: false,
      reloadProgress: 1,
    };
    expect(state.reloadProgress).toBeGreaterThanOrEqual(0);
    expect(state.reloadProgress).toBeLessThanOrEqual(1);
  });

  it("reloadProgress is valid at an intermediate value (0.75)", () => {
    const state: WeaponState = {
      weaponType: "assault_rifle",
      currentAmmo: 12,
      maxAmmo: 30,
      isReloading: true,
      reloadProgress: 0.75,
    };
    expect(state.reloadProgress).toBeGreaterThanOrEqual(0);
    expect(state.reloadProgress).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FireRequest
// ─────────────────────────────────────────────────────────────────────────────

describe("FireRequest", () => {
  it("includes weaponType and a 3D aimDirection vector", () => {
    const aimDirection: Vec3 = { x: 1, y: 0, z: 0 };
    const request: FireRequest = {
      weaponType: "assault_rifle",
      aimDirection,
    };
    expect(request.weaponType).toBe("assault_rifle");
    expect(request.aimDirection).toBeDefined();
    expect(typeof request.aimDirection.x).toBe("number");
    expect(typeof request.aimDirection.y).toBe("number");
    expect(typeof request.aimDirection.z).toBe("number");
    expect(request.aimDirection.x).toBe(1);
    expect(request.aimDirection.y).toBe(0);
    expect(request.aimDirection.z).toBe(0);
  });

  it("accepts 'shotgun' as weaponType with a diagonal aim direction", () => {
    const request: FireRequest = {
      weaponType: "shotgun",
      aimDirection: { x: 0.577, y: 0.577, z: 0.577 },
    };
    expect(request.weaponType).toBe("shotgun");
    expect(request.aimDirection.x).toBeCloseTo(0.577);
    expect(request.aimDirection.y).toBeCloseTo(0.577);
    expect(request.aimDirection.z).toBeCloseTo(0.577);
  });

  it("aimDirection supports negative values", () => {
    const request: FireRequest = {
      weaponType: "assault_rifle",
      aimDirection: { x: -1, y: 0.5, z: -0.3 },
    };
    expect(request.aimDirection.x).toBe(-1);
    expect(request.aimDirection.y).toBe(0.5);
    expect(request.aimDirection.z).toBe(-0.3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BuildEditCommand
// ─────────────────────────────────────────────────────────────────────────────

describe("BuildEditCommand", () => {
  it("produces a well-formed object for each valid BuildEditType", () => {
    for (const editType of BUILD_EDIT_TYPES) {
      const command: BuildEditCommand = {
        structureId: "structure-42",
        editType,
      };
      expect(command).toBeDefined();
      expect(command.structureId).toBe("structure-42");
      expect(command.editType).toBe(editType);
      expect(isBuildEditType(command.editType)).toBe(true);
    }
  });

  it("accepts 'door' as editType", () => {
    const command: BuildEditCommand = {
      structureId: "wall-001",
      editType: "door",
    };
    expect(command.editType).toBe("door");
    expect(command.structureId).toBe("wall-001");
  });

  it("accepts 'window' as editType", () => {
    const command: BuildEditCommand = {
      structureId: "wall-002",
      editType: "window",
    };
    expect(command.editType).toBe("window");
  });

  it("accepts 'half_top' as editType", () => {
    const command: BuildEditCommand = {
      structureId: "roof-003",
      editType: "half_top",
    };
    expect(command.editType).toBe("half_top");
  });

  it("accepts 'half_bottom' as editType", () => {
    const command: BuildEditCommand = {
      structureId: "floor-004",
      editType: "half_bottom",
    };
    expect(command.editType).toBe("half_bottom");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BuildEditResult (energyBoxFightMessages)
// ─────────────────────────────────────────────────────────────────────────────

describe("BuildEditResult", () => {
  it("has success boolean set to true with structureId", () => {
    const result: BuildEditResult = {
      success: true,
      structureId: "structure-42",
    };
    expect(typeof result.success).toBe("boolean");
    expect(result.success).toBe(true);
    expect(result.structureId).toBe("structure-42");
  });

  it("has success boolean set to false with an optional reason string", () => {
    const result: BuildEditResult = {
      success: false,
      reason: "structure not found",
      structureId: "structure-99",
    };
    expect(result.success).toBe(false);
    expect(typeof result.reason).toBe("string");
    expect(result.reason).toBe("structure not found");
  });

  it("reason is optional (omitted when success is true)", () => {
    const result: BuildEditResult = {
      success: true,
      structureId: "structure-1",
    };
    expect(result.success).toBe(true);
    expect("reason" in result).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Game-config weapon values
// ─────────────────────────────────────────────────────────────────────────────

describe("game-config: shotgun weapon", () => {
  it("has pelletCount = 8", () => {
    const shotgun = weapons.shotgun;
    // Narrow to shotgun config which has pelletCount
    expect("pelletCount" in shotgun).toBe(true);
    if ("pelletCount" in shotgun) {
      expect(shotgun.pelletCount).toBe(8);
    }
  });

  it("has spreadDeg = 12", () => {
    const shotgun = weapons.shotgun;
    expect("spreadDeg" in shotgun).toBe(true);
    if ("spreadDeg" in shotgun) {
      expect(shotgun.spreadDeg).toBe(12);
    }
  });
});

describe("game-config: assault_rifle weapon", () => {
  it("has magazineSize = 30", () => {
    const rifle = weapons.assault_rifle;
    expect(rifle.magazineSize).toBe(30);
  });
});
