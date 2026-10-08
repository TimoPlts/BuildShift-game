/**
 * WeaponModelPresentation — modular, self-cleaning Babylon presentation for
 * the equipped weapon model of the local player.
 *
 * Two stylized low-poly weapon silhouettes built ONLY from Babylon boxes and
 * materials (no external assets):
 *  - **assault_rifle** — long, slim: thin barrel, total ≈ 0.56 m
 *  - **shotgun** — short, wide: thicker barrel + pump grip, total ≈ 0.43 m
 *
 * Both weapon meshes are pre-built at construction time. Switching the
 * equipped weapon is a visibility toggle (no allocation). The component owns
 * every mesh and material it creates and exposes a single idempotent
 * `dispose()` that releases them all.
 *
 * The weapon model is attached to the player's presentation root transform
 * node so it moves and rotates with the player body automatically.
 *
 * Presentation only: never touches gameplay, ammo, damage, or protocol state.
 */
import type { WeaponType } from "@buildshift/protocol";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";

/** Dark gunmetal — shared by both weapon variants. */
const BODY_DIFFUSE = new Color3(0.18, 0.18, 0.20);
const BODY_EMISSIVE = new Color3(0.02, 0.02, 0.03);
/** Slightly lighter accent — stock and grip. */
const ACCENT_DIFFUSE = new Color3(0.30, 0.28, 0.26);
const ACCENT_EMISSIVE = new Color3(0.03, 0.02, 0.02);

export class WeaponModelPresentation {
  /**
   * Root transform node. The caller sets `root.parent` to the player's
   * presentation root (and `root.position` to offset the weapon from the
   * body origin). The node is created in `scene` but has no geometry itself.
   */
  readonly root: TransformNode;

  private readonly _scene: Scene;
  private readonly _namePrefix: string;
  private readonly _bodyMaterial: StandardMaterial;
  private readonly _accentMaterial: StandardMaterial;
  private readonly _meshes: Mesh[] = [];
  private readonly _materials: StandardMaterial[] = [];

  private readonly _rifleRoot: TransformNode;
  private readonly _rifleMeshes: Mesh[] = [];
  private readonly _shotgunRoot: TransformNode;
  private readonly _shotgunMeshes: Mesh[] = [];

  private _equipped: WeaponType = "assault_rifle";
  private _componentEnabled = true;
  private _disposed = false;

  private constructor(scene: Scene, namePrefix: string) {
    this._scene = scene;
    this._namePrefix = namePrefix;

    this.root = new TransformNode(`${namePrefix}-root`, scene);

    this._bodyMaterial = new StandardMaterial(`${namePrefix}-material-body`, scene);
    this._bodyMaterial.diffuseColor.copyFrom(BODY_DIFFUSE);
    this._bodyMaterial.emissiveColor.copyFrom(BODY_EMISSIVE);

    this._accentMaterial = new StandardMaterial(`${namePrefix}-material-accent`, scene);
    this._accentMaterial.diffuseColor.copyFrom(ACCENT_DIFFUSE);
    this._accentMaterial.emissiveColor.copyFrom(ACCENT_EMISSIVE);

    this._materials.push(this._bodyMaterial, this._accentMaterial);

    this._rifleRoot = new TransformNode(`${namePrefix}-rifle-group`, scene);
    this._rifleRoot.parent = this.root;
    this._buildRifle();

    this._shotgunRoot = new TransformNode(`${namePrefix}-shotgun-group`, scene);
    this._shotgunRoot.parent = this.root;
    this._buildShotgun();

    // Initial visibility: assault rifle visible, shotgun hidden.
    this._applyVisibility();
  }

  /**
   * Creates the weapon model presentation in `scene`.
   * `namePrefix` prefixes every owned mesh/material name.
   */
  public static create(scene: Scene, namePrefix: string): WeaponModelPresentation {
    return new WeaponModelPresentation(scene, namePrefix);
  }

  /** The currently equipped weapon type. */
  public get equippedWeapon(): WeaponType {
    return this._equipped;
  }

  /** True once {@link dispose} has run. */
  public get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * Switches the visible weapon silhouette. The previously equipped weapon's
   * meshes are hidden; the new weapon's meshes are shown. No new meshes or
   * materials are created — this is a pure visibility toggle.
   *
   * Calling with the same weapon type is a no-op.
   */
  public setEquippedWeapon(weaponType: WeaponType): void {
    if (this._disposed) return;
    if (weaponType === this._equipped) return;
    this._equipped = weaponType;
    this._applyVisibility();
  }

  /**
   * Shows or hides all weapon meshes (useful to hide the weapon entirely,
   * e.g. during a presentation transition). When re-enabled, only the
   * currently equipped weapon's meshes are shown.
   */
  public setEnabled(enabled: boolean): void {
    if (this._disposed) return;
    this._componentEnabled = enabled;
    if (enabled) {
      this._applyVisibility();
    } else {
      for (const mesh of this._meshes) {
        mesh.setEnabled(false);
      }
    }
  }

  /**
   * Idempotent teardown: disposes every owned mesh and material, both weapon
   * sub-group transforms, and the root transform. Safe to call multiple times;
   * afterwards all methods are safe no-ops.
   */
  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const mesh of this._meshes) {
      mesh.dispose();
    }
    for (const mat of this._materials) {
      mat.dispose();
    }
    this._rifleRoot.dispose();
    this._shotgunRoot.dispose();
    this.root.dispose();
  }

  // --- internals -----------------------------------------------------------

  private _applyVisibility(): void {
    if (!this._componentEnabled) return;
    const rifleVisible = this._equipped === "assault_rifle";
    for (const mesh of this._rifleMeshes) mesh.setEnabled(rifleVisible);
    for (const mesh of this._shotgunMeshes) mesh.setEnabled(!rifleVisible);
  }

  private _box(name: string, w: number, h: number, d: number): Mesh {
    return MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this._scene);
  }

  private _addMesh(
    mesh: Mesh,
    localPos: Vector3,
    material: StandardMaterial,
    parent: TransformNode,
    list: Mesh[],
  ): void {
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.material = material;
    mesh.parent = parent;
    mesh.position.copyFrom(localPos);
    list.push(mesh);
    this._meshes.push(mesh);
  }

  /**
   * Assault rifle — long, slim silhouette (total ≈ 0.56 m along Z):
   *   stock (rear, +Z) → receiver (middle) → barrel (front, −Z, thin)
   */
  private _buildRifle(): void {
    this._addMesh(
      this._box(`${this._namePrefix}-rifle-stock`, 0.05, 0.055, 0.12),
      new Vector3(0, -0.01, 0.12),
      this._accentMaterial,
      this._rifleRoot,
      this._rifleMeshes,
    );
    this._addMesh(
      this._box(`${this._namePrefix}-rifle-receiver`, 0.045, 0.055, 0.26),
      new Vector3(0, 0, -0.02),
      this._bodyMaterial,
      this._rifleRoot,
      this._rifleMeshes,
    );
    // Long thin barrel extending forward (−Z).
    this._addMesh(
      this._box(`${this._namePrefix}-rifle-barrel`, 0.02, 0.02, 0.28),
      new Vector3(0, 0, -0.24),
      this._bodyMaterial,
      this._rifleRoot,
      this._rifleMeshes,
    );
  }

  /**
   * Shotgun — short, wide silhouette (total ≈ 0.43 m along Z):
   *   stock (rear, +Z) → wide receiver (middle) → wide barrel (front, −Z)
   *   + distinctive pump grip under the barrel
   */
  private _buildShotgun(): void {
    this._addMesh(
      this._box(`${this._namePrefix}-shotgun-stock`, 0.06, 0.085, 0.12),
      new Vector3(0, -0.01, 0.10),
      this._accentMaterial,
      this._shotgunRoot,
      this._shotgunMeshes,
    );
    // Wider receiver than the rifle.
    this._addMesh(
      this._box(`${this._namePrefix}-shotgun-receiver`, 0.055, 0.085, 0.18),
      new Vector3(0, 0, -0.02),
      this._bodyMaterial,
      this._shotgunRoot,
      this._shotgunMeshes,
    );
    // Shorter but wider barrel than the rifle.
    this._addMesh(
      this._box(`${this._namePrefix}-shotgun-barrel`, 0.04, 0.04, 0.22),
      new Vector3(0, 0, -0.16),
      this._bodyMaterial,
      this._shotgunRoot,
      this._shotgunMeshes,
    );
    // Distinctive pump grip — the primary silhouette differentiator.
    this._addMesh(
      this._box(`${this._namePrefix}-shotgun-pump`, 0.045, 0.035, 0.10),
      new Vector3(0, -0.06, -0.08),
      this._accentMaterial,
      this._shotgunRoot,
      this._shotgunMeshes,
    );
  }
}
