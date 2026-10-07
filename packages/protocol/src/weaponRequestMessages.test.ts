/**
 * Smoke / drift tests for the 1v1 Energy Box Fight T1 protocol messages:
 *
 *  - {@link WeaponSwitchRequest} / {@link ReloadRequest} client→server
 *    intents carry a `playerId` and a valid `weaponId`;
 *  - {@link WeaponState} server→client payload carries ammo + reload state;
 *  - {@link BuildEditRequest} (the first server-authoritative build-editing
 *    slice) carries a `playerId`, `structureId`, a valid `cellIndex` (0–8)
 *    and `action` = `"remove"`;
 *  - the {@link isBuildCellIndex} guard accepts 0–8 and rejects out-of-bounds
 *    / non-integer values.
 */
import { describe, expect, it } from "vitest";
import {
  BUILD_CELL_INDEX_LIMITS,
  isBuildCellIndex,
  type BuildCellIndex,
  type BuildEditRequest,
  type ReloadRequest,
  type WeaponState,
  type WeaponSwitchRequest,
} from "./index.js";

describe("WeaponSwitchRequest", () => {
  it("carries a playerId and a valid weaponId", () => {
    const msg: WeaponSwitchRequest = {
      playerId: "player-1",
      weaponId: "shotgun",
    };
    expect(msg.playerId).toBe("player-1");
    expect(msg.weaponId).toBe("shotgun");
  });

  it("accepts both supported weapon ids", () => {
    const rifle: WeaponSwitchRequest = {
      playerId: "player-1",
      weaponId: "assault_rifle",
    };
    expect(rifle.weaponId).toBe("assault_rifle");
  });
});

describe("ReloadRequest", () => {
  it("carries a playerId and the weaponId to reload", () => {
    const msg: ReloadRequest = {
      playerId: "player-2",
      weaponId: "assault_rifle",
    };
    expect(msg.playerId).toBe("player-2");
    expect(msg.weaponId).toBe("assault_rifle");
  });
});

describe("WeaponState", () => {
  it("carries the authoritative ammo + reload state", () => {
    const state: WeaponState = {
      weaponId: "shotgun",
      ammoInMag: 2,
      ammoReserve: 8,
      reloading: true,
      reloadRemainingMs: 1500,
    };
    expect(state.weaponId).toBe("shotgun");
    expect(state.ammoInMag).toBe(2);
    expect(state.ammoReserve).toBe(8);
    expect(state.reloading).toBe(true);
    expect(state.reloadRemainingMs).toBe(1500);
  });

  it("reports a non-reloading weapon with no remaining reload time", () => {
    const state: WeaponState = {
      weaponId: "assault_rifle",
      ammoInMag: 30,
      ammoReserve: 60,
      reloading: false,
      reloadRemainingMs: 0,
    };
    expect(state.reloading).toBe(false);
    expect(state.reloadRemainingMs).toBe(0);
  });
});

describe("isBuildCellIndex", () => {
  it("accepts every valid cell index 0–8", () => {
    for (let i = 0; i <= 8; i += 1) {
      expect(isBuildCellIndex(i)).toBe(true);
    }
  });

  it("rejects out-of-bounds, negative, fractional, and non-number values", () => {
    expect(isBuildCellIndex(-1)).toBe(false);
    expect(isBuildCellIndex(9)).toBe(false);
    expect(isBuildCellIndex(3.5)).toBe(false);
    expect(isBuildCellIndex("3")).toBe(false);
    expect(isBuildCellIndex(null)).toBe(false);
    expect(isBuildCellIndex(undefined)).toBe(false);
  });
});

describe("BuildEditRequest", () => {
  it("carries playerId, structureId, a valid cellIndex, and action 'remove'", () => {
    const msg: BuildEditRequest = {
      playerId: "player-1",
      structureId: "structure-42",
      cellIndex: 5,
      action: "remove",
    };
    expect(msg.playerId).toBe("player-1");
    expect(msg.structureId).toBe("structure-42");
    expect(msg.cellIndex).toBe(5);
    expect(msg.action).toBe("remove");
    expect(isBuildCellIndex(msg.cellIndex)).toBe(true);
  });

  it("cellIndex is typed as the 0–8 literal union", () => {
    const cell: BuildCellIndex = 0;
    const last: BuildCellIndex = 8;
    expect(cell).toBe(0);
    expect(last).toBe(8);
  });

  it("exposes inclusive cell-index limits", () => {
    expect(BUILD_CELL_INDEX_LIMITS.min).toBe(0);
    expect(BUILD_CELL_INDEX_LIMITS.max).toBe(8);
  });
});
