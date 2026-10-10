/**
 * Focused serialization and validation tests for the canonical edit-grid
 * model.
 *
 * Validates:
 *  - Tile dimensions per build type (wall 3×3, floor/cone 2×2, ramp directional)
 *  - `createDefaultEditState` produces correct defaults for all build types
 *  - `validateEditActionRequest` accepts well-formed requests and rejects malformed ones
 *  - `validateEditState` validates correct shapes per build type
 *  - `applyEditAction` produces correct state transitions for all actions
 *  - `serializeEditState` / `deserializeEditState` round-trip correctly
 *  - `isRampVariant` / `isEditActionType` type guards
 */
import { describe, expect, it } from "vitest";

import {
  WALL_EDIT_COLS,
  WALL_EDIT_ROWS,
  WALL_EDIT_TILE_COUNT,
  FLOOR_CONE_EDIT_COLS,
  FLOOR_CONE_EDIT_ROWS,
  FLOOR_CONE_EDIT_TILE_COUNT,
  getEditTileCount,
  RAMP_VARIANTS,
  isRampVariant,
  type StructureEditState,
  createDefaultEditState,
  EDIT_ACTION_TYPES,
  isEditActionType,
  validateEditActionRequest,
  validateEditState,
  applyEditAction,
  serializeEditState,
  deserializeEditState,
} from "./editGrid.js";

// ─── Tile dimensions ─────────────────────────────────────────────────────────

describe("tile dimensions", () => {
  it("wall edit grid is 3×3 (9 tiles)", () => {
    expect(WALL_EDIT_COLS).toBe(3);
    expect(WALL_EDIT_ROWS).toBe(3);
    expect(WALL_EDIT_TILE_COUNT).toBe(9);
  });

  it("floor/cone edit grid is 2×2 (4 tiles)", () => {
    expect(FLOOR_CONE_EDIT_COLS).toBe(2);
    expect(FLOOR_CONE_EDIT_ROWS).toBe(2);
    expect(FLOOR_CONE_EDIT_TILE_COUNT).toBe(4);
  });

  it("getEditTileCount returns correct values per build type", () => {
    expect(getEditTileCount("wall")).toBe(9);
    expect(getEditTileCount("floor")).toBe(4);
    expect(getEditTileCount("cone")).toBe(4);
    expect(getEditTileCount("ramp")).toBeNull();
    expect(getEditTileCount("unknown")).toBeNull();
  });
});

// ─── Ramp variants ──────────────────────────────────────────────────────────

describe("RAMP_VARIANTS", () => {
  it("contains exactly the four valid variants", () => {
    expect(RAMP_VARIANTS).toEqual(["full", "flipped", "half_left", "half_right"]);
  });

  it("isRampVariant accepts valid variants", () => {
    for (const v of RAMP_VARIANTS) {
      expect(isRampVariant(v)).toBe(true);
    }
  });

  it("isRampVariant rejects invalid values", () => {
    expect(isRampVariant("bogus")).toBe(false);
    expect(isRampVariant(42)).toBe(false);
    expect(isRampVariant(null)).toBe(false);
    expect(isRampVariant(undefined)).toBe(false);
    expect(isRampVariant("")).toBe(false);
  });
});

// ─── createDefaultEditState ─────────────────────────────────────────────────

describe("createDefaultEditState", () => {
  it("creates a wall edit state with all 9 tiles solid", () => {
    const state = createDefaultEditState("wall");
    expect(state.kind).toBe("wall");
    if (state.kind === "wall") {
      expect(state.tiles).toHaveLength(9);
      expect(state.tiles.every((t) => t === true)).toBe(true);
    }
  });

  it("creates a floor edit state with all 4 tiles solid", () => {
    const state = createDefaultEditState("floor");
    expect(state.kind).toBe("floor_cone");
    if (state.kind === "floor_cone") {
      expect(state.tiles).toHaveLength(4);
      expect(state.tiles.every((t) => t === true)).toBe(true);
    }
  });

  it("creates a cone edit state with all 4 tiles solid", () => {
    const state = createDefaultEditState("cone");
    expect(state.kind).toBe("floor_cone");
    if (state.kind === "floor_cone") {
      expect(state.tiles).toHaveLength(4);
      expect(state.tiles.every((t) => t === true)).toBe(true);
    }
  });

  it("creates a ramp edit state with 'full' variant", () => {
    const state = createDefaultEditState("ramp");
    expect(state.kind).toBe("ramp");
    if (state.kind === "ramp") {
      expect(state.variant).toBe("full");
    }
  });
});

// ─── Edit action types ──────────────────────────────────────────────────────

describe("EDIT_ACTION_TYPES", () => {
  it("contains all seven actions", () => {
    expect(EDIT_ACTION_TYPES).toEqual([
      "begin", "select", "deselect", "confirm", "reset", "cancel", "full_reset",
    ]);
  });

  it("isEditActionType accepts valid actions", () => {
    for (const a of EDIT_ACTION_TYPES) {
      expect(isEditActionType(a)).toBe(true);
    }
  });

  it("isEditActionType rejects invalid values", () => {
    expect(isEditActionType("bogus")).toBe(false);
    expect(isEditActionType("")).toBe(false);
    expect(isEditActionType(42)).toBe(false);
    expect(isEditActionType(null)).toBe(false);
  });
});

// ─── validateEditActionRequest ──────────────────────────────────────────────

describe("validateEditActionRequest", () => {
  it("accepts a valid begin request", () => {
    const result = validateEditActionRequest({ structureId: "wall-1", action: "begin" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.structureId).toBe("wall-1");
      expect(result.value.action).toBe("begin");
    }
  });

  it("accepts a valid select request with tileIndex", () => {
    const result = validateEditActionRequest({ structureId: "wall-1", action: "select", tileIndex: 4 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tileIndex).toBe(4);
    }
  });

  it("accepts a valid select request with rampVariant", () => {
    const result = validateEditActionRequest({ structureId: "ramp-1", action: "select", rampVariant: "flipped" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rampVariant).toBe("flipped");
    }
  });

  it("rejects non-object input", () => {
    const result = validateEditActionRequest(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("rejects array input", () => {
    const result = validateEditActionRequest([1, 2, 3]);
    expect(result.ok).toBe(false);
  });

  it("rejects missing structureId", () => {
    const result = validateEditActionRequest({ action: "begin" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("structureId"))).toBe(true);
    }
  });

  it("rejects empty structureId", () => {
    const result = validateEditActionRequest({ structureId: "", action: "begin" });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid action", () => {
    const result = validateEditActionRequest({ structureId: "wall-1", action: "bogus" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("action"))).toBe(true);
    }
  });

  it("rejects missing action", () => {
    const result = validateEditActionRequest({ structureId: "wall-1" });
    expect(result.ok).toBe(false);
  });

  it("rejects non-integer tileIndex", () => {
    const result = validateEditActionRequest({ structureId: "wall-1", action: "select", tileIndex: 1.5 });
    expect(result.ok).toBe(false);
  });

  it("rejects negative tileIndex", () => {
    const result = validateEditActionRequest({ structureId: "wall-1", action: "select", tileIndex: -1 });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid rampVariant", () => {
    const result = validateEditActionRequest({ structureId: "ramp-1", action: "select", rampVariant: "bogus" });
    expect(result.ok).toBe(false);
  });
});

// ─── validateEditState ──────────────────────────────────────────────────────

describe("validateEditState", () => {
  it("validates a correct wall edit state", () => {
    const state = { kind: "wall", tiles: [true, true, true, true, true, true, true, true, true] };
    const result = validateEditState(state, "wall");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("wall");
    }
  });

  it("validates a correct floor_cone edit state", () => {
    const state = { kind: "floor_cone", tiles: [true, true, false, true] };
    const result = validateEditState(state, "floor");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("floor_cone");
    }
  });

  it("validates a correct ramp edit state", () => {
    const state = { kind: "ramp", variant: "half_left" };
    const result = validateEditState(state, "ramp");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("ramp");
    }
  });

  it("rejects wrong kind for wall", () => {
    const state = { kind: "floor_cone", tiles: [true, true, true, true] };
    const result = validateEditState(state, "wall");
    expect(result.ok).toBe(false);
  });

  it("rejects wrong tile count for wall", () => {
    const state = { kind: "wall", tiles: [true, true, true] };
    const result = validateEditState(state, "wall");
    expect(result.ok).toBe(false);
  });

  it("rejects wrong tile count for floor_cone", () => {
    const state = { kind: "floor_cone", tiles: [true, true, true, true, true] };
    const result = validateEditState(state, "floor");
    expect(result.ok).toBe(false);
  });

  it("rejects non-boolean tile", () => {
    const state = { kind: "wall", tiles: [true, true, "yes", true, true, true, true, true, true] };
    const result = validateEditState(state, "wall");
    expect(result.ok).toBe(false);
  });

  it("rejects invalid ramp variant", () => {
    const state = { kind: "ramp", variant: "bogus" };
    const result = validateEditState(state, "ramp");
    expect(result.ok).toBe(false);
  });

  it("rejects non-object state", () => {
    const result = validateEditState(null, "wall");
    expect(result.ok).toBe(false);
  });

  it("rejects unknown build type", () => {
    const state = { kind: "wall", tiles: new Array(9).fill(true) };
    const result = validateEditState(state, "unknown_type");
    expect(result.ok).toBe(false);
  });
});

// ─── applyEditAction ────────────────────────────────────────────────────────

describe("applyEditAction", () => {
  const defaultWall = createDefaultEditState("wall");
  const defaultFloor = createDefaultEditState("floor");
  const defaultRamp = createDefaultEditState("ramp");

  it("begin resets wall to all-solid", () => {
    const modified = { kind: "wall" as const, tiles: [false, true, true, true, true, true, true, true, true] };
    const result = applyEditAction(modified, { structureId: "w", action: "begin" }, "wall");
    expect(result).toEqual(defaultWall);
  });

  it("select removes a tile in a wall grid", () => {
    const result = applyEditAction(defaultWall, { structureId: "w", action: "select", tileIndex: 4 }, "wall");
    expect(result).not.toBeNull();
    if (result && result.kind === "wall") {
      expect(result.tiles[4]).toBe(false);
      expect(result.tiles[0]).toBe(true);
      expect(result.tiles[8]).toBe(true);
    }
  });

  it("deselect restores a tile in a wall grid", () => {
    const modified = { kind: "wall" as const, tiles: [true, true, true, true, false, true, true, true, true] };
    const result = applyEditAction(modified, { structureId: "w", action: "deselect", tileIndex: 4 }, "wall");
    expect(result).not.toBeNull();
    if (result && result.kind === "wall") {
      expect(result.tiles[4]).toBe(true);
    }
  });

  it("select removes a tile in a floor grid", () => {
    const result = applyEditAction(defaultFloor, { structureId: "f", action: "select", tileIndex: 1 }, "floor");
    expect(result).not.toBeNull();
    if (result && result.kind === "floor_cone") {
      expect(result.tiles[1]).toBe(false);
      expect(result.tiles[0]).toBe(true);
    }
  });

  it("select sets ramp variant", () => {
    const result = applyEditAction(defaultRamp, { structureId: "r", action: "select", rampVariant: "flipped" }, "ramp");
    expect(result).not.toBeNull();
    if (result && result.kind === "ramp") {
      expect(result.variant).toBe("flipped");
    }
  });

  it("deselect resets ramp to full", () => {
    const flipped = { kind: "ramp" as const, variant: "flipped" as const };
    const result = applyEditAction(flipped, { structureId: "r", action: "deselect" }, "ramp");
    expect(result).not.toBeNull();
    if (result && result.kind === "ramp") {
      expect(result.variant).toBe("full");
    }
  });

  it("confirm returns the current state unchanged", () => {
    const modified = { kind: "wall" as const, tiles: [true, false, true, true, true, true, true, true, true] };
    const result = applyEditAction(modified, { structureId: "w", action: "confirm" }, "wall");
    expect(result).toEqual(modified);
  });

  it("reset returns default state for wall", () => {
    const modified = { kind: "wall" as const, tiles: new Array(9).fill(false) };
    const result = applyEditAction(modified, { structureId: "w", action: "reset" }, "wall");
    expect(result).toEqual(defaultWall);
  });

  it("cancel returns default state for floor", () => {
    const modified = { kind: "floor_cone" as const, tiles: [false, false, false, false] };
    const result = applyEditAction(modified, { structureId: "f", action: "cancel" }, "floor");
    expect(result).toEqual(defaultFloor);
  });

  it("full_reset returns default state for ramp", () => {
    const modified = { kind: "ramp" as const, variant: "half_left" as const };
    const result = applyEditAction(modified, { structureId: "r", action: "full_reset" }, "ramp");
    expect(result).toEqual(defaultRamp);
  });

  it("returns null for out-of-range tileIndex on wall", () => {
    const result = applyEditAction(defaultWall, { structureId: "w", action: "select", tileIndex: 9 }, "wall");
    expect(result).toBeNull();
  });

  it("returns null for out-of-range tileIndex on floor", () => {
    const result = applyEditAction(defaultFloor, { structureId: "f", action: "select", tileIndex: 4 }, "floor");
    expect(result).toBeNull();
  });

  it("returns null for select on ramp without rampVariant", () => {
    const result = applyEditAction(defaultRamp, { structureId: "r", action: "select" }, "ramp");
    expect(result).toBeNull();
  });

  it("returns null for select on wall without tileIndex", () => {
    const result = applyEditAction(defaultWall, { structureId: "w", action: "select" }, "wall");
    expect(result).toBeNull();
  });
});

// ─── Serialization round-trip ──────────────────────────────────────────────

describe("serializeEditState / deserializeEditState round-trip", () => {
  it("round-trips a wall edit state", () => {
    const state: StructureEditState = { kind: "wall", tiles: [true, false, true, true, true, false, true, true, true] };
    const serialized = serializeEditState(state);
    const json = JSON.stringify(serialized);
    const parsed = JSON.parse(json);
    const result = deserializeEditState(parsed, "wall");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(state);
    }
  });

  it("round-trips a floor_cone edit state", () => {
    const state: StructureEditState = { kind: "floor_cone", tiles: [true, true, false, true] };
    const serialized = serializeEditState(state);
    const json = JSON.stringify(serialized);
    const parsed = JSON.parse(json);
    const result = deserializeEditState(parsed, "floor");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(state);
    }
  });

  it("round-trips a ramp edit state", () => {
    const state: StructureEditState = { kind: "ramp", variant: "half_right" };
    const serialized = serializeEditState(state);
    const json = JSON.stringify(serialized);
    const parsed = JSON.parse(json);
    const result = deserializeEditState(parsed, "ramp");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(state);
    }
  });

  it("serialized wall state is JSON-safe (no undefined, no symbols)", () => {
    const state: StructureEditState = { kind: "wall", tiles: new Array(9).fill(true) };
    const serialized = serializeEditState(state);
    // JSON.stringify should not throw and should produce valid JSON.
    const json = JSON.stringify(serialized);
    expect(json).toBeDefined();
    const parsed = JSON.parse(json);
    expect(parsed.kind).toBe("wall");
    expect(parsed.tiles).toHaveLength(9);
  });

  it("serialized ramp state is JSON-safe", () => {
    const state: StructureEditState = { kind: "ramp", variant: "full" };
    const serialized = serializeEditState(state);
    const json = JSON.stringify(serialized);
    const parsed = JSON.parse(json);
    expect(parsed.kind).toBe("ramp");
    expect(parsed.variant).toBe("full");
  });

  it("deserialize rejects mismatched build type", () => {
    const state = { kind: "wall", tiles: new Array(9).fill(true) };
    const result = deserializeEditState(state, "floor");
    expect(result.ok).toBe(false);
  });
});
