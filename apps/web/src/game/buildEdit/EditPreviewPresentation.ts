/**
 * EditPreviewPresentation — the lightweight, presentation-only Babylon.js
 * preview of a *prospective* piece edit.
 *
 * After the per-piece edit definitions integrated (wall 3×3 tiles, floor /
 * cone 2×2 tiles, ramp directional variants), this component shows — for the
 * structure the player is aiming to edit — what the piece **would look like**
 * if the pending canonical edit were accepted:
 *
 *  - **full piece** — a low-opacity ghost of the unmodified piece, so the
 *    projection always reads against a complete silhouette,
 *  - **projected grid** — thin lines marking the piece's tile grid (3×3 on a
 *    wall face, 2×2 on a floor/cone base, the two half-cells of a ramp),
 *  - **resulting shape** — one ghost tile per *solid* tile of the
 *    prospective canonical state (removed tiles simply have no tile: the
 *    opening), or the canonical ramp variant span,
 *  - **selected highlight** — a brighter tile (or ramp span) under the
 *    player's current selection, and
 *  - **invalid indication** — the same red, faster/wider opacity pulse the
 *    placement preview uses for rejected candidates, driven by the
 *    {@link buildEditPreviewGeometry} validity result.
 *
 * Authority contract: this component renders **only the canonical edit
 * model** it is handed. It never creates real (authoritative) structure
 * geometry, never mutates the building mirror, never sends or receives
 * network messages, and never performs gameplay checks. Its meshes are
 * non-pickable, collision-free, and owned exclusively by this instance —
 * `hide()` drops them from the scene and `dispose()` frees every Babylon
 * resource. The authoritative server remains the sole decider of whether an
 * edit is actually applied.
 *
 * Performance: a fixed, small mesh pool per build type (≤ 15 tiny boxes +
 * 5 shared materials) is created once and reused across `show()` calls;
 * a fingerprint fast path makes repeated per-frame `show()` with unchanged
 * input allocation-free, and the render-observer tick only rewrites a few
 * material alphas (the opacity pulse).
 *
 * Usage:
 * ```ts
 * const preview = new EditPreviewPresentation(scene);
 * preview.show({
 *   structureId: "s-1",
 *   buildType: "wall",
 *   grid: { x: 0, y: 0, z: 1 },
 *   rotation: 0,
 *   state: { kind: "wall", tiles: [true, true, true, true, false, true, true, true, true] },
 *   selectedTile: 4,
 *   selectedVariant: null,
 * });
 * // ...
 * preview.hide();
 * preview.dispose();
 * ```
 */
import type { Scene, Observer } from "@babylonjs/core";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BUILD_GRID, getStructureConfig } from "@buildshift/game-config";
import type {
  BuildType,
  GridPosition,
  GridRotation,
  RampVariant,
  StructureEditState,
} from "@buildshift/protocol";
import {
  buildEditPreviewGeometry,
  type EditPreviewGeometry,
} from "./editPreviewGeometry";

/** The full prospective-edit input handed to {@link EditPreviewPresentation.show}. */
export interface EditPreviewInput {
  /** The structure being edited (positions the preview on the piece). */
  structureId: string;
  /** The structure's build type (drives the piece shape + tile grid). */
  buildType: BuildType;
  /** The structure's authoritative grid anchor. */
  grid: GridPosition;
  /** The structure's authoritative cardinal rotation (0–3). */
  rotation: GridRotation;
  /** The canonical prospective edit state to present (server truth / pending). */
  state: StructureEditState;
  /**
   * The tile the player currently has selected (wall 0–8, floor/cone 0–3),
   * or `null` when nothing is selected.
   */
  selectedTile: number | null;
  /**
   * The ramp variant the player currently has selected, or `null` for
   * non-ramp pieces.
   */
  selectedVariant: RampVariant | null;
}

// ─── Pose helpers (match BuildStructureRenderer conventions) ───────────────

/** Grid anchor → world position (cell sizes / layer heights are shared). */
function gridToWorld(grid: GridPosition): Vector3 {
  return new Vector3(
    grid.x * BUILD_GRID.cellSize,
    grid.y * BUILD_GRID.layerHeight,
    grid.z * BUILD_GRID.cellSize,
  );
}

/** World footprint dims (metres) for a build type. */
function footprintDims(buildType: BuildType): [number, number, number] {
  const config = getStructureConfig(buildType);
  const [fx, fy, fz] = config?.footprint ?? [1, 1, 1];
  return [
    fx * BUILD_GRID.cellSize,
    fy * BUILD_GRID.layerHeight,
    fz * BUILD_GRID.cellSize,
  ];
}

/** Cardinal rotation → Y-axis radians (same table as the structure renderer). */
function rotationToYAxis(rotation: GridRotation): number {
  const steps = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
  return steps[rotation] ?? 0;
}

// ─── Visual constants (same language as the placement preview) ─────────────

const NAME_PREFIX = "edit-preview-";

/** Ghost of the unmodified full piece (always neutral, calm, low opacity). */
const BASE_COLOR = new Color3(0.55, 0.62, 0.72);
const BASE_ALPHA = 0.16;

/** Projected grid lines (neutral, thin, low opacity). */
const GRID_COLOR = new Color3(0.9, 0.92, 0.95);
const GRID_ALPHA = 0.3;
const GRID_LINE = 0.06;

/** Resulting-shape ghost: valid = BuildShift preview green, invalid = red. */
const RESULT_VALID_COLOR = new Color3(0.3, 0.95, 0.6);
const RESULT_INVALID_COLOR = new Color3(0.95, 0.25, 0.2);
const RESULT_VALID_BASE = 0.45;
const RESULT_VALID_PULSE = 0.1;
const RESULT_VALID_FREQ = 2.5;
const RESULT_INVALID_BASE = 0.5;
const RESULT_INVALID_PULSE = 0.22;
const RESULT_INVALID_FREQ = 4.5;

/** Selected-tile highlight (brighter, tighter pulse). */
const SELECT_VALID_COLOR = new Color3(0.45, 1.0, 0.75);
const SELECT_INVALID_COLOR = new Color3(1.0, 0.4, 0.3);
const SELECT_BASE = 0.8;
const SELECT_PULSE = 0.08;
const SELECT_FREQ = 2.5;

/** Ramp direction / turn markers (calm amber). */
const MARKER_COLOR = new Color3(1.0, 0.8, 0.35);
const MARKER_ALPHA = 0.6;
const MARKER_SIZE = 0.35;

/** Inset between adjacent result tiles so openings read clearly. */
const TILE_GAP = 0.12;
/** Extra size of the selection highlight over its tile. */
const SELECT_EXTRA = 0.1;

// ─── Piece-local layout (pure math, testable without a scene) ──────────────

/**
 * Piece-local layout for one projected tile: its centre offset (metres, in
 * the piece's unrotated frame with the grid anchor at the origin) and its
 * box dimensions. Shared by the presentation layer and unit tests.
 */
export interface EditTileLayout {
  center: [number, number, number];
  size: [number, number, number];
}

/**
 * Computes the piece-local layout of the result tile for one tile index.
 *
 * Walls project their 3×3 grid onto the thin panel face (row 0 = top).
 * Floors / cones project their 2×2 grid onto the base footprint
 * (row 0 = −Z edge, i.e. the row closest to the anchor).
 *
 * @throws {Error} when `buildType` is not a tile-based build type.
 */
export function editTileLayout(buildType: BuildType, tileIndex: number): EditTileLayout {
  const [w, h, d] = footprintDims(buildType);
  if (buildType === "wall") {
    const cols = 3;
    const rows = 3;
    const col = tileIndex % cols;
    const row = Math.floor(tileIndex / cols);
    const tileW = w / cols;
    const tileH = h / rows;
    return {
      // Row 0 is the top row of the wall face.
      center: [(col - 1) * tileW, h - (row + 0.5) * tileH, 0],
      size: [tileW - TILE_GAP, tileH - TILE_GAP, d * 0.15 * 1.6],
    };
  }
  if (buildType === "floor" || buildType === "cone") {
    const col = tileIndex % 2;
    const row = Math.floor(tileIndex / 2);
    return {
      center: [(col - 0.5) * (w / 2), buildType === "floor" ? 0.2 : h / 2, (row - 0.5) * (d / 2)],
      size: [w / 2 - TILE_GAP, buildType === "floor" ? 0.06 : h, d / 2 - TILE_GAP],
    };
  }
  throw new Error(`editTileLayout: not a tile-based build type: ${buildType}`);
}

/**
 * Computes the piece-local layout of the ramp result span for a variant:
 * the centred box that covers the present portion of the two-cell ramp,
 * plus the "high end" marker position and the optional turn marker offset.
 *
 * Convention (mirrors the canonical ramp geometry's directional
 * start/end semantics): the default (non-reversed) ramp rises from the −X
 * end (start, low) toward the +X end (end, high). `reversed` swaps which
 * end is high. `turn_*` variants extend a short 90° segment at the high
 * end (−Z for turn_left, +Z for turn_right, facing the ramp's travel).
 *
 * @throws {Error} when `variant` is not a canonical ramp variant.
 */
export function editRampLayout(
  variant: RampVariant,
): {
  resultCenter: [number, number, number];
  resultLength: number;
  markerX: number;
  turnZ: number | null;
} {
  const variants = ["full", "flipped", "half_left", "half_right", "turn_left", "turn_right"];
  if (!variants.includes(variant)) {
    throw new Error(`editRampLayout: unknown ramp variant: ${String(variant)}`);
  }
  const [w, h, d] = footprintDims("ramp");
  const rampH = h * 0.6; // matches the structure renderer's ramp visual height
  const y = rampH / 2;

  switch (variant) {
    case "full":
      return { resultCenter: [0, y, 0], resultLength: w, markerX: w / 2 - MARKER_SIZE / 2, turnZ: null };
    case "flipped":
      return { resultCenter: [0, y, 0], resultLength: w, markerX: -w / 2 + MARKER_SIZE / 2, turnZ: null };
    case "half_left":
      // Left half of the footprint present; the cut (high) end is mid-piece.
      return { resultCenter: [-w / 4, y, 0], resultLength: w / 2, markerX: 0, turnZ: null };
    case "half_right":
      return { resultCenter: [w / 4, y, 0], resultLength: w / 2, markerX: 0, turnZ: null };
    case "turn_left":
      return { resultCenter: [0, y, 0], resultLength: w, markerX: w / 2 - MARKER_SIZE / 2, turnZ: -d / 2 };
    case "turn_right":
      return { resultCenter: [0, y, 0], resultLength: w, markerX: w / 2 - MARKER_SIZE / 2, turnZ: d / 2 };
  }
  // Unreachable: the switch is exhaustive over the canonical variants.
  throw new Error(`editRampLayout: unhandled ramp variant: ${String(variant)}`);
}

// ─── EditPreviewPresentation ───────────────────────────────────────────────

/** The owned preview mesh pool for one build type. */
interface PreviewPool {
  base: AbstractMesh;
  grid: AbstractMesh[];
  tiles: AbstractMesh[];
  selection: AbstractMesh | null;
  rampResult: AbstractMesh | null;
  rampSelection: AbstractMesh | null;
  rampMarker: AbstractMesh | null;
  rampTurn: AbstractMesh | null;
}

/**
 * The lightweight prospective-edit preview (presentation-only).
 *
 * All meshes and materials are owned by this instance and freed by
 * {@link dispose}. Safe to construct per scene and dispose on teardown.
 */
export class EditPreviewPresentation {
  private readonly scene: Scene;
  private disposed = false;

  /** Root node positioned/rotated on the piece; `null` until first show. */
  private root: TransformNode | null = null;
  private pool: PreviewPool | null = null;
  private poolBuildType: BuildType | null = null;

  private baseMat: StandardMaterial | null = null;
  private gridMat: StandardMaterial | null = null;
  private resultMat: StandardMaterial | null = null;
  private selectMat: StandardMaterial | null = null;
  private markerMat: StandardMaterial | null = null;

  /** Fingerprint of the last applied input (per-frame fast path). */
  private lastKey: string | null = null;
  private lastInvalid = false;
  /** The geometry of the last applied input (HUD / debug access). */
  private lastGeometry: EditPreviewGeometry | null = null;

  private readonly observer: Observer<Scene>;

  public constructor(scene: Scene) {
    this.scene = scene;
    this.observer = scene.onBeforeRenderObservable.add(() => this.tick());
  }

  /** True while a preview is currently presented in the scene. */
  public getVisible(): boolean {
    return !this.disposed && this.root !== null && this.root.isEnabled();
  }

  /**
   * The geometry of the last presented input (or `null`), so HUD layers can
   * read the validity result / tile mapping without re-deriving it.
   */
  public getGeometry(): EditPreviewGeometry | null {
    return this.lastGeometry;
  }

  /**
   * Presents (or re-targets) the prospective edit preview on a piece.
   *
   * Idempotent per input: unchanged inputs take an allocation-free fast
   * path; a build-type change rebuilds the small mesh pool; everything is
   * derived from the canonical {@link EditPreviewInput} only.
   */
  public show(input: EditPreviewInput): void {
    if (this.disposed) return;

    const key = this.fingerprint(input);
    if (this.root !== null && key === this.lastKey) {
      this.ensureEnabled();
      return;
    }

    if (this.root === null) {
      this.root = new TransformNode(`${NAME_PREFIX}root`, this.scene);
    }

    if (this.poolBuildType !== input.buildType || this.pool === null) {
      this.rebuildPool(input.buildType);
    }

    const pool = this.pool;
    if (pool === null) return;
    const geometry = buildEditPreviewGeometry(
      input.buildType,
      input.state,
      input.selectedTile,
      input.selectedVariant,
    );
    this.lastGeometry = geometry;

    // Pose: anchor + cardinal rotation on the root node.
    const world = gridToWorld(input.grid);
    this.root.position.copyFrom(world);
    this.root.rotation.y = rotationToYAxis(input.rotation);
    this.ensureEnabled();

    this.applyInvalid(geometry.invalid);
    this.applyGeometry(pool, geometry);
    this.lastKey = key;
  }

  /**
   * Hides the preview (meshes are kept pooled for reuse, disabled in the
   * scene). The next {@link show} re-enables without recreating anything.
   */
  public hide(): void {
    if (this.disposed || this.root === null) return;
    this.root.setEnabled(false);
  }

  /** Frees every owned Babylon resource. Safe to call multiple times. */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.onBeforeRenderObservable.remove(this.observer);
    this.disposePool();
    for (const mat of [this.baseMat, this.gridMat, this.resultMat, this.selectMat, this.markerMat]) {
      if (mat) mat.dispose();
    }
    if (this.root) {
      this.root.dispose();
      this.root = null;
    }
    this.baseMat = this.gridMat = this.resultMat = this.selectMat = this.markerMat = null;
    this.lastKey = null;
    this.lastGeometry = null;
  }

  // ─── Private: pool lifecycle ─────────────────────────────────────────────

  private ensureEnabled(): void {
    if (this.root !== null) {
      this.root.setEnabled(true);
    }
  }

  /** Disposes every pool mesh (materials are disposed separately). */
  private disposePool(): void {
    if (this.pool === null) return;
    this.pool.base.dispose();
    for (const m of this.pool.grid) m.dispose();
    for (const m of this.pool.tiles) m.dispose();
    if (this.pool.selection) this.pool.selection.dispose();
    if (this.pool.rampResult) this.pool.rampResult.dispose();
    if (this.pool.rampSelection) this.pool.rampSelection.dispose();
    if (this.pool.rampMarker) this.pool.rampMarker.dispose();
    if (this.pool.rampTurn) this.pool.rampTurn.dispose();
    this.pool = null;
    this.poolBuildType = null;
  }

  /** Creates the small fixed mesh pool for one build type. */
  private rebuildPool(buildType: BuildType): void {
    this.disposePool();
    this.poolBuildType = buildType;
    const root = this.root;
    if (root === null) return;

    this.baseMat = this.baseMat ?? this.makeMaterial(`${NAME_PREFIX}base`, BASE_COLOR, BASE_ALPHA);
    this.gridMat = this.gridMat ?? this.makeMaterial(`${NAME_PREFIX}grid`, GRID_COLOR, GRID_ALPHA);
    this.resultMat = this.resultMat ?? this.makeMaterial(`${NAME_PREFIX}result`, RESULT_VALID_COLOR, RESULT_VALID_BASE);
    this.selectMat = this.selectMat ?? this.makeMaterial(`${NAME_PREFIX}select`, SELECT_VALID_COLOR, SELECT_BASE);
    this.markerMat = this.markerMat ?? this.makeMaterial(`${NAME_PREFIX}marker`, MARKER_COLOR, MARKER_ALPHA);

    const [w, h, d] = footprintDims(buildType);
    const tiles: AbstractMesh[] = [];

    let base: AbstractMesh;
    let grid: AbstractMesh[] = [];

    if (buildType === "wall") {
      const panelDepth = d * 0.15;
      base = this.box(`${NAME_PREFIX}base-piece`, w, h, panelDepth, [0, h / 2, 0], this.baseMat);
      // 3×3 projected grid on the panel face: 2 inner vertical + 2 inner horizontal lines.
      const tileW = w / 3;
      const tileH = h / 3;
      for (const x of [-tileW / 2, tileW / 2]) {
        grid.push(this.box(`${NAME_PREFIX}grid-v`, GRID_LINE, h, GRID_LINE, [x, h / 2, 0], this.gridMat));
      }
      for (const y of [h / 2 - tileH / 2, h / 2 + tileH / 2]) {
        grid.push(this.box(`${NAME_PREFIX}grid-h`, w, GRID_LINE, GRID_LINE, [0, y, 0], this.gridMat));
      }
      for (let i = 0; i < 9; i++) {
        const layout = editTileLayout("wall", i);
        tiles.push(this.box(`${NAME_PREFIX}tile-${i}`, layout.size[0], layout.size[1], layout.size[2], layout.center, this.resultMat));
      }
      const sel = editTileLayout("wall", 0);
      const selection = this.box(
        `${NAME_PREFIX}selection`,
        sel.size[0] + SELECT_EXTRA,
        sel.size[1] + SELECT_EXTRA,
        sel.size[2] + SELECT_EXTRA,
        [0, 0, 0],
        this.selectMat,
      );
      this.pool = { base, grid, tiles, selection, rampResult: null, rampSelection: null, rampMarker: null, rampTurn: null };
    } else if (buildType === "floor") {
      const slabH = 0.15; // matches the structure renderer's floor slab
      base = this.box(`${NAME_PREFIX}base-piece`, w, slabH, d, [0, slabH / 2, 0], this.baseMat);
      // 2×2 projected grid on the slab top: 2 lines each direction.
      for (const z of [-d / 4, d / 4]) {
        grid.push(this.box(`${NAME_PREFIX}grid-x`, w, GRID_LINE * 0.4, GRID_LINE, [0, slabH + 0.01, z], this.gridMat));
      }
      for (const x of [-w / 4, w / 4]) {
        grid.push(this.box(`${NAME_PREFIX}grid-z`, GRID_LINE, GRID_LINE * 0.4, d, [x, slabH + 0.01, 0], this.gridMat));
      }
      for (let i = 0; i < 4; i++) {
        const layout = editTileLayout("floor", i);
        tiles.push(this.box(`${NAME_PREFIX}tile-${i}`, layout.size[0], layout.size[1], layout.size[2], layout.center, this.resultMat));
      }
      const sel = editTileLayout("floor", 0);
      const selection = this.box(
        `${NAME_PREFIX}selection`,
        sel.size[0] + SELECT_EXTRA,
        sel.size[1] + SELECT_EXTRA,
        sel.size[2] + SELECT_EXTRA,
        [0, 0, 0],
        this.selectMat,
      );
      this.pool = { base, grid, tiles, selection, rampResult: null, rampSelection: null, rampMarker: null, rampTurn: null };
    } else if (buildType === "cone") {
      base = MeshBuilder.CreateCylinder(
        `${NAME_PREFIX}base-piece`,
        { height: h, diameterTop: 0.01, diameterBottom: w, tessellation: 12 },
        this.scene,
      );
      base.parent = root;
      base.position.set(0, h / 2, 0);
      base.material = this.baseMat;
      this.finalizeMesh(base);
      // 2×2 projected base grid: a ground-level cross.
      grid.push(this.box(`${NAME_PREFIX}grid-x`, w, GRID_LINE * 0.4, GRID_LINE, [0, 0.02, 0], this.gridMat));
      grid.push(this.box(`${NAME_PREFIX}grid-z`, GRID_LINE, GRID_LINE * 0.4, d, [0, 0.02, 0], this.gridMat));
      for (let i = 0; i < 4; i++) {
        const layout = editTileLayout("cone", i);
        tiles.push(this.box(`${NAME_PREFIX}tile-${i}`, layout.size[0], layout.size[1], layout.size[2], layout.center, this.resultMat));
      }
      const sel = editTileLayout("cone", 0);
      const selection = this.box(
        `${NAME_PREFIX}selection`,
        sel.size[0] + SELECT_EXTRA,
        sel.size[1] + SELECT_EXTRA,
        sel.size[2] + SELECT_EXTRA,
        [0, 0, 0],
        this.selectMat,
      );
      this.pool = { base, grid, tiles, selection, rampResult: null, rampSelection: null, rampMarker: null, rampTurn: null };
    } else {
      // ramp
      const rampH = h * 0.6; // matches the structure renderer's ramp visual height
      base = this.box(`${NAME_PREFIX}base-piece`, w, rampH, d, [0, rampH / 2, 0], this.baseMat);
      // Projected two-half-cell grid: one divider down the mid-line.
      grid.push(this.box(`${NAME_PREFIX}grid-mid`, GRID_LINE, rampH, GRID_LINE, [0, rampH / 2, 0], this.gridMat));
      const rampResult = this.box(`${NAME_PREFIX}ramp-result`, w, rampH, d * 0.9, [0, rampH / 2, 0], this.resultMat);
      const rampSelection = this.box(`${NAME_PREFIX}ramp-select`, w, rampH, d * 0.9, [0, rampH / 2, 0], this.selectMat);
      const rampMarker = this.box(`${NAME_PREFIX}ramp-highend`, MARKER_SIZE, MARKER_SIZE, d * 0.7, [0, rampH, 0], this.markerMat);
      const rampTurn = this.box(`${NAME_PREFIX}ramp-turn`, MARKER_SIZE, MARKER_SIZE, d * 0.9, [0, rampH, 0], this.markerMat);
      rampTurn.setEnabled(false);
      this.pool = {
        base,
        grid,
        tiles: [],
        selection: null,
        rampResult,
        rampSelection,
        rampMarker,
        rampTurn,
      };
    }
  }

  // ─── Private: applying a geometry ────────────────────────────────────────

  /** Switches result/selection materials between the valid and invalid palette. */
  private applyInvalid(invalid: boolean): void {
    if (invalid === this.lastInvalid) return;
    this.lastInvalid = invalid;
    const result = invalid ? RESULT_INVALID_COLOR : RESULT_VALID_COLOR;
    const select = invalid ? SELECT_INVALID_COLOR : SELECT_VALID_COLOR;
    if (this.resultMat) {
      this.resultMat.diffuseColor = result;
      this.resultMat.emissiveColor = result;
    }
    if (this.selectMat) {
      this.selectMat.diffuseColor = select;
      this.selectMat.emissiveColor = select;
    }
  }

  /** Positions/enables the pooled meshes for one resolved geometry. */
  private applyGeometry(pool: PreviewPool, geometry: EditPreviewGeometry): void {
    if (geometry.ramp === null) {
      this.applyTiles(pool, geometry);
      return;
    }

    // ── Ramp: result span from the canonical variant geometry.
    const ramp = geometry.ramp;
    const layout = editRampLayout(ramp.variant);
    const [w, h] = footprintDims("ramp");
    const rampH = h * 0.6;

    if (pool.rampResult) {
      pool.rampResult.scaling.set(
        layout.resultLength / w,
        1,
        1,
      );
      pool.rampResult.position.set(layout.resultCenter[0], layout.resultCenter[1], layout.resultCenter[2]);
    }
    if (pool.rampSelection) {
      const showSelection = ramp.selectedGeometry !== null;
      pool.rampSelection.setEnabled(showSelection);
      if (showSelection) {
        const selLayout = editRampLayout(ramp.selectedVariant as RampVariant);
        pool.rampSelection.scaling.set(selLayout.resultLength / w, 1, 1);
        pool.rampSelection.position.set(selLayout.resultCenter[0], selLayout.resultCenter[1], selLayout.resultCenter[2]);
      }
    }
    if (pool.rampMarker) {
      pool.rampMarker.position.set(layout.markerX, rampH, 0);
    }
    if (pool.rampTurn) {
      const turnZ = layout.turnZ;
      pool.rampTurn.setEnabled(turnZ !== null);
      if (turnZ !== null) {
        pool.rampTurn.position.set(layout.markerX, rampH, turnZ);
      }
    }
  }

  /** Enables result tiles per solidity + poses the selection highlight. */
  private applyTiles(pool: PreviewPool, geometry: EditPreviewGeometry): void {
    const buildType = geometry.buildType as BuildType;
    for (let i = 0; i < pool.tiles.length; i++) {
      const tile = geometry.tiles[i];
      pool.tiles[i].setEnabled(tile !== undefined && tile.solid);
    }

    const selection = pool.selection;
    if (selection === null) return;
    const selectedTile = geometry.tiles.find((t) => t.selected);
    selection.setEnabled(selectedTile !== undefined);
    if (selectedTile !== undefined) {
      const layout = editTileLayout(buildType, selectedTile.index);
      selection.position.set(layout.center[0], layout.center[1], layout.center[2]);
    }
  }

  // ─── Private: per-frame pulse ────────────────────────────────────────────

  /**
   * Render-observer tick: rewrites only the two pulsing material alphas.
   * No allocation, no mesh work — the pool is static between `show()` calls.
   */
  private tick(): void {
    if (this.disposed || this.root === null || !this.root.isEnabled()) return;
    const now = Date.now();
    const t = (now / 1000) * Math.PI * 2;
    const invalid = this.lastInvalid;

    if (this.resultMat) {
      const base = invalid ? RESULT_INVALID_BASE : RESULT_VALID_BASE;
      const amp = invalid ? RESULT_INVALID_PULSE : RESULT_VALID_PULSE;
      const freq = invalid ? RESULT_INVALID_FREQ : RESULT_VALID_FREQ;
      this.resultMat.alpha = base + amp * Math.sin(t * freq);
    }
    if (this.selectMat) {
      this.selectMat.alpha = SELECT_BASE + SELECT_PULSE * Math.sin(t * SELECT_FREQ);
    }
  }

  // ─── Private: mesh/material helpers ──────────────────────────────────────

  private makeMaterial(name: string, color: Color3, alpha: number): StandardMaterial {
    const mat = new StandardMaterial(name, this.scene);
    mat.diffuseColor = color;
    mat.emissiveColor = color;
    mat.specularColor = new Color3(0, 0, 0);
    mat.alpha = alpha;
    return mat;
  }

  private finalizeMesh(mesh: AbstractMesh): void {
    mesh.isPickable = false;
    mesh.checkCollisions = false;
  }

  private box(
    name: string,
    w: number,
    h: number,
    d: number,
    center: [number, number, number],
    material: StandardMaterial,
  ): AbstractMesh {
    const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
    mesh.parent = this.root;
    mesh.position.set(center[0], center[1], center[2]);
    mesh.material = material;
    this.finalizeMesh(mesh);
    return mesh;
  }

  /** Stable string fingerprint of one input (cheap: tiny field set). */
  private fingerprint(input: EditPreviewInput): string {
    let stateKey: string;
    const state = input.state as { kind: string; tiles?: boolean[]; variant?: string };
    if (state.kind === "ramp") {
      stateKey = `r:${state.variant ?? ""}`;
    } else {
      stateKey = `t:${(state.tiles ?? []).map((b) => (b ? "1" : "0")).join("")}`;
    }
    return [
      input.structureId,
      input.buildType,
      `${input.grid.x},${input.grid.y},${input.grid.z}`,
      input.rotation,
      stateKey,
      input.selectedTile === null ? "-" : String(input.selectedTile),
      input.selectedVariant ?? "-",
    ].join("|");
  }
}
