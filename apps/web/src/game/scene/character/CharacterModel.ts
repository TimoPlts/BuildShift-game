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
 *  - `visualRoot` is the feet-alignment lift. The Quaternius rig crouches
 *    through authored skeletal clips, not a second non-uniform squash.
 *    Unknown rigs retain the legacy feet-anchored squash fallback.
 *  - Original idle/run/jump/fall/crouch groups are instance-owned and fed
 *    every scene animation frame by the existing CharacterAnimationDriver,
 *    from the same predicted/interpolated root position used for rendering.
 *
 * Normalisation (deterministic for a given asset file):
 *  - uniform scale = target height / asset height (default target:
 *    `PLAYER_COLLIDER_TOTAL_HEIGHT`), applied on a dedicated scale node;
 *  - the model is centred on the root axis in X/Z and offset in Y so the
 *    soles of the feet sit at `visualRoot`-local y = -HALF (i.e. on the
 *    root's feet position);
 *  - the model node's rotation is written through `rotationQuaternion` (the
 *    glTF importer represents node rotations as quaternions, so a plain
 *    `rotation.y` write would be silently ignored) and the X/Z centring is
 *    expressed in the rotated frame, keeping a turned rig on the root axis;
 *  - the presented forward is the model's local -Z (the shared BuildShift
 *    convention). Assets whose ANATOMICAL front sits elsewhere carry a
 *    measured `orientationYawOffset` — the shipped default rig's eyes/front
 *    land on imported local +Z, so it uses a 180° correction (see
 *    `CHARACTER_ASSET_ORIENTATION_YAW_OFFSET` in `characterAsset.ts`, applied
 *    by `createCharacterPresentation`). Default 0 for generic assets.
 *
 * Material assignment: the instance's cloned materials are varied per side
 * via {@link characterMaterialScheme} (Batch 2B, Task D): local instances
 * lean BuildShift blue/cyan, opponents a contrasting warm amber. The
 * variation is a small, deterministic tint + identity emissive written onto
 * the instance's OWN cloned materials — the asset's geometry/skeleton stay
 * shared where Babylon permits and no materials are ever allocated or
 * re-cloned by the variation itself. `applyState` reuses the exact
 * eliminated / hit-flash frame-decay contract of `PlayerPresentation`, and
 * `resetMaterialVariation()` restores the untouched asset look.
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
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { InstantiatedEntries } from "@babylonjs/core/assetContainer";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Scene, Observer, AnimationGroup } from "@babylonjs/core";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import {
  PLAYER_COLLIDER_HALF_TOTAL_HEIGHT,
  PLAYER_COLLIDER_TOTAL_HEIGHT,
  PLAYER_CROUCH_COLLIDER_HALF_TOTAL_HEIGHT,
} from "@buildshift/game-config";
import type { CharacterAsset } from "./characterAsset";
import { CharacterAssetLoadError } from "./characterAsset";
import type { CharacterMaterialScheme } from "./characterMaterialVariation";
import {
  applyMaterialScheme,
  characterMaterialScheme,
  readDiffuse,
  resetMaterialScheme,
  tintedBaseDiffuse,
  writeDiffuse,
  writeEmissive,
} from "./characterMaterialVariation";
import { createAuthoredCharacterClips } from "./authoredCharacterClips";
import { CharacterAnimationDriver } from "../player/characterAnimationAdapter";
import { DEFAULT_PLAYER_POSE_CONFIG } from "../player/playerPoseModel";

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
   * shared facing) used to bring an asset's own anatomical forward axis onto
   * local -Z. Defaults to 0 (generic convention); the shipped default
   * character carries its measured π correction via
   * {@link defaultCharacterAssetOrientationYawOffset}.
   */
  readonly orientationYawOffset?: number;
  /** Injectable render clock for deterministic presentation tests. */
  readonly animationClock?: () => number;
}

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
  /** Feet-alignment lift; external mounts remain presentation-only. */
  readonly visualRoot: TransformNode;

  /** Uniform normalisation scale (targetHeight / assetHeight). */
  readonly scale: number;

  private readonly _scene: Scene;
  private readonly _entries: InstantiatedEntries;
  private readonly _modelScale: TransformNode;
  private readonly _modelRoot: TransformNode;
  private readonly _meshes: Mesh[] = [];
  private readonly _materials: Material[] = [];
  /** Untouched asset diffuse per material (restored by reset / as tint input). */
  private readonly _assetDiffuse: Color3[] = [];
  /** Variant (tinted) diffuse per material, restored after flash / elimination. */
  private readonly _baseDiffuse: Color3[] = [];
  /** This instance's material-variation scheme (see characterMaterialVariation). */
  private readonly _scheme: CharacterMaterialScheme;
  private crouchScale = 1;
  private crouchBlend = 0;
  private readonly _animationGroups: AnimationGroup[];
  private readonly _animationDriver: CharacterAnimationDriver;
  private readonly _animationObserver: Observer<Scene>;
  private _disposed = false;

  private constructor(
    scene: Scene,
    variant: CharacterVariant,
    asset: CharacterAsset,
    namePrefix: string,
    options: CharacterModelOptions,
  ) {
    this._scene = scene;
    this._scheme = characterMaterialScheme(variant);

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
    //
    // The glTF importer represents node rotations as quaternions, so a plain
    // `rotation.y` write here would be SILENTLY IGNORED — the orientation
    // must compose into `rotationQuaternion` (import transform first, then
    // the asset-space yaw correction in the parent's frame). The centring
    // offset is likewise written in the ROTATED frame so the turned rig
    // stays exactly on the root axis (matters for assets whose bounds
    // centre is off-axis, e.g. this rig's cape).
    const theta = options.orientationYawOffset ?? 0;
    const importedRotation =
      modelRoot.rotationQuaternion?.clone() ?? Quaternion.Identity();
    const orientation = Quaternion.RotationYawPitchRoll(theta, 0, 0);
    modelRoot.rotationQuaternion = importedRotation.multiply(orientation);
    const centreX = (min.x + max.x) / 2;
    const centreZ = (min.z + max.z) / 2;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    modelRoot.position.set(
      -(centreX * cosT + centreZ * sinT) / s,
      -PLAYER_COLLIDER_HALF_TOTAL_HEIGHT / s - min.y,
      -(-centreX * sinT + centreZ * cosT) / s,
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
    // remember their untouched asset diffuse. The per-side variation is a
    // small deterministic tint + identity emissive computed from that base.
    const seen = new Set<Material>();
    for (const mesh of this._meshes) {
      const material = mesh.material;
      if (material && !seen.has(material)) {
        seen.add(material);
        this._materials.push(material);
        const base = readDiffuse(material).clone();
        this._assetDiffuse.push(base);
        this._baseDiffuse.push(tintedBaseDiffuse(base, this._scheme));
      }
    }
    this._applyStateColors(false, false);
    this._animationGroups = createAuthoredCharacterClips(this.root, namePrefix);
    this._animationDriver = new CharacterAnimationDriver(this.root, {
      transitionSpeed: 0.15,
      // Presentation still needs to recognise movement at low render FPS.
      // Longer gaps (hidden tab) and implausible teleports still reset history.
      poseConfig: { ...DEFAULT_PLAYER_POSE_CONFIG, maxSampleIntervalSeconds: 1 },
    });
    this._animationDriver.attachClips(this._animationGroups);
    const clock = options.animationClock ?? (() => performance.now());
    let previous = clock();
    // Same scene render lifecycle used by the primitive presentation. The
    // shared model is instantiated by BOTH local and remote body facades.
    this._animationObserver = scene.onBeforeAnimationsObservable.add(() => {
      const now = clock();
      const dt = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      const { x, y, z } = this.root.position;
      this._animationDriver.sync({ x, y, z, timeMs: now, deltaSeconds: dt, crouchBlend: this.crouchBlend });
    });
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

  /** Actual playing state, useful for presentation diagnostics. */
  public get animationState(): string | null {
    return this._animationDriver.activeClip();
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

  /** Crouch input for the skeletal driver (legacy squash for unknown rigs). */
  public setCrouchBlend(blend: number): void {
    if (this._disposed) return;
    const t = blend < 0 ? 0 : blend > 1 ? 1 : blend;
    this.crouchBlend = t;
    // Same crouch ratio the procedural presentation uses (collider-derived):
    // the squash is anchored at the feet via _applyFootLift.
    const crouchScaleTarget =
      PLAYER_CROUCH_COLLIDER_HALF_TOTAL_HEIGHT / PLAYER_COLLIDER_HALF_TOTAL_HEIGHT;
    // The rigged clip bends knees and lowers pelvis. Squashing it as well
    // would apply crouch twice. Keep legacy squash only for an unknown rig.
    this.crouchScale = this._animationGroups.length ? 1 : 1 - (1 - crouchScaleTarget) * t;
    this._applyFootLift();
  }

  /** Shows or hides the rendered model (the gameplay root keeps its transform). */
  public setEnabled(enabled: boolean): void {
    if (this._disposed) return;
    this._modelRoot.setEnabled(enabled);
  }

  /**
   * Resets the material variation: restores every owned (cloned) material to
   * the untouched asset look (original diffuse, zero emissive). Pure color
   * restore on the instance's existing clones — allocates and never leaks
   * materials. Safe before the next {@link applyState} / variant repaint;
   * no-op after dispose.
   */
  public resetMaterialVariation(): void {
    if (this._disposed) return;
    resetMaterialScheme(this._materials, this._assetDiffuse);
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
        writeDiffuse(this._materials[i], this._baseDiffuse[i]);
        writeEmissive(this._materials[i], FLASH_EMISSIVE);
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
    this._scene.onBeforeAnimationsObservable.remove(this._animationObserver);
    this._animationDriver.dispose();
    for (const group of this._animationGroups) group.dispose();
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
    if (wasEliminated) {
      for (let i = 0; i < this._materials.length; i++) {
        writeDiffuse(this._materials[i], ELIMINATED_DIFFUSE);
        writeEmissive(this._materials[i], ELIMINATED_EMISSIVE);
      }
      return;
    }
    if (flash) {
      for (let i = 0; i < this._materials.length; i++) {
        writeDiffuse(this._materials[i], this._baseDiffuse[i]);
        writeEmissive(this._materials[i], FLASH_EMISSIVE);
      }
      return;
    }
    applyMaterialScheme(this._materials, this._assetDiffuse, this._scheme);
  }
}
