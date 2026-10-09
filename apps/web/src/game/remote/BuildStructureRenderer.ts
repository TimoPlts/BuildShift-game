/**
 * BuildStructureRenderer — presentation-only Babylon.js mesh manager for
 * server-authoritative multiplayer building.
 *
 * Responsibilities:
 *  - Show a grid-snapped placement preview (semi-transparent ghost mesh) at
 *    a given grid cell, coloured green (valid) or red (invalid) with a subtle
 *    pulsing opacity for readability.
 *  - Render authoritative structures replicated from the server
 *    (`StructureState` / `BuildingState`) as solid meshes in the scene.
 *  - Play a short construction pop-in animation when a structure first appears.
 *  - Tint structure meshes to reflect their authoritative durability
 *    (damage) state using a non-linear curve, with a brief white+emissive
 *    flash on each hit and a deterministic warning pulse when nearly broken.
 *  - Play a destruction impact flash and fade-out when a structure is
 *    authoritatively removed.
 *  - Smoothly transition half-wall edit shapes.
 *  - Highlight the structure currently aimed for a build edit, and show a
 *    semi-transparent half-wall result preview before the edit is confirmed.
 *  - Clean up all meshes on dispose.
 *
 * This module is **presentation-only**: it reads from `@buildshift/game-config`
 * (shared grid / structure tuning) and `@buildshift/protocol` (structure state
 * types) to position and size meshes. It never mutates game state, never
 * sends network messages, and never performs client-side authority checks.
 *
 * Visuals derive exclusively from the canonical replicated structure state
 * and the public renderer API. Temporary Babylon resources are reused and
 * cleaned up via the scene render observer lifecycle.
 *
 * Usage:
 * ```ts
 * const renderer = new BuildStructureRenderer(scene);
 * renderer.showPreview("wall", { x: 3, y: 0, z: 2 }, 1, true);
 * renderer.syncStructures(buildingState);
 * renderer.updateStructureDurability("abc-123", { maxDurability: 200, currentDurability: 150 });
 * // ...
 * renderer.dispose();
 * ```
 */

import type { Scene, Observer } from "@babylonjs/core";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BUILD_GRID, getStructureConfig } from "@buildshift/game-config";
import type {
  BuildType,
  GridPosition,
  GridRotation,
  StructureState,
  BuildingState,
  StructureDurabilityState,
} from "@buildshift/protocol";
import {
  createConstructionEffects,
  createDestructionEffects,
  startEditTransition,
  triggerHitFlash,
  composeVisualInto,
  createComposedVisual,
  NEARLY_BROKEN_THRESHOLD,
  WARNING_PULSE_FREQ,
  WARNING_PULSE_STRENGTH,
  type StructureEffects,
} from "./buildPresentation/structureEffects";

// ─── Grid → World conversion ───────────────────────────────────────────────

function gridToWorld(grid: GridPosition): Vector3 {
  return new Vector3(
    grid.x * BUILD_GRID.cellSize,
    grid.y * BUILD_GRID.layerHeight,
    grid.z * BUILD_GRID.cellSize,
  );
}

function getFootprintWorldDims(buildType: BuildType): [number, number, number] {
  const config = getStructureConfig(buildType);
  if (!config) {
    return [BUILD_GRID.cellSize, BUILD_GRID.layerHeight, BUILD_GRID.cellSize];
  }
  const [fx, fy, fz] = config.footprint;
  return [
    fx * BUILD_GRID.cellSize,
    fy * BUILD_GRID.layerHeight,
    fz * BUILD_GRID.cellSize,
  ];
}

/** Compute the effective rendered height for a build type (used for Y-centering). */
function getEffectiveHeight(buildType: BuildType): number {
  const [, h] = getFootprintWorldDims(buildType);
  if (buildType === "floor") return 0.15;
  if (buildType === "ramp") return h * 0.6;
  return h;
}

function rotationToYAxis(rotation: GridRotation): number {
  const steps = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
  return steps[rotation] ?? 0;
}

/**
 * Centre offset (metres) for a half-wall edit pose: a quarter of the
 * structure's full world height, so the scaled half sits exactly in the top
 * or bottom half of the structure's volume. Walls are 2 layers tall, so
 * this equals `layerHeight / 2`.
 */
function halfWallPoseOffset(buildType: BuildType): number {
  return getFootprintWorldDims(buildType)[1] / 4;
}

// ─── Color lerp helper ─────────────────────────────────────────────────────

function lerpColor(a: Color3, b: Color3, t: number): Color3 {
  const ct = Math.max(0, Math.min(1, t));
  return new Color3(
    a.r + (b.r - a.r) * ct,
    a.g + (b.g - a.g) * ct,
    a.b + (b.b - a.b) * ct,
  );
}

// ─── Mesh factory per build type ───────────────────────────────────────────

/**
 * Create a structure mesh with improved silhouettes:
 *  - wall: a thin panel (reduced depth) for visual distinction from solid blocks
 *  - floor: a thin slab
 *  - ramp: a reduced-height box suggesting an incline
 *  - cone: a pointed cone (cylinder with near-zero top diameter)
 */
function createStructureMesh(
  scene: Scene,
  name: string,
  buildType: BuildType,
  grid: GridPosition,
  rotation: GridRotation,
): AbstractMesh {
  const worldPos = gridToWorld(grid);
  const [w, h, d] = getFootprintWorldDims(buildType);
  let mesh: AbstractMesh;

  switch (buildType) {
    case "wall":
      // Thin panel: 15% of cell depth to read as a wall, not a block.
      mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d * 0.15 }, scene);
      break;
    case "floor":
      // Thin slab at the base of the cell.
      mesh = MeshBuilder.CreateBox(name, { width: w, height: 0.15, depth: d }, scene);
      break;
    case "ramp":
      // Reduced-height box suggesting an incline across the footprint.
      mesh = MeshBuilder.CreateBox(name, { width: w, height: h * 0.6, depth: d }, scene);
      break;
    case "cone":
      mesh = MeshBuilder.CreateCylinder(name, {
        height: h,
        diameterTop: 0.01,
        diameterBottom: w,
        tessellation: 12,
      }, scene);
      break;
    default:
      mesh = MeshBuilder.CreateBox(name, { width: 1, height: 1, depth: 1 }, scene);
  }

  const effectiveHeight = getEffectiveHeight(buildType);
  mesh.position = new Vector3(
    worldPos.x,
    worldPos.y + effectiveHeight / 2,
    worldPos.z,
  );

  if (rotation !== 0) {
    mesh.rotation.y = rotationToYAxis(rotation);
  }
  mesh.isPickable = false;
  mesh.checkCollisions = false;

  return mesh;
}

// ─── Material palette ──────────────────────────────────────────────────────

const SOLID_COLORS: Record<BuildType, Color3> = {
  wall: new Color3(0.42, 0.50, 0.60),
  floor: new Color3(0.55, 0.42, 0.28),
  ramp: new Color3(0.68, 0.56, 0.35),
  cone: new Color3(0.85, 0.65, 0.2),
};

const SOLID_EMISSIVE = new Color3(0.02, 0.02, 0.04);

/** Target diffuse colour for a fully damaged structure (durability ≈ 0). */
const DAMAGED_COLOR = new Color3(0.92, 0.32, 0.12);

/** Target emissive colour for a fully damaged structure. */
const DAMAGED_EMISSIVE = new Color3(0.35, 0.12, 0.03);

const PREVIEW_VALID_COLOR = new Color3(0.2, 0.9, 0.4);
const PREVIEW_INVALID_COLOR = new Color3(0.95, 0.25, 0.2);
const PREVIEW_OPACITY_BASE = 0.4;
const PREVIEW_OPACITY_PULSE = 0.1;
/** Pulse frequency: cycles per second. */
const PREVIEW_PULSE_FREQ = 2.5;

/** Emissive boost (RGB) applied while a structure is the aimed build-edit target. */
const EDIT_TARGET_EMISSIVE_BOOST = [0.18, 0.38, 0.22] as const;

/** Ghost colour for the half-wall result preview (pre-confirmation). */
const EDIT_PREVIEW_COLOR = new Color3(0.3, 0.95, 0.6);
/** Opacity of the half-wall result preview ghost. */
const EDIT_PREVIEW_OPACITY = 0.45;

// ─── Per-structure runtime state ───────────────────────────────────────────

interface StructureRuntime {
  mesh: AbstractMesh;
  material: StandardMaterial;
  buildType: BuildType;
  effects: StructureEffects;
  /** The target edit pose (scaleY, yOffset) for the current edit state. */
  targetScaleY: number;
  targetYOffset: number;
  /** The authoritative grid position (for tick position computation). */
  grid: GridPosition;
  /** Current durability (null if no damage event received yet). */
  durability: StructureDurabilityState | null;
  /** Previous durability value to detect hits. */
  prevDurability: number;
  /** Base diffuse color (durability-tinted, before hit-flash boost). */
  baseDiffuse: Color3;
  /** True when the material/mesh needs one more tick after a state change. */
  dirty: boolean;
}

/**
 * Fingerprint of one synced structure — enough to detect an unchanged
 * authoritative state without copying any per-frame objects.
 */
interface StructureFingerprint {
  buildType: BuildType;
  x: number;
  y: number;
  z: number;
  rotation: GridRotation;
  editType: string | undefined;
}

// ─── BuildStructureRenderer ────────────────────────────────────────────────

/**
 * Presentation-only renderer for building previews and replicated structures.
 *
 * All meshes are owned by this class and disposed on `dispose()`.
 * A scene render observer drives per-frame animation updates.
 */
export class BuildStructureRenderer {
  private readonly scene: Scene;
  private disposed = false;

  private previewMesh: AbstractMesh | null = null;
  private previewMaterial: StandardMaterial | null = null;
  private previewBuildType: BuildType | null = null;

  /** The structure currently aimed for a build edit (emissive highlight). */
  private editTargetId: string | null = null;
  private editPreviewMesh: AbstractMesh | null = null;
  private editPreviewMaterial: StandardMaterial | null = null;
  /** The structure the half-wall result preview is shown for (self-cleanup). */
  private editPreviewStructureId: string | null = null;

  private structures = new Map<string, StructureRuntime>();

  /** Structures awaiting destruction animation completion before mesh disposal. */
  private pendingDestruction = new Map<string, { mesh: AbstractMesh; material: StandardMaterial; effects: StructureEffects; scaleY: number; baseEmissive: Color3 }>();

  /**
   * Fingerprint of the last synced state (keyed by structureId). Lets the
   * per-frame `syncStructures` call take an allocation-free fast path when
   * the authoritative state has not changed.
   */
  private readonly _fingerprints = new Map<string, StructureFingerprint>();
  /** Reusable composition buffer for the per-frame tick (no per-frame allocation). */
  private readonly _composed = createComposedVisual();
  /** Reusable emissive scratch color for the per-frame tick. */
  private readonly _tempEmissive = new Color3(0, 0, 0);
  /** Previous frame's edit-target id (for detecting edit-target changes). */
  private _prevEditTargetId: string | null = null;

  private readonly _observer: Observer<Scene>;

  constructor(scene: Scene) {
    this.scene = scene;
    this._observer = scene.onBeforeRenderObservable.add(() => this._tick());
  }

  /**
   * Show (or reposition) the grid-snapped placement preview.
   */
  public showPreview(
    buildType: BuildType,
    grid: GridPosition,
    rotation: GridRotation,
    valid: boolean,
  ): void {
    if (this.disposed) return;

    if (this.previewMesh && this.previewBuildType !== buildType) {
      this.disposePreview();
    }

    if (!this.previewMesh) {
      const mesh = createStructureMesh(
        this.scene,
        "build-preview",
        buildType,
        grid,
        rotation,
      );
      const mat = new StandardMaterial("build-preview-material", this.scene);
      mat.alpha = PREVIEW_OPACITY_BASE;
      mat.diffuseColor = valid ? PREVIEW_VALID_COLOR : PREVIEW_INVALID_COLOR;
      mat.emissiveColor = valid ? PREVIEW_VALID_COLOR : PREVIEW_INVALID_COLOR;
      mat.specularColor = new Color3(0, 0, 0);
      mesh.material = mat;
      this.previewMesh = mesh;
      this.previewMaterial = mat;
      this.previewBuildType = buildType;
    } else {
      const worldPos = gridToWorld(grid);
      const effectiveHeight = getEffectiveHeight(buildType);
      this.previewMesh.position.set(
        worldPos.x,
        worldPos.y + effectiveHeight / 2,
        worldPos.z,
      );
      this.previewMesh.rotation.y =
        rotation === 0 ? 0 : rotationToYAxis(rotation);

      if (this.previewMaterial) {
        const c = valid ? PREVIEW_VALID_COLOR : PREVIEW_INVALID_COLOR;
        this.previewMaterial.diffuseColor = c;
        this.previewMaterial.emissiveColor = c;
      }
    }
  }

  /** Hide the placement preview. */
  public hidePreview(): void {
    this.disposePreview();
  }

  /**
   * Highlight the structure currently aimed for a build edit (a subtle
   * green emissive boost on its existing mesh). Idempotent — the same id
   * keeps the highlight; the boost is recomposed every frame.
   */
  public showEditTarget(structureId: string): void {
    if (this.disposed) return;
    this.editTargetId = structureId;
  }

  /** Remove the build-edit target highlight. */
  public hideEditTarget(): void {
    this.editTargetId = null;
  }

  /**
   * Show a semi-transparent ghost of the half-wall *result* shape (the top
   * or bottom half of the wall) at the target's position — the shape the
   * structure will have once the edit is accepted. Walls only: the renderer
   * models half-wall results for walls, so the preview is hidden for other
   * build types.
   */
  public showEditResultPreview(
    structureId: string,
    pose: "half_top" | "half_bottom",
    rotation: GridRotation,
  ): void {
    if (this.disposed) return;
    const runtime = this.structures.get(structureId);
    if (!runtime || runtime.buildType !== "wall") {
      this.disposeEditPreview();
      return;
    }
    const [w, h, d] = getFootprintWorldDims(runtime.buildType);
    if (!this.editPreviewMesh || !this.editPreviewMaterial) {
      const mesh = MeshBuilder.CreateBox("build-edit-result-preview", {
        width: w,
        height: h / 2,
        depth: d * 0.15,
      }, this.scene);
      const mat = new StandardMaterial(
        "build-edit-result-preview-material",
        this.scene,
      );
      mat.diffuseColor = EDIT_PREVIEW_COLOR;
      mat.emissiveColor = EDIT_PREVIEW_COLOR;
      mat.specularColor = new Color3(0, 0, 0);
      mat.alpha = EDIT_PREVIEW_OPACITY;
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      this.editPreviewMesh = mesh;
      this.editPreviewMaterial = mat;
    }
    const worldPos = gridToWorld(runtime.grid);
    const offset = pose === "half_top" ? h / 4 : -h / 4;
    this.editPreviewMesh.position.set(
      worldPos.x,
      worldPos.y + h / 2 + offset,
      worldPos.z,
    );
    this.editPreviewMesh.rotation.y =
      rotation === 0 ? 0 : rotationToYAxis(rotation);
    this.editPreviewStructureId = structureId;
  }

  /** Hide the half-wall result preview. */
  public hideEditResultPreview(): void {
    this.disposeEditPreview();
  }

  private disposeEditPreview(): void {
    if (this.editPreviewMesh) {
      this.editPreviewMesh.dispose();
      this.editPreviewMesh = null;
    }
    if (this.editPreviewMaterial) {
      this.editPreviewMaterial.dispose();
      this.editPreviewMaterial = null;
    }
    this.editPreviewStructureId = null;
  }

  private disposePreview(): void {
    if (this.previewMesh) {
      this.previewMesh.dispose();
      this.previewMesh = null;
    }
    if (this.previewMaterial) {
      this.previewMaterial.dispose();
      this.previewMaterial = null;
    }
    this.previewBuildType = null;
  }

  /**
   * Synchronize scene structure meshes with the authoritative
   * `BuildingState`. Creates new meshes (with construction animation),
   * removes stale ones (with destruction animation), and updates positions
   * and edit shapes if needed. Idempotent.
   */
  public syncStructures(state: BuildingState): void {
    if (this.disposed) return;

    // Fast path: the per-frame sync call is usually unchanged state. Compare
    // the incoming structures against the last fingerprint (no allocation) —
    // identical id set + identical poses means no mesh work at all.
    let identical = true;
    let count = 0;
    for (const key in state.structures) {
      const s = state.structures[key];
      count += 1;
      if (identical) {
        const fp = this._fingerprints.get(s.structureId);
        if (
          fp === undefined ||
          fp.buildType !== s.buildType ||
          fp.x !== s.grid.x ||
          fp.y !== s.grid.y ||
          fp.z !== s.grid.z ||
          fp.rotation !== s.rotation ||
          fp.editType !== s.editType
        ) {
          identical = false;
        }
      }
    }
    if (identical && count === this._fingerprints.size) {
      return;
    }

    const now = Date.now();
    const currentIds = new Set<string>();

    for (const structure of Object.values(state.structures)) {
      currentIds.add(structure.structureId);
      const existing = this.structures.get(structure.structureId);

      if (!existing) {
        this.createStructure(structure, now);
      } else {
        this.updateStructure(existing, structure, now);
      }
    }

    // Detect removed structures → start destruction animation
    for (const [id, runtime] of this.structures) {
      if (!currentIds.has(id)) {
        this.startDestruction(id, runtime, now);
      }
    }

    // Self-clean build-edit presentation for vanished structures.
    if (this.editTargetId !== null && !currentIds.has(this.editTargetId)) {
      this.editTargetId = null;
    }
    if (
      this.editPreviewStructureId !== null &&
      !currentIds.has(this.editPreviewStructureId)
    ) {
      this.disposeEditPreview();
    }

    // Refresh the no-change fast path cache (mirrors `this.structures`).
    this._fingerprints.clear();
    for (const structure of Object.values(state.structures)) {
      this._fingerprints.set(structure.structureId, {
        buildType: structure.buildType,
        x: structure.grid.x,
        y: structure.grid.y,
        z: structure.grid.z,
        rotation: structure.rotation,
        editType: structure.editType,
      });
    }
  }

  /**
   * Update the durability (damage state) of a single structure, tinting
   * its mesh material to visually reflect the damage. Triggers a hit flash
   * when durability decreases.
   */
  public updateStructureDurability(
    structureId: string,
    durability: StructureDurabilityState,
  ): void {
    if (this.disposed) return;

    const runtime = this.structures.get(structureId);
    if (!runtime) return;

    // The per-frame caller re-applies the mirrored durability every frame;
    // when nothing changed there is no tint or flash work to do.
    const last = runtime.durability;
    if (
      last !== null &&
      last.currentDurability === durability.currentDurability &&
      last.maxDurability === durability.maxDurability
    ) {
      return;
    }

    // Detect hit: durability decreased from a positive value
    if (runtime.prevDurability > 0 && durability.currentDurability < runtime.prevDurability) {
      triggerHitFlash(runtime.effects, Date.now());
    }

    runtime.prevDurability = durability.currentDurability;
    runtime.durability = durability;
    runtime.dirty = true;
    this.applyDurabilityTint(runtime);
  }

  /**
   * Dispose all owned meshes and materials.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.scene.onBeforeRenderObservable.remove(this._observer);
    this.disposePreview();
    this.disposeEditPreview();
    this.editTargetId = null;

    for (const runtime of this.structures.values()) {
      runtime.mesh.dispose();
      runtime.material.dispose();
    }
    this.structures.clear();
    this._fingerprints.clear();

    for (const pending of this.pendingDestruction.values()) {
      pending.mesh.dispose();
      pending.material.dispose();
    }
    this.pendingDestruction.clear();
  }

  // ─── Private: structure lifecycle ────────────────────────────────────────

  private createStructure(structure: StructureState, now: number): void {
    const mesh = createStructureMesh(
      this.scene,
      `structure-${structure.structureId}`,
      structure.buildType,
      structure.grid,
      structure.rotation,
    );
    const mat = new StandardMaterial(
      `structure-material-${structure.structureId}`,
      this.scene,
    );
    // Clone the shared constants: the per-frame tick mutates the material's
    // diffuse/emissive colors in place, so every structure needs its own
    // Color3 instances (aliasing SOLID_COLORS/SOLID_EMISSIVE would corrupt
    // the module constants and every other structure's material).
    const solidColor = SOLID_COLORS[structure.buildType] ?? new Color3(0.5, 0.5, 0.5);
    mat.diffuseColor = solidColor.clone();
    mat.emissiveColor = SOLID_EMISSIVE.clone();
    mat.specularColor = new Color3(0.15, 0.15, 0.15);
    mesh.material = mat;

    const effects = createConstructionEffects(now);

    // Compute initial edit pose
    let targetScaleY = 1;
    let targetYOffset = 0;
    if (structure.buildType === "wall") {
      if (structure.editType === "half_top") {
        targetScaleY = 0.5;
        targetYOffset = halfWallPoseOffset("wall");
      } else if (structure.editType === "half_bottom") {
        targetScaleY = 0.5;
        targetYOffset = -halfWallPoseOffset("wall");
      }
    }

    const baseColor = SOLID_COLORS[structure.buildType] ?? new Color3(0.5, 0.5, 0.5);
    const runtime: StructureRuntime = {
      mesh,
      material: mat,
      buildType: structure.buildType,
      effects,
      targetScaleY,
      targetYOffset,
      grid: { ...structure.grid },
      durability: null,
      prevDurability: 0,
      baseDiffuse: baseColor.clone(),
      dirty: true,
    };

    this.structures.set(structure.structureId, runtime);
  }

  private updateStructure(runtime: StructureRuntime, structure: StructureState, now: number): void {
    // Update grid position (may have moved) — written in place (the runtime
    // owns its grid object; the protocol state is re-read fresh each sync).
    const grid = runtime.grid;
    const incoming = structure.grid;
    const gridChanged = grid.x !== incoming.x || grid.y !== incoming.y || grid.z !== incoming.z;
    grid.x = incoming.x;
    grid.y = incoming.y;
    grid.z = incoming.z;
    if (gridChanged) {
      runtime.dirty = true;
    }

    // Compute the target edit pose
    let targetScaleY = 1;
    let targetYOffset = 0;
    if (structure.buildType === "wall") {
      if (structure.editType === "half_top") {
        targetScaleY = 0.5;
        targetYOffset = halfWallPoseOffset("wall");
      } else if (structure.editType === "half_bottom") {
        targetScaleY = 0.5;
        targetYOffset = -halfWallPoseOffset("wall");
      }
    }

    // If the edit pose changed, start a smooth transition
    if (targetScaleY !== runtime.targetScaleY || targetYOffset !== runtime.targetYOffset) {
      startEditTransition(
        runtime.effects,
        // The "from" is the current target (where we're visually at or transitioning to)
        runtime.targetScaleY,
        runtime.targetYOffset,
        targetScaleY,
        targetYOffset,
        now,
      );
      runtime.targetScaleY = targetScaleY;
      runtime.targetYOffset = targetYOffset;
    }
  }

  private startDestruction(id: string, runtime: StructureRuntime, now: number): void {
    const effects = createDestructionEffects(now);
    // Persist the base emissive for the pending-destruction tick (one
    // allocation per destruction event, not per frame).
    const baseEmissive = this._computeBaseEmissive(runtime, now, this._tempEmissive).clone();
    this.pendingDestruction.set(id, {
      mesh: runtime.mesh,
      material: runtime.material,
      effects,
      scaleY: runtime.targetScaleY,
      baseEmissive,
    });
    // Reset diffuse to base (clear any active hit-flash boost)
    runtime.material.diffuseColor = runtime.baseDiffuse.clone();
    this.structures.delete(id);
  }

  // ─── Private: durability tint ────────────────────────────────────────────

  /**
   * Apply a durability-based diffuse tint to a structure's material.
   * Emissive is computed per-frame in _tick to allow hit flash overlay.
   */
  private applyDurabilityTint(runtime: StructureRuntime): void {
    const durability = runtime.durability;
    if (!durability) return;

    const baseColor = SOLID_COLORS[runtime.buildType] ?? new Color3(0.5, 0.5, 0.5);
    const maxDur = Math.max(1, durability.maxDurability);
    const fraction = Math.max(0, Math.min(1, durability.currentDurability / maxDur));
    const damage = 1 - fraction;
    // Non-linear tint: subtle at high durability, aggressive at low durability
    const tintAmount = Math.pow(damage, 1.5);
    runtime.baseDiffuse = lerpColor(baseColor, DAMAGED_COLOR, tintAmount);
  }

  // ─── Private: per-frame tick ─────────────────────────────────────────────

  /**
   * Called every frame by the scene render observer.
   * Advances all animations and applies composed visuals to meshes.
   */
  private _tick(): void {
    if (this.disposed) return;
    const now = Date.now();
    const prevEditTarget = this._prevEditTargetId;
    const curEditTarget = this.editTargetId;

    // Update structure meshes — skip static structures (no active effects,
    // no warning pulse, no pending state change) to avoid redundant writes.
    for (const [id, runtime] of this.structures) {
      const isEditTargeted = id === curEditTarget;
      const editTargetChanged = isEditTargeted !== (id === prevEditTarget);
      const static_ = this._isStatic(runtime);

      if (!editTargetChanged && !runtime.dirty && static_) {
        continue;
      }

      this._applyRuntimeVisual(runtime, now, isEditTargeted);

      if (static_) {
        runtime.dirty = false;
      }
    }
    this._prevEditTargetId = curEditTarget;

    // Update pending destruction meshes
    const toRemove: string[] = [];
    for (const [id, pending] of this.pendingDestruction) {
      const { shouldRemove } = composeVisualInto(
        pending.effects,
        1,
        0,
        now,
        this._composed,
      );
      const visual = this._composed;
      pending.mesh.scaling.set(
        visual.uniformScale,
        visual.uniformScale * pending.scaleY,
        visual.uniformScale,
      );
      pending.material.alpha = visual.alpha;
      // Write the boost into the existing material color (no allocation).
      const emissive = pending.material.emissiveColor;
      emissive.copyFrom(pending.baseEmissive);
      emissive.r += visual.emissiveBoost[0];
      emissive.g += visual.emissiveBoost[1];
      emissive.b += visual.emissiveBoost[2];
      if (shouldRemove) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      const pending = this.pendingDestruction.get(id)!;
      pending.mesh.dispose();
      pending.material.dispose();
      this.pendingDestruction.delete(id);
    }

    // Update preview pulsing
    if (this.previewMesh && this.previewMaterial) {
      const pulse = Math.sin((now / 1000) * PREVIEW_PULSE_FREQ * Math.PI * 2);
      this.previewMaterial.alpha = PREVIEW_OPACITY_BASE + PREVIEW_OPACITY_PULSE * pulse;
    }
  }

  private _applyRuntimeVisual(
    runtime: StructureRuntime,
    now: number,
    isEditTargeted: boolean,
  ): void {
    composeVisualInto(
      runtime.effects,
      runtime.targetScaleY,
      runtime.targetYOffset,
      now,
      this._composed,
    );
    const visual = this._composed;

    // Compose scaling: uniform * (1, scaleY, 1)
    runtime.mesh.scaling.set(
      visual.uniformScale,
      visual.uniformScale * visual.scaleY,
      visual.uniformScale,
    );

    // Position: base world position + yOffset (half-wall shift), written
    // in place (the cached grid is the single source; no per-frame vector).
    const grid = runtime.grid;
    runtime.mesh.position.set(
      grid.x * BUILD_GRID.cellSize,
      grid.y * BUILD_GRID.layerHeight +
        getEffectiveHeight(runtime.buildType) / 2 +
        visual.yOffset,
      grid.z * BUILD_GRID.cellSize,
    );

    // Alpha (for destruction fade — though destruction is in pendingDestruction)
    runtime.material.alpha = visual.alpha;

    // Diffuse: base (durability-tinted) + hit-flash white-shift, written in
    // place so no per-frame Color3 is allocated.
    const d = visual.diffuseBoost;
    const diffuse = runtime.material.diffuseColor;
    diffuse.copyFrom(runtime.baseDiffuse);
    diffuse.r += d[0];
    diffuse.g += d[1];
    diffuse.b += d[2];

    // Emissive: base (incl. warning pulse) + transient boost + build-edit
    // target boost, written in place.
    const baseEmissive = this._computeBaseEmissive(runtime, now, this._tempEmissive);
    const e = visual.emissiveBoost;
    const emissive = runtime.material.emissiveColor;
    emissive.copyFrom(baseEmissive);
    emissive.r += e[0] + (isEditTargeted ? EDIT_TARGET_EMISSIVE_BOOST[0] : 0);
    emissive.g += e[1] + (isEditTargeted ? EDIT_TARGET_EMISSIVE_BOOST[1] : 0);
    emissive.b += e[2] + (isEditTargeted ? EDIT_TARGET_EMISSIVE_BOOST[2] : 0);
  }

  /**
   * Returns true when the structure needs no per-frame work: all transient
   * effects are complete and the durability is above the warning-pulse
   * threshold (or absent).
   */
  private _isStatic(runtime: StructureRuntime): boolean {
    const e = runtime.effects;
    if (e.construction && !e.construction.done) return false;
    if (e.hitFlash && !e.hitFlash.done) return false;
    if (e.editTransition && !e.editTransition.done) return false;
    if (runtime.durability) {
      const maxDur = Math.max(1, runtime.durability.maxDurability);
      const fraction = runtime.durability.currentDurability / maxDur;
      if (fraction <= NEARLY_BROKEN_THRESHOLD) return false;
    }
    return true;
  }

  private _computeBaseEmissive(
    runtime: StructureRuntime,
    now: number,
    out: Color3,
  ): Color3 {
    const durability = runtime.durability;
    if (!durability) {
      out.copyFrom(SOLID_EMISSIVE);
      return out;
    }
    const maxDur = Math.max(1, durability.maxDurability);
    const fraction = Math.max(0, Math.min(1, durability.currentDurability / maxDur));
    const damage = 1 - fraction;
    const tintAmount = Math.pow(damage, 1.5);
    // Lerp into `out` in place (no allocation).
    out.copyFrom(SOLID_EMISSIVE);
    out.r += (DAMAGED_EMISSIVE.r - SOLID_EMISSIVE.r) * tintAmount;
    out.g += (DAMAGED_EMISSIVE.g - SOLID_EMISSIVE.g) * tintAmount;
    out.b += (DAMAGED_EMISSIVE.b - SOLID_EMISSIVE.b) * tintAmount;

    // Warning pulse for nearly-broken structures (deterministic, time-based)
    if (fraction <= NEARLY_BROKEN_THRESHOLD) {
      const severity = (NEARLY_BROKEN_THRESHOLD - fraction) / NEARLY_BROKEN_THRESHOLD;
      const pulse = 0.5 + 0.5 * Math.sin((now / 1000) * WARNING_PULSE_FREQ * Math.PI * 2);
      const w = severity * pulse * WARNING_PULSE_STRENGTH;
      out.r += w;
      out.g += w * 0.4;
    }

    return out;
  }
}
