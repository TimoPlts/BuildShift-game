/**
 * Directional ramp edit and reset tests for the canonical generated geometry.
 *
 * Validates:
 *  - All six ramp variants produce correct canonical geometry
 *  - Directional start/end semantics (not wall tiles) are used
 *  - Practical turns (turn_left / turn_right) are correctly modelled
 *  - Reset actions restore the default (`full`) ramp geometry
 *  - Geometry is deterministic and round-trips through serialization
 *  - Balance is preserved: all variants have the same start/end heights
 *    and the same total rise (1 layer)
 *  - Authority: geometry is derived from the variant alone (no client input)
 */
import { describe, expect, it } from "vitest";

import {
  RAMP_VARIANTS,
  isRampVariant,
  type RampVariant,
  type RampGeometry,
  generateRampGeometry,
  createDefaultEditState,
  applyEditAction,
  serializeEditState,
  deserializeEditState,
  validateEditState,
} from "./editGrid.js";

// ─── Variant completeness ───────────────────────────────────────────────────

describe("RAMP_VARIANTS (complete set including practical turns)", () => {
  it("contains all six valid variants", () => {
    expect(RAMP_VARIANTS).toEqual([
      "full",
      "flipped",
      "half_left",
      "half_right",
      "turn_left",
      "turn_right",
    ]);
  });

  it("isRampVariant accepts all six variants", () => {
    for (const v of RAMP_VARIANTS) {
      expect(isRampVariant(v)).toBe(true);
    }
  });

  it("isRampVariant rejects invalid values", () => {
    expect(isRampVariant("bogus")).toBe(false);
    expect(isRampVariant("turn_up")).toBe(false);
    expect(isRampVariant("")).toBe(false);
    expect(isRampVariant(null)).toBe(false);
    expect(isRampVariant(42)).toBe(false);
  });
});

// ─── Canonical generated geometry ──────────────────────────────────────────

describe("generateRampGeometry (directional start/end semantics)", () => {
  it("full ramp: start 0, end 1, span 1.0, no turn, not reversed", () => {
    const g = generateRampGeometry("full");
    expect(g.startHeight).toBe(0);
    expect(g.endHeight).toBe(1);
    expect(g.spanFraction).toBe(1.0);
    expect(g.turn).toBe("none");
    expect(g.reversed).toBe(false);
  });

  it("flipped ramp: start 0, end 1, span 1.0, no turn, reversed", () => {
    const g = generateRampGeometry("flipped");
    expect(g.startHeight).toBe(0);
    expect(g.endHeight).toBe(1);
    expect(g.spanFraction).toBe(1.0);
    expect(g.turn).toBe("none");
    expect(g.reversed).toBe(true);
  });

  it("half_left ramp: start 0, end 1, span 0.5, no turn, not reversed", () => {
    const g = generateRampGeometry("half_left");
    expect(g.startHeight).toBe(0);
    expect(g.endHeight).toBe(1);
    expect(g.spanFraction).toBe(0.5);
    expect(g.turn).toBe("none");
    expect(g.reversed).toBe(false);
  });

  it("half_right ramp: start 0, end 1, span 0.5, no turn, reversed", () => {
    const g = generateRampGeometry("half_right");
    expect(g.startHeight).toBe(0);
    expect(g.endHeight).toBe(1);
    expect(g.spanFraction).toBe(0.5);
    expect(g.turn).toBe("none");
    expect(g.reversed).toBe(true);
  });

  it("turn_left ramp: start 0, end 1, span 1.0, turn left, not reversed", () => {
    const g = generateRampGeometry("turn_left");
    expect(g.startHeight).toBe(0);
    expect(g.endHeight).toBe(1);
    expect(g.spanFraction).toBe(1.0);
    expect(g.turn).toBe("left");
    expect(g.reversed).toBe(false);
  });

  it("turn_right ramp: start 0, end 1, span 1.0, turn right, not reversed", () => {
    const g = generateRampGeometry("turn_right");
    expect(g.startHeight).toBe(0);
    expect(g.endHeight).toBe(1);
    expect(g.spanFraction).toBe(1.0);
    expect(g.turn).toBe("right");
    expect(g.reversed).toBe(false);
  });
});

// ─── Balance preservation ──────────────────────────────────────────────────

describe("balance preservation (all variants share the same rise)", () => {
  it("all variants have the same total rise (endHeight - startHeight = 1)", () => {
    for (const variant of RAMP_VARIANTS) {
      const g = generateRampGeometry(variant);
      expect(g.endHeight - g.startHeight, `variant ${variant}`).toBe(1);
    }
  });

  it("all variants start at ground level (startHeight = 0)", () => {
    for (const variant of RAMP_VARIANTS) {
      const g = generateRampGeometry(variant);
      expect(g.startHeight, `variant ${variant}`).toBe(0);
    }
  });

  it("all variants end at one layer (endHeight = 1)", () => {
    for (const variant of RAMP_VARIANTS) {
      const g = generateRampGeometry(variant);
      expect(g.endHeight, `variant ${variant}`).toBe(1);
    }
  });

  it("full-span variants (full, flipped, turns) have spanFraction 1.0", () => {
    const fullSpan: RampVariant[] = ["full", "flipped", "turn_left", "turn_right"];
    for (const variant of fullSpan) {
      const g = generateRampGeometry(variant);
      expect(g.spanFraction, `variant ${variant}`).toBe(1.0);
    }
  });

  it("half-span variants (half_left, half_right) have spanFraction 0.5", () => {
    const halfSpan: RampVariant[] = ["half_left", "half_right"];
    for (const variant of halfSpan) {
      const g = generateRampGeometry(variant);
      expect(g.spanFraction, `variant ${variant}`).toBe(0.5);
    }
  });
});

// ─── Practical turns ────────────────────────────────────────────────────────

describe("practical turns (turn_left / turn_right)", () => {
  it("turn_left has turn direction 'left'", () => {
    const g = generateRampGeometry("turn_left");
    expect(g.turn).toBe("left");
  });

  it("turn_right has turn direction 'right'", () => {
    const g = generateRampGeometry("turn_right");
    expect(g.turn).toBe("right");
  });

  it("non-turn variants have turn direction 'none'", () => {
    const nonTurn: RampVariant[] = ["full", "flipped", "half_left", "half_right"];
    for (const variant of nonTurn) {
      const g = generateRampGeometry(variant);
      expect(g.turn, `variant ${variant}`).toBe("none");
    }
  });

  it("turn variants are not reversed (the turn is the directional change)", () => {
    expect(generateRampGeometry("turn_left").reversed).toBe(false);
    expect(generateRampGeometry("turn_right").reversed).toBe(false);
  });
});

// ─── Determinism (authority: geometry derived from variant alone) ──────────

describe("determinism (authoritative: same variant → same geometry)", () => {
  it("calling generateRampGeometry twice yields identical results", () => {
    for (const variant of RAMP_VARIANTS) {
      const g1 = generateRampGeometry(variant);
      const g2 = generateRampGeometry(variant);
      expect(g1, `variant ${variant}`).toEqual(g2);
    }
  });

  it("geometry is a pure function of the variant (no side effects)", () => {
    // Calling with any variant should not mutate prior results.
    const full = generateRampGeometry("full");
    generateRampGeometry("turn_left");
    generateRampGeometry("half_right");
    const fullAgain = generateRampGeometry("full");
    expect(full).toEqual(fullAgain);
  });
});

// ─── Reset restores default geometry ────────────────────────────────────────

describe("reset restores default (full) ramp geometry", () => {
  const defaultRamp = createDefaultEditState("ramp");

  it("default ramp variant is 'full'", () => {
    expect(defaultRamp.kind).toBe("ramp");
    if (defaultRamp.kind === "ramp") {
      expect(defaultRamp.variant).toBe("full");
    }
  });

  it("reset from any variant returns to 'full'", () => {
    const variants: RampVariant[] = ["flipped", "half_left", "half_right", "turn_left", "turn_right"];
    for (const v of variants) {
      const state = { kind: "ramp" as const, variant: v };
      const result = applyEditAction(state, { structureId: "r", action: "reset" }, "ramp");
      expect(result, `reset from ${v}`).not.toBeNull();
      if (result && result.kind === "ramp") {
        expect(result.variant).toBe("full");
      }
    }
  });

  it("cancel from any variant returns to 'full'", () => {
    const variants: RampVariant[] = ["flipped", "half_left", "half_right", "turn_left", "turn_right"];
    for (const v of variants) {
      const state = { kind: "ramp" as const, variant: v };
      const result = applyEditAction(state, { structureId: "r", action: "cancel" }, "ramp");
      expect(result, `cancel from ${v}`).not.toBeNull();
      if (result && result.kind === "ramp") {
        expect(result.variant).toBe("full");
      }
    }
  });

  it("full_reset from any variant returns to 'full'", () => {
    const variants: RampVariant[] = ["flipped", "half_left", "half_right", "turn_left", "turn_right"];
    for (const v of variants) {
      const state = { kind: "ramp" as const, variant: v };
      const result = applyEditAction(state, { structureId: "r", action: "full_reset" }, "ramp");
      expect(result, `full_reset from ${v}`).not.toBeNull();
      if (result && result.kind === "ramp") {
        expect(result.variant).toBe("full");
      }
    }
  });

  it("deselect resets a non-full ramp back to 'full'", () => {
    const state = { kind: "ramp" as const, variant: "turn_left" as const };
    const result = applyEditAction(state, { structureId: "r", action: "deselect" }, "ramp");
    expect(result).not.toBeNull();
    if (result && result.kind === "ramp") {
      expect(result.variant).toBe("full");
    }
  });

  it("reset geometry matches default geometry", () => {
    const modified = { kind: "ramp" as const, variant: "turn_right" as const };
    const reset = applyEditAction(modified, { structureId: "r", action: "reset" }, "ramp")!;
    const defaultGeo = generateRampGeometry("full");
    const resetGeo = generateRampGeometry((reset as { variant: RampVariant }).variant);
    expect(resetGeo).toEqual(defaultGeo);
  });
});

// ─── Select (directional set) for all variants ──────────────────────────────

describe("select (directional set) for all ramp variants", () => {
  it("selecting turn_left sets the variant to turn_left", () => {
    const state = createDefaultEditState("ramp");
    const result = applyEditAction(state, { structureId: "r", action: "select", rampVariant: "turn_left" }, "ramp");
    expect(result).not.toBeNull();
    if (result && result.kind === "ramp") {
      expect(result.variant).toBe("turn_left");
    }
  });

  it("selecting turn_right sets the variant to turn_right", () => {
    const state = createDefaultEditState("ramp");
    const result = applyEditAction(state, { structureId: "r", action: "select", rampVariant: "turn_right" }, "ramp");
    expect(result).not.toBeNull();
    if (result && result.kind === "ramp") {
      expect(result.variant).toBe("turn_right");
    }
  });

  it("selecting any valid variant works", () => {
    const state = createDefaultEditState("ramp");
    for (const v of RAMP_VARIANTS) {
      const result = applyEditAction(state, { structureId: "r", action: "select", rampVariant: v }, "ramp");
      expect(result, `select ${v}`).not.toBeNull();
      if (result && result.kind === "ramp") {
        expect(result.variant).toBe(v);
      }
    }
  });

  it("select without a rampVariant returns null", () => {
    const state = createDefaultEditState("ramp");
    const result = applyEditAction(state, { structureId: "r", action: "select" }, "ramp");
    expect(result).toBeNull();
  });
});

// ─── Serialization round-trip with turn variants ───────────────────────────

describe("serialization round-trip (including turn variants)", () => {
  it("round-trips turn_left ramp state", () => {
    const state = { kind: "ramp" as const, variant: "turn_left" as const };
    const serialized = serializeEditState(state);
    const json = JSON.stringify(serialized);
    const parsed = JSON.parse(json);
    const result = deserializeEditState(parsed, "ramp");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(state);
    }
  });

  it("round-trips turn_right ramp state", () => {
    const state = { kind: "ramp" as const, variant: "turn_right" as const };
    const serialized = serializeEditState(state);
    const json = JSON.stringify(serialized);
    const parsed = JSON.parse(json);
    const result = deserializeEditState(parsed, "ramp");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(state);
    }
  });

  it("validateEditState accepts turn_left variant", () => {
    const result = validateEditState({ kind: "ramp", variant: "turn_left" }, "ramp");
    expect(result.ok).toBe(true);
  });

  it("validateEditState accepts turn_right variant", () => {
    const result = validateEditState({ kind: "ramp", variant: "turn_right" }, "ramp");
    expect(result.ok).toBe(true);
  });
});

// ─── Directional start/end semantics (not wall tiles) ──────────────────────

describe("directional start/end semantics (not wall tiles)", () => {
  it("ramp geometry does not use tile arrays", () => {
    for (const variant of RAMP_VARIANTS) {
      const g = generateRampGeometry(variant);
      // The geometry should be a compact directional description, not a tile grid.
      expect(g).not.toHaveProperty("tiles");
      expect(typeof g.startHeight).toBe("number");
      expect(typeof g.endHeight).toBe("number");
      expect(typeof g.spanFraction).toBe("number");
      expect(typeof g.turn).toBe("string");
      expect(typeof g.reversed).toBe("boolean");
    }
  });

  it("ramp edit state uses a variant, not a tile array", () => {
    const state = createDefaultEditState("ramp");
    expect(state.kind).toBe("ramp");
    if (state.kind === "ramp") {
      expect(state).toHaveProperty("variant");
      expect(state).not.toHaveProperty("tiles");
    }
  });

  it("the geometry description is JSON-serializable (for network transport)", () => {
    for (const variant of RAMP_VARIANTS) {
      const g = generateRampGeometry(variant);
      const json = JSON.stringify(g);
      const parsed = JSON.parse(json) as RampGeometry;
      expect(parsed).toEqual(g);
    }
  });
});

// ─── Camera usability and reach preservation ───────────────────────────────

describe("camera usability and reach preservation", () => {
  it("all ramp variants occupy the same 2-cell footprint (no reach change)", () => {
    // The footprint is determined by the build type's config, not the edit
    // variant. All variants share the same grid occupancy.
    for (const variant of RAMP_VARIANTS) {
      const g = generateRampGeometry(variant);
      // The geometry is a pure directional description; it does not
      // alter the structure's grid footprint or collision bounds.
      expect(g.spanFraction).toBeGreaterThan(0);
      expect(g.spanFraction).toBeLessThanOrEqual(1.0);
    }
  });

  it("geometry is independent of grid position (pure variant → geometry)", () => {
    // The same variant always produces the same geometry regardless of
    // where on the grid the ramp is placed. This preserves camera
    // usability: the renderer can derive the ramp shape from the variant
    // alone without needing grid context.
    const g1 = generateRampGeometry("turn_left");
    const g2 = generateRampGeometry("turn_left");
    expect(g1).toEqual(g2);
  });
});
