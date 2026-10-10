/**
 * Behavioral NullEngine tests for EditPreviewPresentation (lightweight
 * prospective-edit preview geometry):
 *  - full-piece ghost + projected grid + result tiles + selection highlight
 *    are created per build type and posed on the piece
 *  - removed tiles produce openings (disabled result tiles)
 *  - selection highlight follows the selected tile (and hides with none)
 *  - invalid prospective edits present the clear red indication
 *  - ramp variants present the canonical span / direction markers
 *  - per-frame `show` fast path (no mesh/material growth)
 *  - build-type switch rebuilds the pool without leaking meshes
 *  - lifecycle: hide re-show reuse, dispose frees everything, safe re-dispose,
 *    and show-after-dispose is a no-op
 *  - the render-observer pulse stays in bounds and allocates nothing
 */
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene, Mesh, TransformNode } from "@babylonjs/core";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { StructureEditState } from "@buildshift/protocol";

import {
  EditPreviewPresentation,
  editRampLayout,
  editTileLayout,
  type EditPreviewInput,
} from "./EditPreviewPresentation";

const NAME_PREFIX = "edit-preview-";

// Canonical dimensions (packages/game-config BUILD_GRID).
const CELL = 5.12;
const LAYER = 3.84;

function makeScene(engine: NullEngine): Scene {
  const scene = new Scene(engine);
  const camera = new UniversalCamera("cam", new Vector3(0, 1, -3), scene);
  camera.setTarget(new Vector3(0, 1, 0));
  scene.activeCamera = camera;
  return scene;
}

function previewMeshes(scene: Scene): Mesh[] {
  return scene.meshes.filter((m): m is Mesh => m.name.startsWith(NAME_PREFIX));
}

function previewMaterials(scene: Scene): StandardMaterial[] {
  return scene.materials.filter((m): m is StandardMaterial => m.name.startsWith(NAME_PREFIX));
}

function meshByName(scene: Scene, name: string): Mesh | null {
  const mesh = scene.meshes.find((m) => m.name === name);
  return mesh === undefined ? null : (mesh as Mesh);
}

function materialByName(scene: Scene, name: string): StandardMaterial | null {
  const mat = scene.materials.find((m) => m.name === name);
  return mat === undefined ? null : (mat as StandardMaterial);
}

function wallState(...tiles: boolean[]): StructureEditState {
  return { kind: "wall", tiles: [...tiles] };
}

function baseInput(overrides: Partial<EditPreviewInput> = {}): EditPreviewInput {
  return {
    structureId: "s-1",
    buildType: "wall",
    grid: { x: 0, y: 0, z: 0 },
    rotation: 0,
    state: wallState(true, true, true, true, true, true, true, true, true),
    selectedTile: null,
    selectedVariant: null,
    ...overrides,
  };
}

describe("EditPreviewPresentation", () => {
  let engine: NullEngine;
  let scene: Scene;
  let preview: EditPreviewPresentation;
  let nowMs: number;

  beforeEach(() => {
    nowMs = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
  });

  afterEach(() => {
    preview?.dispose();
    engine?.dispose();
    vi.restoreAllMocks();
  });

  function advance(ms: number): void {
    nowMs += ms;
    scene.onBeforeRenderObservable.notifyObservers(scene);
  }

  // ── presentation set ──────────────────────────────────────────────────────

  it("shows the full piece, projected grid, result tiles, and selection for a wall", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    preview = new EditPreviewPresentation(scene);

    preview.show(baseInput({ selectedTile: 4 }));

    expect(preview.getVisible()).toBe(true);

    const root = scene.getTransformNodeByName(`${NAME_PREFIX}root`);
    expect(root).not.toBeNull();
    expect(root!.position.x).toBeCloseTo(0, 4);

    // Full-piece ghost.
    const base = meshByName(scene, `${NAME_PREFIX}base-piece`);
    expect(base).not.toBeNull();
    expect((base!.material as StandardMaterial).alpha).toBeCloseTo(0.16, 4);

    // Projected 3×3 grid: 2 vertical + 2 horizontal lines.
    const gridLines = previewMeshes(scene).filter((m) => m.name.startsWith(`${NAME_PREFIX}grid-`));
    expect(gridLines).toHaveLength(4);

    // Resulting shape: all 9 tiles solid → 9 enabled result tiles.
    const tiles = previewMeshes(scene).filter((m) => m.name.startsWith(`${NAME_PREFIX}tile-`));
    expect(tiles).toHaveLength(9);
    expect(tiles.every((t) => t.isEnabled())).toBe(true);

    // Selection highlight on the centre tile (local (0, h/2, 0)).
    const selection = meshByName(scene, `${NAME_PREFIX}selection`);
    expect(selection).not.toBeNull();
    expect(selection!.isEnabled()).toBe(true);
    expect(selection!.position.y).toBeCloseTo(LAYER / 2, 4);
    expect(selection!.position.x).toBeCloseTo(0, 4);

    // The geometry accessor mirrors the canonical model.
    const geometry = preview.getGeometry();
    expect(geometry).not.toBeNull();
    expect(geometry!.invalid).toBe(false);
    expect(geometry!.tiles[4].selected).toBe(true);
  });

  it("poses the preview on the piece grid anchor and cardinal rotation", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    preview = new EditPreviewPresentation(scene);

    preview.show(baseInput({ grid: { x: 1, y: 0, z: 2 }, rotation: 2 }));

    const root = scene.getTransformNodeByName(`${NAME_PREFIX}root`) as TransformNode;
    expect(root.position.x).toBeCloseTo(CELL, 4);
    expect(root.position.z).toBeCloseTo(2 * CELL, 4);
    expect(root.rotation.y).toBeCloseTo(Math.PI, 4);

    // Tile 6 (bottom-left, local x = −w/3) stays piece-local while the root
    // carries the 180° rotation (pose is applied on the root node).
    const tile6 = meshByName(scene, `${NAME_PREFIX}tile-6`) as Mesh;
    expect(tile6.position.x).toBeCloseTo(-CELL / 3, 4);
    expect(tile6.position.y).toBeCloseTo(LAYER - 2.5 * (LAYER / 3), 4);
    expect(root.position.x + 0).toBeCloseTo(CELL, 4); // anchor in world space
    expect(root.position.z).toBeCloseTo(2 * CELL, 4);
  });

  it("removed tiles open up: only solid tiles keep their result mesh enabled", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    preview = new EditPreviewPresentation(scene);

    // Window: the centre tile (4) removed.
    preview.show(baseInput({ state: wallState(true, true, true, true, false, true, true, true, true) }));

    const tiles = previewMeshes(scene).filter((m) => m.name.startsWith(`${NAME_PREFIX}tile-`));
    expect(tiles).toHaveLength(9);
    expect(meshByName(scene, `${NAME_PREFIX}tile-4`)!.isEnabled()).toBe(false);
    expect(tiles.filter((t) => t.isEnabled())).toHaveLength(8);
  });

  it("hides the selection highlight when no tile is selected", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    preview = new EditPreviewPresentation(scene);

    preview.show(baseInput());
    const selection = meshByName(scene, `${NAME_PREFIX}selection`);
    expect(selection!.isEnabled()).toBe(false);

    preview.show(baseInput({ selectedTile: 8 }));
    expect(selection!.isEnabled()).toBe(true);
    // Tile 8 = bottom-right: local (w/3, h − 2.5·h/3, 0).
    expect(selection!.position.x).toBeCloseTo(CELL / 3, 4);
    expect(selection!.position.y).toBeCloseTo(LAYER - 2.5 * (LAYER / 3), 4);
  });

  // ── validity indication ──────────────────────────────────────────────────

  it("presents a clear red indication for an invalid prospective edit", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    preview = new EditPreviewPresentation(scene);

    // A floor edited to the empty grid is invalid (floor authority rule).
    preview.show(
      baseInput({
        buildType: "floor",
        state: { kind: "floor_cone", tiles: [false, false, false, false] },
      }),
    );

    expect(preview.getGeometry()!.invalid).toBe(true);
    const resultMat = materialByName(scene, `${NAME_PREFIX}result`) as StandardMaterial;
    expect(resultMat.diffuseColor.r).toBeCloseTo(0.95, 3);
    expect(resultMat.diffuseColor.g).toBeCloseTo(0.25, 3);
    expect(resultMat.diffuseColor.b).toBeCloseTo(0.2, 3);

    // Back to a valid edit: green returns.
    preview.show(
      baseInput({
        buildType: "floor",
        state: { kind: "floor_cone", tiles: [true, true, true, false] },
      }),
    );
    expect(preview.getGeometry()!.invalid).toBe(false);
    expect(resultMat.diffuseColor.r).toBeCloseTo(0.3, 3);
    expect(resultMat.diffuseColor.g).toBeCloseTo(0.95, 3);
  });

  it("flags an out-of-range selection as invalid while still presenting the piece", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    preview = new EditPreviewPresentation(scene);

    preview.show(baseInput({ selectedTile: 9 }));

    expect(preview.getGeometry()!.invalid).toBe(true);
    // The full-piece ghost + grid are still presented (readable piece).
    expect(meshByName(scene, `${NAME_PREFIX}base-piece`)!.isEnabled()).toBe(true);
    expect(previewMeshes(scene).filter((m) => m.name.startsWith(`${NAME_PREFIX}grid-`))).toHaveLength(4);
    // ...with the red invalid result palette.
    const resultMat = materialByName(scene, `${NAME_PREFIX}result`) as StandardMaterial;
    expect(resultMat.diffuseColor.r).toBeCloseTo(0.95, 3);
  });

  // ── fast path + pool reuse ───────────────────────────────────────────────

  it("repeated per-frame show with unchanged input is a no-op (no growth)", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    preview = new EditPreviewPresentation(scene);

    const input = baseInput({ selectedTile: 4 });
    preview.show(input);
    const meshCount = previewMeshes(scene).length;
    const materialCount = previewMaterials(scene).length;

    for (let i = 0; i < 10; i++) {
      preview.show(input);
      advance(16);
    }

    expect(previewMeshes(scene)).toHaveLength(meshCount);
    expect(previewMaterials(scene)).toHaveLength(materialCount);
  });

  it("switching build type rebuilds the pool without leaking meshes", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    preview = new EditPreviewPresentation(scene);

    preview.show(baseInput());
    expect(previewMeshes(scene)).toHaveLength(15); // wall pool

    preview.show(
      baseInput({
        buildType: "floor",
        state: { kind: "floor_cone", tiles: [true, true, true, false] },
        selectedTile: null,
      }),
    );

    // Floor pool: base + 4 grid lines + 4 tiles + selection.
    expect(previewMeshes(scene)).toHaveLength(10);
    // Wall-only tiles are gone.
    expect(meshByName(scene, `${NAME_PREFIX}tile-5`)).toBeNull();
    // The removed floor quadrant is open.
    expect(meshByName(scene, `${NAME_PREFIX}tile-3`)!.isEnabled()).toBe(false);
    expect(previewMeshes(scene).filter((t) => t.name.startsWith(`${NAME_PREFIX}tile-`) && t.isEnabled())).toHaveLength(3);
  });

  // ── ramp variants ────────────────────────────────────────────────────────

  it("presents ramp variants as canonical spans with direction markers", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    preview = new EditPreviewPresentation(scene);

    const rampW = 2 * CELL; // two-cell-long ramp

    // half_left: left half present → span 0.5 centred at −w/4, high end mid.
    preview.show(
      baseInput({
        buildType: "ramp",
        state: { kind: "ramp", variant: "half_left" },
        selectedTile: null,
        selectedVariant: "half_right",
      }),
    );

    const result = meshByName(scene, `${NAME_PREFIX}ramp-result`) as Mesh;
    expect(result.scaling.x).toBeCloseTo(0.5, 4);
    expect(result.position.x).toBeCloseTo(-rampW / 4, 4);
    expect(result.position.y).toBeCloseTo((LAYER * 0.6) / 2, 4);

    // Selection highlight on the other half.
    const select = meshByName(scene, `${NAME_PREFIX}ramp-select`) as Mesh;
    expect(select.isEnabled()).toBe(true);
    expect(select.scaling.x).toBeCloseTo(0.5, 4);
    expect(select.position.x).toBeCloseTo(rampW / 4, 4);

    // High-end marker at the cut edge (mid-piece); no turn marker.
    const marker = meshByName(scene, `${NAME_PREFIX}ramp-highend`) as Mesh;
    expect(marker.position.x).toBeCloseTo(0, 4);
    expect(meshByName(scene, `${NAME_PREFIX}ramp-turn`)!.isEnabled()).toBe(false);

    // turn_right: full span, high end at +X, 90° segment toward +Z.
    preview.show(
      baseInput({
        buildType: "ramp",
        state: { kind: "ramp", variant: "turn_right" },
        selectedVariant: null,
      }),
    );
    expect(result.scaling.x).toBeCloseTo(1, 4);
    expect(result.position.x).toBeCloseTo(0, 4);
    expect(select.isEnabled()).toBe(false);
    const turn = meshByName(scene, `${NAME_PREFIX}ramp-turn`) as Mesh;
    expect(turn.isEnabled()).toBe(true);
    expect(turn.position.z).toBeCloseTo(CELL / 2, 4);
    expect(turn.position.x).toBeCloseTo(rampW / 2 - 0.175, 3);
  });

  it("presents cone edits as corner blocks with the projected base grid", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    preview = new EditPreviewPresentation(scene);

    // Full cone minus the SE corner.
    preview.show(
      baseInput({
        buildType: "cone",
        state: { kind: "floor_cone", tiles: [true, true, true, false] },
      }),
    );

    // Cone pool: base + 2 grid lines + 4 corner tiles + selection.
    expect(previewMeshes(scene)).toHaveLength(8);
    const gridLines = previewMeshes(scene).filter((m) => m.name.startsWith(`${NAME_PREFIX}grid-`));
    expect(gridLines).toHaveLength(2);
    expect(meshByName(scene, `${NAME_PREFIX}tile-3`)!.isEnabled()).toBe(false);
    expect(previewMeshes(scene).filter((t) => t.name.startsWith(`${NAME_PREFIX}tile-`) && t.isEnabled())).toHaveLength(3);
  });

  // ── lifecycle ────────────────────────────────────────────────────────────

  it("hide drops the preview from the scene; re-show reuses the pool", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    preview = new EditPreviewPresentation(scene);

    preview.show(baseInput({ selectedTile: 4 }));
    const meshCount = previewMeshes(scene).length;
    expect(preview.getVisible()).toBe(true);

    preview.hide();
    expect(preview.getVisible()).toBe(false);
    expect(scene.getTransformNodeByName(`${NAME_PREFIX}root`)!.isEnabled()).toBe(false);
    // Meshes are pooled, not destroyed.
    expect(previewMeshes(scene)).toHaveLength(meshCount);

    preview.show(baseInput({ selectedTile: 4 }));
    expect(preview.getVisible()).toBe(true);
    expect(previewMeshes(scene)).toHaveLength(meshCount);
  });

  it("hide before show and show after dispose are safe no-ops", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    preview = new EditPreviewPresentation(scene);

    preview.hide();
    expect(preview.getVisible()).toBe(false);

    preview.dispose();
    preview.show(baseInput());
    expect(previewMeshes(scene)).toHaveLength(0);
    expect(previewMaterials(scene)).toHaveLength(0);
    expect(preview.getVisible()).toBe(false);

    preview.dispose(); // idempotent
    expect(previewMeshes(scene)).toHaveLength(0);
  });

  it("dispose frees every owned mesh and material", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    preview = new EditPreviewPresentation(scene);

    preview.show(baseInput({ selectedTile: 4 }));
    expect(previewMeshes(scene)).toHaveLength(15);
    expect(previewMaterials(scene)).toHaveLength(5);

    preview.dispose();

    expect(previewMeshes(scene)).toHaveLength(0);
    expect(previewMaterials(scene)).toHaveLength(0);
    expect(scene.getTransformNodeByName(`${NAME_PREFIX}root`)).toBeNull();
  });

  it("the render tick pulses opacity in bounds and allocates nothing", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    preview = new EditPreviewPresentation(scene);

    preview.show(baseInput());
    const resultMat = materialByName(scene, `${NAME_PREFIX}result`) as StandardMaterial;
    const selectMat = materialByName(scene, `${NAME_PREFIX}select`) as StandardMaterial;
    expect(previewMeshes(scene)).toHaveLength(15); // wall pool before any build-type switch

    const validAlphas: number[] = [];
    for (let i = 0; i < 25; i++) {
      advance(16);
      validAlphas.push(resultMat.alpha);
    }
    for (const a of validAlphas) {
      expect(a).toBeGreaterThanOrEqual(0.34);
      expect(a).toBeLessThanOrEqual(0.56);
    }
    // The pulse actually oscillates.
    expect(Math.max(...validAlphas) - Math.min(...validAlphas)).toBeGreaterThan(0.05);
    expect(selectMat.alpha).toBeGreaterThan(0.6);

    // Invalid: wider, faster pulse range.
    preview.show(
      baseInput({
        buildType: "floor",
        state: { kind: "floor_cone", tiles: [false, false, false, false] },
      }),
    );
    // Baseline after the build-type switch (floor pool is smaller than wall).
    const meshCountAfterSwitch = previewMeshes(scene).length;
    const materialCountAfterSwitch = previewMaterials(scene).length;
    const invalidAlphas: number[] = [];
    for (let i = 0; i < 25; i++) {
      advance(16);
      invalidAlphas.push(resultMat.alpha);
    }
    for (const a of invalidAlphas) {
      expect(a).toBeGreaterThanOrEqual(0.27);
      expect(a).toBeLessThanOrEqual(0.73);
    }
    expect(Math.max(...invalidAlphas) - Math.min(...invalidAlphas)).toBeGreaterThan(0.2);

    // No resource growth across the whole tick loop.
    expect(previewMeshes(scene)).toHaveLength(meshCountAfterSwitch);
    expect(previewMaterials(scene)).toHaveLength(materialCountAfterSwitch);

    // Hidden: the tick does no material work.
    preview.hide();
    const alphaBefore = resultMat.alpha;
    advance(16);
    expect(resultMat.alpha).toBe(alphaBefore);
  });
});

// ── pure layout helpers ─────────────────────────────────────────────────────

describe("editTileLayout / editRampLayout", () => {
  it("lays out wall tiles on the panel face (row 0 = top)", () => {
    const center = editTileLayout("wall", 4).center;
    expect(center[0]).toBeCloseTo(0, 4);
    expect(center[1]).toBeCloseTo(LAYER / 2, 4);
    expect(center[2]).toBeCloseTo(0, 4);

    const topRight = editTileLayout("wall", 2).center;
    expect(topRight[0]).toBeCloseTo(CELL / 3, 4);
    expect(topRight[1]).toBeCloseTo(LAYER - 0.5 * (LAYER / 3), 4);

    const bottomLeft = editTileLayout("wall", 6).center;
    expect(bottomLeft[0]).toBeCloseTo(-CELL / 3, 4);
    expect(bottomLeft[1]).toBeCloseTo(LAYER - 2.5 * (LAYER / 3), 4);
  });

  it("lays out floor tiles as quarter slabs on the base", () => {
    const nw = editTileLayout("floor", 0);
    expect(nw.center[0]).toBeCloseTo(-CELL / 4, 4);
    expect(nw.center[2]).toBeCloseTo(-CELL / 4, 4);
    const se = editTileLayout("floor", 3);
    expect(se.center[0]).toBeCloseTo(CELL / 4, 4);
    expect(se.center[2]).toBeCloseTo(CELL / 4, 4);
  });

  it("lays out cone tiles as full-height corner blocks", () => {
    const ne = editTileLayout("cone", 1);
    expect(ne.center[0]).toBeCloseTo(CELL / 4, 4);
    expect(ne.center[2]).toBeCloseTo(-CELL / 4, 4);
    expect(ne.size[1]).toBeCloseTo(LAYER, 4);
  });

  it("rejects non-tile build types and unknown ramp variants", () => {
    expect(() => editTileLayout("ramp" as never, 0)).toThrow(/not a tile-based/);
    expect(() => editRampLayout("up" as never)).toThrow(/unknown ramp variant/);
  });

  it("lays out ramp spans with canonical half lengths and marker positions", () => {
    const rampW = 2 * CELL;
    const full = editRampLayout("full");
    expect(full.resultLength).toBeCloseTo(rampW, 4);
    expect(full.resultCenter[0]).toBeCloseTo(0, 4);
    expect(full.markerX).toBeCloseTo(rampW / 2 - 0.175, 3);
    expect(full.turnZ).toBeNull();

    const halfLeft = editRampLayout("half_left");
    expect(halfLeft.resultLength).toBeCloseTo(rampW / 2, 4);
    expect(halfLeft.resultCenter[0]).toBeCloseTo(-rampW / 4, 4);
    expect(halfLeft.markerX).toBeCloseTo(0, 4);

    const flipped = editRampLayout("flipped");
    expect(flipped.markerX).toBeCloseTo(-rampW / 2 + 0.175, 3);

    const turnLeft = editRampLayout("turn_left");
    expect(turnLeft.turnZ).toBeCloseTo(-CELL / 2, 4);
    const turnRight = editRampLayout("turn_right");
    expect(turnRight.turnZ).toBeCloseTo(CELL / 2, 4);
  });
});
