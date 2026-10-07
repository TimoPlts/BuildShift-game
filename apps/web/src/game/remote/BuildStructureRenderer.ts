/**
 * BuildStructureRenderer — presentation-only Babylon.js mesh manager for
 * server-authoritative multiplayer building.
 *
 * Responsibilities:
 *  - Show a grid-snapped placement preview (semi-transparent ghost mesh) at
 *    a given grid cell, coloured green (valid) or red (invalid).
 *  - Render authoritative structures replicated from the server
 *    (`StructureState` / `BuildingState`) as solid meshes in the scene.
 *  - Tint structure meshes to reflect their authoritative durability
 *    (damage) state, so players can see which builds are weakened.
 *  - Clean up all meshes on dispose.
 *
 * This module is **presentation-only**: it reads from `@buildshift/game-config`
 * (shared grid / structure tuning) and `@buildshift/protocol` (structure state
 * types) to position and size meshes. It never mutates game state, never
 * sends network messages, and never performs client-side authority checks.
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

import type { Scene } from "@babylonjs/core/scene";
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

function rotationToYAxis(rotation: GridRotation): number {
  const steps = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
  return steps[rotation] ?? 0;
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
      mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
      break;
    case "floor":
      mesh = MeshBuilder.CreateBox(name, { width: w, height: 0.2, depth: d }, scene);
      break;
    case "ramp":
      mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
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

  const effectiveHeight = buildType === "floor" ? 0.2 : h;
  mesh.position = new Vector3(
    worldPos.x,
    worldPos.y + effectiveHeight / 2,
    worldPos.z,
  );

  if (rotation !== 0) {
    mesh.rotation.y = rotationToYAxis(rotation);
  }

  return mesh;
}

// ─── Material palette ──────────────────────────────────────────────────────

const SOLID_COLORS: Record<BuildType, Color3> = {
  wall: new Color3(0.45, 0.52, 0.62),
  floor: new Color3(0.55, 0.42, 0.28),
  ramp: new Color3(0.65, 0.55, 0.38),
  cone: new Color3(0.85, 0.65, 0.2),
};

const SOLID_EMISSIVE = new Color3(0.02, 0.02, 0.04);

/** Target diffuse colour for a fully damaged structure (durability ≈ 0). */
const DAMAGED_COLOR = new Color3(0.92, 0.32, 0.12);

/** Target emissive colour for a fully damaged structure. */
const DAMAGED_EMISSIVE = new Color3(0.35, 0.12, 0.03);

const PREVIEW_VALID_COLOR = new Color3(0.2, 0.9, 0.4);
const PREVIEW_INVALID_COLOR = new Color3(0.95, 0.25, 0.2);
const PREVIEW_OPACITY = 0.45;

// ─── BuildStructureRenderer ────────────────────────────────────────────────

/**
 * Presentation-only renderer for building previews and replicated structures.
 *
 * All meshes are owned by this class and disposed on `dispose()`.
 */
export class BuildStructureRenderer {
  private readonly scene: Scene;
  private disposed = false;

  private previewMesh: AbstractMesh | null = null;
  private previewMaterial: StandardMaterial | null = null;
  private previewBuildType: BuildType | null = null;

  private structureMeshes = new Map<string, AbstractMesh>();
  private structureMaterials = new Map<string, StandardMaterial>();
  private structureBuildTypes = new Map<string, BuildType>();
  private structureDurabilities = new Map<string, StructureDurabilityState>();

  constructor(scene: Scene) {
    this.scene = scene;
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
      mat.alpha = PREVIEW_OPACITY;
      mat.diffuseColor = valid ? PREVIEW_VALID_COLOR : PREVIEW_INVALID_COLOR;
      mat.emissiveColor = valid ? PREVIEW_VALID_COLOR : PREVIEW_INVALID_COLOR;
      mat.specularColor = new Color3(0, 0, 0);
      mesh.material = mat;
      this.previewMesh = mesh;
      this.previewMaterial = mat;
      this.previewBuildType = buildType;
    } else {
      const worldPos = gridToWorld(grid);
      const [, h] = getFootprintWorldDims(buildType);
      const effectiveHeight = buildType === "floor" ? 0.2 : h;
      this.previewMesh.position = new Vector3(
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
   * `BuildingState`. Creates new meshes, removes stale ones, and
   * updates positions if needed. Idempotent.
   *
   * When a structure is removed from the `BuildingState` (e.g. it was
   * destroyed by a weapon), its mesh and associated durability data are
   * disposed and removed from this renderer.
   */
  public syncStructures(state: BuildingState): void {
    if (this.disposed) return;

    const currentIds = new Set<string>();

    for (const structure of Object.values(state.structures)) {
      currentIds.add(structure.structureId);
      const existing = this.structureMeshes.get(structure.structureId);

      if (!existing) {
        this.createStructureMesh(structure);
      } else {
        const worldPos = gridToWorld(structure.grid);
        const [, h] = getFootprintWorldDims(structure.buildType);
        const effectiveHeight = structure.buildType === "floor" ? 0.2 : h;
        existing.position = new Vector3(
          worldPos.x,
          worldPos.y + effectiveHeight / 2,
          worldPos.z,
        );
        existing.rotation.y =
          structure.rotation === 0 ? 0 : rotationToYAxis(structure.rotation);
      }
    }

    for (const [id, mesh] of this.structureMeshes) {
      if (!currentIds.has(id)) {
        mesh.dispose();
        this.structureMeshes.delete(id);
        const mat = this.structureMaterials.get(id);
        if (mat) {
          mat.dispose();
          this.structureMaterials.delete(id);
        }
        this.structureBuildTypes.delete(id);
        this.structureDurabilities.delete(id);
      }
    }
  }

  /**
   * Update the durability (damage state) of a single structure, tinting
   * its mesh material to visually reflect the damage.
   *
   * Called by the runtime when a `build:structure_damaged` event is
   * received from the server. The tint lerps from the structure's normal
   * solid colour toward a warm orange-red as durability decreases, and
   * the emissive glow increases to make damaged builds easy to spot.
   *
   * If the structure is not currently rendered (e.g. the durability event
   * arrived before the structure mesh was created), the durability value
   * is stored and will be applied the next time the structure mesh is
   * created via {@link syncStructures}.
   *
   * @param structureId  The `structureId` of the affected structure.
   * @param durability   The authoritative durability state for this structure.
   */
  public updateStructureDurability(
    structureId: string,
    durability: StructureDurabilityState,
  ): void {
    if (this.disposed) return;

    this.structureDurabilities.set(structureId, durability);
    this.applyDurabilityTint(structureId, durability);
  }

  /**
   * Dispose all owned meshes and materials.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposePreview();
    for (const mesh of this.structureMeshes.values()) {
      mesh.dispose();
    }
    for (const mat of this.structureMaterials.values()) {
      mat.dispose();
    }
    this.structureMeshes.clear();
    this.structureMaterials.clear();
    this.structureBuildTypes.clear();
    this.structureDurabilities.clear();
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private createStructureMesh(structure: StructureState): void {
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
    mat.diffuseColor =
      SOLID_COLORS[structure.buildType] ?? new Color3(0.5, 0.5, 0.5);
    mat.emissiveColor = SOLID_EMISSIVE;
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    mesh.material = mat;
    this.structureMeshes.set(structure.structureId, mesh);
    this.structureMaterials.set(structure.structureId, mat);
    this.structureBuildTypes.set(structure.structureId, structure.buildType);

    // If a durability value was already stored for this structure (e.g. the
    // damage event arrived before the mesh was created), apply the tint now.
    const dur = this.structureDurabilities.get(structure.structureId);
    if (dur) {
      this.applyDurabilityTint(structure.structureId, dur);
    }
  }

  /**
   * Apply a durability-based tint to a structure's material.
   *
   * The tint lerps the diffuse colour from the structure's undamaged solid
   * colour toward DAMAGED_COLOR and the emissive from SOLID_EMISSIVE toward
   * DAMAGED_EMISSIVE, with the interpolation factor driven by the damage
   * fraction `(1 - currentDurability / maxDurability)`.
   */
  private applyDurabilityTint(
    structureId: string,
    durability: StructureDurabilityState,
  ): void {
    const mat = this.structureMaterials.get(structureId);
    const buildType = this.structureBuildTypes.get(structureId);
    if (!mat || !buildType) return;

    const baseColor = SOLID_COLORS[buildType] ?? new Color3(0.5, 0.5, 0.5);
    const maxDur = Math.max(1, durability.maxDurability);
    const fraction = Math.max(0, Math.min(1, durability.currentDurability / maxDur));
    const damage = 1 - fraction;

    mat.diffuseColor = lerpColor(baseColor, DAMAGED_COLOR, damage);
    mat.emissiveColor = lerpColor(SOLID_EMISSIVE, DAMAGED_EMISSIVE, damage);
  }
}
