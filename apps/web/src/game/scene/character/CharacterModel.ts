/**
 * CharacterModel — one GLB-humanoid presentation instance (local or remote
 * player), built from a loaded {@link CharacterAsset}.
 *
 * Transform contract (deliberately identical to `PlayerPresentation` so the
 * runtime can swap one for the other without touching gameplay code):
 *  - `root` is the GAMEPLAY MIRROR: `setTransform(position, yaw)` writes the
 *    predicted/interpolated position to `root.position` and `-yaw` to
 *    `root.rotation.y` (shared yaw convention: 0 faces -Z, positive toward
 *    +X; Babylon's Y rotation is negated, exactly like PlayerPresentation).
 *  - `visualRoot` is the presentation lift: it raises the body by
 *    `PLAYER_COLLIDER_HALF_TOTAL_HEIGHT * crouchScale` and squashes it by
 *    `crouchScale`, so the rendered FEET land exactly on the root position
 *    (the predicted player position) while the body occupies the collider
 *    envelope, and crouching lowers the body about the planted feet.
 *
 * Normalisation (deterministic for a given asset file):
 *  - uniform scale = target height / asset height (default target:
 *    `PLAYER_COLLIDER_TOTAL_HEIGHT`), applied on a dedicated scale node;
 *  - the model is centred on the root axis in X/Z and offset in Y so the
 *    soles of the feet sit at `visualRoot`-local y = -HALF (i.e. on the
 *    root's feet position);
 *  - the model's forward axis is its local -Z (the glTF forward convention,
 *    which the loader preserves); `orientationYawOffset` rotates it about Y
 *    for assets whose forward is elsewhere. Default 0.
 *
 * Material assignment: the instance's cloned materials are tinted with the
 * variant's identity emissive (mint-green local / warm-coral remote) while
 * the asset's original diffuse is preserved. `applyState` reuses the exact
 * eliminated / hit-flash frame-decay contract of `PlayerPresentation`.
 *
 * Ownership / lifecycle:
 *  - The instance is an `instantiateModelsToScene` clone: independent
 *    meshes, cloned materials, and a cloned skeleton — moving or tinting one
 *    instance never affects another.
 *  - `dispose()` is idempotent, releases the instance's meshes, materials,
 *    skeleton, and owned transform nodes, and makes every method a no-op.
 *  - Presentation only: never mutates gameplay state, never picks, never
 *    collides.
 */
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { InstantiatedEntries } from "@babylonjs/core/assetContainer";
import type { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import {
  PLAYER_COLLIDER_HALF_TOTAL_HEIGHT,
  PLAYER_COLLIDER_TOTAL_HEIGHT,
  PLAYER_CROUCH_COLLIDER_HALF_TOTAL_HEIGHT,
} from "@buildshift/game-config";
import type { CharacterAsset } from "./characterAsset";
import { CharacterAssetLoadError } from "./characterAsset";

/** Which side of the match this instance belongs to. */
export type CharacterVariant = "local" | "remote";

/** Optional construction options for a character instance. */
export interface CharacterModelOptions {
  /**
   * Target presented height in metres. Defaults to
   * `PLAYER_COLLIDER_TOTAL_HEIGHT` so the body fills the collider envelope.
   */
  readonly targetHeightMeters?: number;
  /**
   * Extra yaw (radians, about Y, applied to the loaded model before the
   * shared facing) used to bring an asset's own forward axis onto local -Z.
   * Defaults to 0 (the glTF forward convention).
   */
  readonly orientationYawOffset?: number;
}

/** Per-variant material tint (identity marker, matches the presentation palettes). */
const VARIANT_EMISSIVE: Record<CharacterVariant, Color3> = {
  local: new Color3(0.12, 0.45, 0.22),
  remote: new Color3(0.45, 0.16, 0.06),
};

/** Shared neutral eliminated look (both variants). */
const ELIMINATED_DIFFUSE = new Color3(0.16, 0.16, 0.17);
const ELIMINATED_EMISSIVE = new Color3(0, 0, 0);

/** Warm emissive overlay while hit-flash frames remain. */
const FLASH_EMISSIVE = new Color3(0.75, 0.22, 0.05);

export class CharacterModel {
  /**
   * Gameplay-mirror root. Its position IS the (predicted / interpolated /
   * authoritative) player position and its feet; never animated beyond
   * `setTransform`.
   */
  readonly root: TransformNode;
  /** Presentation lift / crouch-squash node (same contract as PlayerPresentation). */
  readonly visualRoot: TransformNode;

  /** Uniform normalisation scale (targetHeight / assetHeight). */
  readonly scale: number;

  private readonly _scene: Scene;
  private readonly _variant: CharacterVariant;
  private readonly _entries: InstantiatedEntries;
  private readonly _modelScale: TransformNode;
  private readonly _modelRoot: TransformNode;
  private readonly _meshes: Mesh[] = [];
  private readonly _materials: Material[] = [];
  /** Original diffuse per material, restored after flash / elimination. */
  private readonly _baseDiffuse: Color3[] = [];
  private crouchScale = 1;
  private _disposed = false;

  private constructor(
    scene: Scene,
    variant: CharacterVariant,
    asset: CharacterAsset,
    namePrefix: string,
    options: CharacterModelOptions,
  ) {
    this._scene = scene;
    this._variant = variant;

    const targetHeight =
      options.targetHeightMeters ?? PLAYER_COLLIDER_TOTAL_HEIGHT;
    this.scale = asset.scaleForHeight(targetHeight);
    const s = this.scale;
    const { min, max } = asset.bounds;

    this.root = new TransformNode(`${namePrefix}-root`, scene);
    this.visualRoot = new TransformNode(`${namePrefix}-visual-root`, scene);
    this.visualRoot.parent = this.root;
    // Dedicated scale node: normalisation scale never mixes with the
    // crouch squash of visualRoot.
    this._modelScale = new TransformNode(`${namePrefix}-model-scale`, scene);
    this._modelScale.parent = this.visualRoot;
    this._modelScale.scaling.set(s, s, s);

    // Independent clone: new meshes, cloned materials, cloned skeleton.
    const sceneMeshesBefore = this._scene.meshes.length;
    this._entries = asset.container.instantiateModelsToScene(
      (sourceName: string) => `${namePrefix}-${sourceName}`,
      true,
    );
    const [modelRoot] = this._entries.rootNodes;
    if (!modelRoot || !(modelRoot instanceof TransformNode)) {
      this._entries.dispose();
      this.root.dispose();
      throw new CharacterAssetLoadError(
        "character asset produced no instantiable model",
      );
    }
    this._modelRoot = modelRoot;

    // Deterministic orientation + feet/centre alignment. NOTE: modelRoot
    // lives under the scaled `_modelScale` node, so its local coordinates
    // are in UNSCALED asset space: centre X/Z on the root axis and offset Y
    // so the scaled feet (asset-space min.y) land at visualRoot-local
    // y = -HALF, i.e. exactly on the root's feet position.
    modelRoot.rotation.y = options.orientationYawOffset ?? 0;
    modelRoot.position.set(
      -(min.x + max.x) / 2 / s,
      -PLAYER_COLLIDER_HALF_TOTAL_HEIGHT / s - min.y,
      -(min.z + max.z) / 2 / s,
    );
    modelRoot.parent = this._modelScale;
    // Presentation safety: only the owned meshes are de-picked / de-collided.
    this._meshes.push(
      ...this._scene.meshes.slice(sceneMeshesBefore).filter((m): m is Mesh => m instanceof Mesh),
    );
    for (const mesh of this._meshes) {
      mesh.isPickable = false;
      mesh.checkCollisions = false;
    }

    this._applyFootLift();

    // Material assignment: collect the instance's own (cloned) materials and
    // remember their original diffuse for state restoration.
    const seen = new Set<Material>();
    for (const mesh of this._meshes) {
      const material = mesh.material;
      if (material && !seen.has(material)) {
        seen.add(material);
        this._materials.push(material);
        this._baseDiffuse.push(this._readDiffuse(material).clone());
      }
    }
    this._applyStateColors(false, false);
  }

  /**
   * Creates one instance of `asset` for `variant` in `scene`.
   * `namePrefix` prefixes every owned node/material name.
   */
  public static async create(
    scene: Scene,
    asset: CharacterAsset,
    variant: CharacterVariant,
    namePrefix: string,
    options: CharacterModelOptions = {},
  ): Promise<CharacterModel> {
    return new CharacterModel(scene, variant, asset, namePrefix, options);
  }

  /** True once {@link dispose} has run. */
  public get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * Moves the body to the predicted / interpolated player position and faces
   * it along the shared movement yaw (identical contract to
   * `PlayerPresentation.setTransform`, including the yaw sign flip).
   */
  public setTransform(
    position: Readonly<{ x: number; y: number; z: number }>,
    yaw: number,
  ): void {
    if (this._disposed) return;
    this.root.position.set(position.x, position.y, position.z);
    this.root.rotation.y = -yaw;
    this._applyFootLift();
  }

  /** Dumb crouch applier (same mapping as `PlayerPresentation.setCrouchBlend`). */
  public setCrouchBlend(blend: number): void {
    if (this._disposed) return;
    const t = blend < 0 ? 0 : blend > 1 ? 1 : blend;
    // Same crouch ratio the procedural presentation uses (collider-derived):
    // the squash is anchored at the feet via _applyFootLift.
    const crouchScaleTarget =
      PLAYER_CROUCH_COLLIDER_HALF_TOTAL_HEIGHT / PLAYER_COLLIDER_HALF_TOTAL_HEIGHT;
    this.crouchScale = 1 - (1 - crouchScaleTarget) * t;
    this._applyFootLift();
  }

  /** Shows or hides the rendered model (the gameplay root keeps its transform). */
  public setEnabled(enabled: boolean): void {
    if (this._disposed) return;
    this._modelRoot.setEnabled(enabled);
  }

  /**
   * Applies the replicated presentation state and returns the remaining
   * hit-flash frame count (same frame-decay contract as PlayerPresentation):
   * eliminated → neutral dark; flash → warm emissive, one frame per call;
   * otherwise → variant base.
   */
  public applyState(wasEliminated: boolean, hitFlashFrames: number): number {
    if (this._disposed) return hitFlashFrames;
    if (!wasEliminated && hitFlashFrames > 0) {
      for (let i = 0; i < this._materials.length; i++) {
        this._writeDiffuse(this._materials[i], this._baseDiffuse[i]);
        this._writeEmissive(this._materials[i], FLASH_EMISSIVE);
      }
      return hitFlashFrames - 1;
    }
    this._applyStateColors(wasEliminated, false);
    return hitFlashFrames;
  }

  /**
   * Idempotent teardown: disposes the instantiated clone (meshes, cloned
   * materials, cloned skeleton) and the owned transform nodes. Safe to call
   * multiple times; afterwards all methods are no-ops.
   */
  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._entries.dispose();
    // The instantiated-entries teardown drops meshes/skeletons but leaves the
    // per-instance cloned materials behind; release them explicitly.
    for (const material of this._materials) {
      material.dispose();
    }
    this.root.dispose();
  }

  // --- internals -----------------------------------------------------------

  /** visualRoot lift + crouch squash about the feet (PlayerPresentation parity). */
  private _applyFootLift(): void {
    this.visualRoot.position.y =
      PLAYER_COLLIDER_HALF_TOTAL_HEIGHT * this.crouchScale;
    this.visualRoot.scaling.y = this.crouchScale;
  }

  private _applyStateColors(wasEliminated: boolean, flash: boolean): void {
    for (let i = 0; i < this._materials.length; i++) {
      if (wasEliminated) {
        this._writeDiffuse(this._materials[i], ELIMINATED_DIFFUSE);
        this._writeEmissive(this._materials[i], ELIMINATED_EMISSIVE);
      } else if (flash) {
        this._writeDiffuse(this._materials[i], this._baseDiffuse[i]);
        this._writeEmissive(this._materials[i], FLASH_EMISSIVE);
      } else {
        this._writeDiffuse(this._materials[i], this._baseDiffuse[i]);
        this._writeEmissive(this._materials[i], VARIANT_EMISSIVE[this._variant]);
      }
    }
  }

  private _readDiffuse(material: Material): Color3 {
    if (material instanceof PBRMaterial) return material.albedoColor;
    if (material instanceof StandardMaterial) return material.diffuseColor;
    return Color3.Black();
  }

  private _writeDiffuse(material: Material, value: Color3): void {
    if (material instanceof PBRMaterial) {
      material.albedoColor.copyFrom(value);
    } else if (material instanceof StandardMaterial) {
      material.diffuseColor.copyFrom(value);
    }
  }

  private _writeEmissive(material: Material, value: Color3): void {
    if (material instanceof PBRMaterial) {
      material.emissiveColor.copyFrom(value);
    } else if (material instanceof StandardMaterial) {
      material.emissiveColor.copyFrom(value);
    }
  }
}
