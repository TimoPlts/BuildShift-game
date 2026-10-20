/**
 * Model-mapping tests for editPreviewGeometry:
 *  - wall 3×3 tile mapping (row-major, row 0 = top)
 *  - floor / cone 2×2 tile mapping
 *  - selection highlighting + out-of-range selection invalidation
 *  - floor authority rule (a floor cannot be edited to the empty grid)
 *  - cone full vocabulary cross-check (every canonical cone shape)
 *  - ramp directional variants vs the canonical ramp geometry
 *  - malformed / unknown inputs → clear invalid indication with fallback
 *  - purity: deterministic, fresh objects, inputs never mutated
 */
import { describe, expect, it } from "vitest";

import {
  RAMP_VARIANTS,
  generateRampGeometry,
  type RampVariant,
  type StructureEditState,
} from "@buildshift/protocol";

import { buildEditPreviewGeometry } from "./editPreviewGeometry";
import { CONE_SHAPE_IDS, CONE_SHAPE_TILES, coneTilesForShape } from "./coneEdit";

// ── helpers ─────────────────────────────────────────────────────────────────

function wallTiles(...flags: boolean[]): StructureEditState {
  return { kind: "wall", tiles: [...flags] };
}

function floorConeTiles(...flags: boolean[]): StructureEditState {
  return { kind: "floor_cone", tiles: [...flags] };
}

// ── wall 3×3 ────────────────────────────────────────────────────────────────

describe("wall 3×3 tile mapping", () => {
  it("maps the default (all-solid) state to nine solid tiles", () => {
    const geo = buildEditPreviewGeometry(
      "wall",
      wallTiles(true, true, true, true, true, true, true, true, true),
      null,
    );
    expect(geo.cols).toBe(3);
    expect(geo.rows).toBe(3);
    expect(geo.tiles).toHaveLength(9);
    expect(geo.tiles.every((t) => t.solid)).toBe(true);
    expect(geo.invalid).toBe(false);
    expect(geo.invalidReason).toBeNull();
    expect(geo.ramp).toBeNull();
  });

  it("marks removed tiles as open and keeps the grid positions row-major", () => {
    // Remove the centre tile (index 4) and the top-left corner (index 0).
    const geo = buildEditPreviewGeometry(
      "wall",
      wallTiles(false, true, true, true, false, true, true, true, true),
      null,
    );
    expect(geo.tiles[0].solid).toBe(false);
    expect(geo.tiles[0].col).toBe(0);
    expect(geo.tiles[0].row).toBe(0);
    expect(geo.tiles[4].solid).toBe(false);
    expect(geo.tiles[4].col).toBe(1);
    expect(geo.tiles[4].row).toBe(1);
    expect(geo.tiles[8].col).toBe(2);
    expect(geo.tiles[8].row).toBe(2);
    expect(geo.tiles.filter((t) => t.solid)).toHaveLength(7);
  });

  it("highlights the selected tile and flags out-of-range selections invalid", () => {
    const solid = wallTiles(true, true, true, true, true, true, true, true, true);

    const selected = buildEditPreviewGeometry("wall", solid, 4);
    expect(selected.tiles[4].selected).toBe(true);
    expect(selected.tiles.filter((t) => t.selected)).toHaveLength(1);
    expect(selected.invalid).toBe(false);

    const tooHigh = buildEditPreviewGeometry("wall", solid, 9);
    expect(tooHigh.invalid).toBe(true);
    expect(tooHigh.invalidReason).toMatch(/out of range/);

    const tooLow = buildEditPreviewGeometry("wall", solid, -1);
    expect(tooLow.invalid).toBe(true);
  });
});

// ── floor / cone 2×2 ────────────────────────────────────────────────────────

describe("floor / cone 2×2 tile mapping", () => {
  it("maps a floor with one removed quadrant", () => {
    const geo = buildEditPreviewGeometry("floor", floorConeTiles(true, true, true, false), null);
    expect(geo.cols).toBe(2);
    expect(geo.rows).toBe(2);
    expect(geo.tiles[3].solid).toBe(false);
    expect(geo.tiles[3].col).toBe(1);
    expect(geo.tiles[3].row).toBe(1);
    expect(geo.tiles.filter((t) => t.solid)).toHaveLength(3);
    expect(geo.invalid).toBe(false);
  });

  it("flags an out-of-range floor selection as invalid", () => {
    const geo = buildEditPreviewGeometry("floor", floorConeTiles(true, true, true, true), 4);
    expect(geo.invalid).toBe(true);
    expect(geo.invalidReason).toMatch(/out of range/);
  });

  it("applies the floor authority rule: the empty grid is invalid", () => {
    const geo = buildEditPreviewGeometry("floor", floorConeTiles(false, false, false, false), null);
    expect(geo.invalid).toBe(true);
    expect(geo.invalidReason).toMatch(/empty/);
    // The removed tiles are still described (all open) for the presentation.
    expect(geo.tiles.every((t) => !t.solid)).toBe(true);
  });

  it("allows the cone full vocabulary, including the fully-removed `none` shape", () => {
    // A cone may be edited to nothing (unlike a floor).
    const none = buildEditPreviewGeometry("cone", floorConeTiles(false, false, false, false), null);
    expect(none.invalid).toBe(false);
    expect(none.tiles.every((t) => !t.solid)).toBe(true);
  });

  it("matches the canonical cone shape vocabulary tile-for-tile", () => {
    for (const shape of CONE_SHAPE_IDS) {
      const tiles = coneTilesForShape(shape);
      const geo = buildEditPreviewGeometry("cone", { kind: "floor_cone", tiles }, null);
      expect(geo.invalid, shape).toBe(false);
      expect(
        geo.tiles.map((t) => t.solid),
        shape,
      ).toEqual([...CONE_SHAPE_TILES[shape]]);
    }
  });
});

// ── ramp directional variants ───────────────────────────────────────────────

describe("ramp directional variant mapping", () => {
  it("derives the canonical ramp geometry for every variant", () => {
    for (const variant of RAMP_VARIANTS) {
      const geo = buildEditPreviewGeometry("ramp", { kind: "ramp", variant }, null, null);
      expect(geo.invalid, variant).toBe(false);
      expect(geo.tiles, variant).toEqual([]);
      expect(geo.ramp, variant).not.toBeNull();
      expect(geo.ramp!.variant, variant).toBe(variant);
      expect(geo.ramp!.geometry, variant).toEqual(generateRampGeometry(variant));
      expect(geo.ramp!.selectedGeometry, variant).toBeNull();
    }
  });

  it("carries the selected variant's geometry for the highlight", () => {
    const geo = buildEditPreviewGeometry("ramp", { kind: "ramp", variant: "full" }, null, "half_left");
    expect(geo.invalid).toBe(false);
    expect(geo.ramp!.selectedVariant).toBe("half_left");
    expect(geo.ramp!.selectedGeometry).toEqual(generateRampGeometry("half_left"));
  });

  it("flags a non-canonical selected variant as invalid", () => {
    const geo = buildEditPreviewGeometry(
      "ramp",
      { kind: "ramp", variant: "full" },
      null,
      "up" as RampVariant,
    );
    expect(geo.invalid).toBe(true);
    expect(geo.invalidReason).toMatch(/unknown ramp variant/);
    expect(geo.ramp!.selectedGeometry).toBeNull();
  });

  it("keeps the ramp variant semantics: halves split the width (full span), turns keep span 1.0", () => {
    const halfLeft = buildEditPreviewGeometry("ramp", { kind: "ramp", variant: "half_left" }, null, null);
    const halfRight = buildEditPreviewGeometry("ramp", { kind: "ramp", variant: "half_right" }, null, null);
    const turnLeft = buildEditPreviewGeometry("ramp", { kind: "ramp", variant: "turn_left" }, null, null);
    const flipped = buildEditPreviewGeometry("ramp", { kind: "ramp", variant: "flipped" }, null, null);
    expect(halfLeft.ramp!.geometry.spanFraction).toBe(1.0);
    expect(halfLeft.ramp!.geometry.width).toBe("left");
    expect(halfLeft.ramp!.geometry.reversed).toBe(false);
    expect(halfRight.ramp!.geometry.spanFraction).toBe(1.0);
    expect(halfRight.ramp!.geometry.width).toBe("right");
    expect(halfRight.ramp!.geometry.reversed).toBe(false);
    expect(turnLeft.ramp!.geometry.spanFraction).toBe(1.0);
    expect(turnLeft.ramp!.geometry.turn).toBe("left");
    expect(flipped.ramp!.geometry.reversed).toBe(true);
  });
});

// ── invalid indication + fallback ───────────────────────────────────────────

describe("invalid indication + fallback", () => {
  it("marks a malformed wall state invalid and falls back to the full piece", () => {
    const malformed = { kind: "wall", tiles: [true, true, true] } as StructureEditState;
    const geo = buildEditPreviewGeometry("wall", malformed, null);
    expect(geo.invalid).toBe(true);
    expect(geo.invalidReason).toMatch(/tiles/);
    // Fallback: the default (full) piece is still described.
    expect(geo.tiles).toHaveLength(9);
    expect(geo.tiles.every((t) => t.solid)).toBe(true);
    expect(geo.tiles.every((t) => !t.selected)).toBe(true);
  });

  it("marks a malformed ramp state invalid with the full-variant fallback", () => {
    const malformed = { kind: "ramp", variant: "sideways" } as unknown as StructureEditState;
    const geo = buildEditPreviewGeometry("ramp", malformed, null, null);
    expect(geo.invalid).toBe(true);
    expect(geo.ramp).not.toBeNull();
    expect(geo.ramp!.variant).toBe("full");
    expect(geo.ramp!.geometry).toEqual(generateRampGeometry("full"));
  });

  it("marks an unknown build type invalid with an empty descriptor", () => {
    const geo = buildEditPreviewGeometry(
      "tower",
      { kind: "wall", tiles: [true, true, true, true, true, true, true, true, true] },
      null,
    );
    expect(geo.invalid).toBe(true);
    expect(geo.invalidReason).toMatch(/unknown build type/);
    expect(geo.tiles).toEqual([]);
    expect(geo.ramp).toBeNull();
  });
});

// ── purity ──────────────────────────────────────────────────────────────────

describe("purity", () => {
  it("is deterministic and never mutates its inputs", () => {
    const state = wallTiles(true, false, true, true, true, true, true, false, true);
    const snapshot = JSON.parse(JSON.stringify(state));

    const a = buildEditPreviewGeometry("wall", state, 2, null);
    const b = buildEditPreviewGeometry("wall", state, 2, null);
    expect(b).toEqual(a);
    expect(state).toEqual(snapshot);
  });

  it("returns fresh tile arrays on each call", () => {
    const state = wallTiles(true, true, true, true, true, true, true, true, true);
    const a = buildEditPreviewGeometry("wall", state, null);
    a.tiles[0].solid = false;
    a.tiles[0].selected = true;
    const b = buildEditPreviewGeometry("wall", state, null);
    expect(b.tiles[0].solid).toBe(true);
    expect(b.tiles[0].selected).toBe(false);
  });
});
