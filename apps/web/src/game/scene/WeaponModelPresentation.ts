/**
 * WeaponModelPresentation — modular, self-cleaning Babylon presentation for
 * the equipped weapon model of the local player.
 *
 * Two stylized low-poly weapon silhouettes built ONLY from Babylon boxes and
 * two shared materials (no external assets, no textures):
 *  - **assault_rifle** — long, slim, light: thin receiver, long thin barrel
 *    with a distinct muzzle brake, total ≈ 0.65 m, with two accent hand
 *    grips so the two-handed hold reads clearly from the third-person
 *    camera (6 boxes)
 *  - **shotgun** — short, chunky, heavy: wide tall receiver, thick barrel,
 *    prominent pump grip, total ≈ 0.48 m, with two accent hand grips
 *    (7 boxes)
 *
 * Both weapon meshes are pre-built at construction time. Switching the
 * equipped weapon is a visibility toggle (no allocation). Each weapon group
 * also carries one geometry-free muzzle anchor transform at its barrel tip.
 * The component owns every mesh, material, and node it creates and exposes a
 * single idempotent `dispose()` that releases them all.
 *
 * Held-weapon handling presentation (visual-only):
 *  - `setReload` mirrors the reload as a downward dip with a muzzle-DOWN tilt
 *    (peak at mid-reload, rest at both ends);
 *  - `setEquippedWeapon` starts the newly equipped weapon dipped (low) and
 *    eases it back to rest over a short, deliberate settle;
 *  - each frame the held weapon's tilt follows the scene's active camera aim
 *    pitch (clamped + smoothed, same camera source the player pose uses) so
 *    the grips and muzzle read as pointing where the player is looking;
 *  - `getMuzzlePosition(out)` reports the equipped weapon's barrel-tip
 *    position in world space (the muzzle flash / tracer origin), including
 *    any dip or aim tilt in progress.
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
import type { Observer, Scene } from "@babylonjs/core";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";

/** Dark gunmetal — shared by both weapon variants. */
const BODY_DIFFUSE = new Color3(0.18, 0.18, 0.20);
const BODY_EMISSIVE = new Color3(0.02, 0.02, 0.03);
/** Slightly lighter accent — stock, grips, hands, and muzzle hardware. */
const ACCENT_DIFFUSE = new Color3(0.30, 0.28, 0.26);
const ACCENT_EMISSIVE = new Color3(0.03, 0.02, 0.02);

/**
 * Held-weapon handling presentation (visual-only). A "dip" is a downward Y
 * offset (metres) applied to the equipped weapon's group, with a small
 * muzzle-down tilt. It never touches gameplay: reload timing is authoritative
 * on the server, and these transforms only mirror that state for the eye.
 *
 * Note on rotation sign: in this engine a POSITIVE local rotation.x raises
 * the muzzle (the -Z axis); the muzzle-down tilt below is therefore
 * negative.
 */
const DIP = {
  /** Peak downward drop while a reload is in progress (metres). */
  reloadDipMeters: 0.12,
  /** Downward drop when a new weapon is swapped in (metres). */
  switchDipMeters: 0.1,
  /** Muzzle-down tilt per metre of dip (radians per metre). */
  tiltPerMeter: 0.9,
  /** How fast the switch dip settles back to rest (per second). */
  switchSettleRatePerSec: 18,
  /** Largest frame delta fed to the settle easing (seconds). */
  maxFrameDeltaSeconds: 0.1,
} as const;

/**
 * Aim-orientation presentation (visual-only): how the held weapon follows
 * the scene's active camera aim pitch so the grip orientation and muzzle
 * location read clearly from the third-person camera.
 */
const AIM = {
  /** Weapon tilt per radian of aim pitch (1.0 = full follow). */
  followGain: 1.0,
  /** Largest aim tilt applied to the held weapon (radians, each direction). */
  maxFollowRadians: 1.15,
  /** How fast the held weapon's tilt follows the aim pitch (per second). */
  followRatePerSec: 12,
} as const;

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
  private readonly _nodes: TransformNode[] = [];

  private readonly _rifleRoot: TransformNode;
  private readonly _rifleMeshes: Mesh[] = [];
  /** Geometry-free barrel-tip anchor (child of the rifle group). */
  private readonly _rifleMuzzleAnchor: TransformNode;
  private readonly _shotgunRoot: TransformNode;
  private readonly _shotgunMeshes: Mesh[] = [];
  /** Geometry-free barrel-tip anchor (child of the shotgun group). */
  private readonly _shotgunMuzzleAnchor: TransformNode;

  private _equipped: WeaponType = "assault_rifle";
  private _componentEnabled = true;
  private _disposed = false;

  /** Reload dip in metres (driven synchronously by {@link setReload}). */
  private _reloadDip = 0;
  /** Switch dip in metres (eased by {@link update} toward the target). */
  private _switchDip = 0;
  private _switchDipTarget = 0;
  /** Smoothed aim pitch (radians) the held weapon currently tilts by. */
  private _aimPitch = 0;
  private readonly _aimDir = new Vector3();
  private readonly _cameraForward = Vector3.Forward();
  private readonly _observer: Observer<Scene>;

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
    this._nodes.push(this._rifleRoot);
    this._rifleMuzzleAnchor = this._makeMuzzleAnchor(
      `${namePrefix}-rifle-muzzle-anchor`,
      this._rifleRoot,
      0,
      0,
      -0.48,
    );
    this._buildRifle();

    this._shotgunRoot = new TransformNode(`${namePrefix}-shotgun-group`, scene);
    this._shotgunRoot.parent = this.root;
    this._nodes.push(this._shotgunRoot);
    this._shotgunMuzzleAnchor = this._makeMuzzleAnchor(
      `${namePrefix}-shotgun-muzzle-anchor`,
      this._shotgunRoot,
      0,
      0,
      -0.33,
    );
    this._buildShotgun();

    // Initial visibility: assault rifle visible, shotgun hidden.
    this._applyVisibility();

    // One render-frame observer eases the switch dip back to rest and
    // follows the aim pitch. The reload dip is driven synchronously by
    // setReload, so it stays in sync even when the render cadence is
    // decoupled from the reload clock.
    this._observer = this._scene.onBeforeRenderObservable.add(() =>
      this._tickFrame(),
    );
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
    // Deliberate-but-fast swap: the newly-equipped weapon starts dipped (low)
    // and eases back to rest over the next few frames. The swap itself is a
    // pure visibility toggle — only the presentation lags for the feel.
    this._switchDip = DIP.switchDipMeters;
    this._switchDipTarget = 0;
    this._applyHeldTransform();
  }

  /**
   * Mirrors the local reload state as a visual-only dip: the held weapon
   * lowers (muzzle down) at the middle of the reload and returns to rest at
   * both ends. `progress` is the authoritative reload progress in [0, 1];
   * `active` gates it (call with `active=false` — or `progress=0` — when
   * idle). This only animates the model; it never changes the real reload
   * timing.
   */
  public setReload(active: boolean, progress: number): void {
    if (this._disposed) return;
    const p = active ? Math.min(1, Math.max(0, progress)) : 0;
    // A smooth bump: 0 at the start, peak at the middle, 0 at the end.
    this._reloadDip = Math.sin(Math.PI * p) * DIP.reloadDipMeters;
    this._applyHeldTransform();
  }

  /**
   * Advances the switch-dip settle and the aim-pitch follow by `dtSeconds`
   * and re-applies the held weapon's transform. Zero (or negative) deltas
   * are no-ops. Called each frame by the render observer; tests may call it
   * directly for determinism.
   */
  public update(dtSeconds: number): void {
    if (this._disposed) return;
    if (dtSeconds <= 0) return;
    if (this._switchDip !== this._switchDipTarget) {
      const step = 1 - Math.exp(-DIP.switchSettleRatePerSec * dtSeconds);
      this._switchDip += (this._switchDipTarget - this._switchDip) * step;
      if (Math.abs(this._switchDip - this._switchDipTarget) < 1e-4) {
        this._switchDip = this._switchDipTarget;
      }
    }
    // Aim follow: smooth toward the active camera's pitch (0 when no camera).
    const target = this._sampleAimPitch();
    const blend = 1 - Math.exp(-AIM.followRatePerSec * dtSeconds);
    this._aimPitch += (target - this._aimPitch) * blend;
    this._applyHeldTransform();
  }

  /**
   * Writes the equipped weapon's muzzle (barrel tip) position in world
   * space into `out` and returns `out`. This is the presentation origin for
   * the muzzle flash / tracer: it follows the equipped weapon's group, so a
   * dip or aim tilt in progress moves the reported muzzle too. The anchor is
   * geometry-free, so this adds no renderable mesh. Safe no-op after dispose
   * (writes a zero vector).
   */
  public getMuzzlePosition(out: Vector3): Vector3 {
    if (this._disposed) {
      out.set(0, 0, 0);
      return out;
    }
    const anchor =
      this._equipped === "assault_rifle"
        ? this._rifleMuzzleAnchor
        : this._shotgunMuzzleAnchor;
    // Force the ancestor chain so the result is correct even between render
    // passes (the same technique the tracer effect uses).
    anchor.computeWorldMatrix(true);
    const m = anchor.getWorldMatrix();
    out.set(m.m[12], m.m[13], m.m[14]);
    return out;
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
   * sub-group transforms, both muzzle anchors, and the root transform. Safe
   * to call multiple times; afterwards all methods are safe no-ops.
   */
  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._scene.onBeforeRenderObservable.remove(this._observer);
    for (const mesh of this._meshes) {
      mesh.dispose();
    }
    for (const mat of this._materials) {
      mat.dispose();
    }
    for (const node of this._nodes) {
      node.dispose();
    }
    this._rifleMuzzleAnchor.dispose();
    this._shotgunMuzzleAnchor.dispose();
    this.root.dispose();
  }

  // --- internals -----------------------------------------------------------

  private _applyVisibility(): void {
    if (!this._componentEnabled) return;
    const rifleVisible = this._equipped === "assault_rifle";
    for (const mesh of this._rifleMeshes) mesh.setEnabled(rifleVisible);
    for (const mesh of this._shotgunMeshes) mesh.setEnabled(!rifleVisible);
  }

  /**
   * Samples the display aim pitch (radians; positive = looking up) from the
   * scene's active camera — the same source the player pose uses for its
   * aim stance. Returns 0 when the scene has no active camera.
   */
  private _sampleAimPitch(): number {
    const camera = this._scene.activeCamera;
    if (!camera) return 0;
    camera.getDirectionToRef(this._cameraForward, this._aimDir);
    return Math.asin(Math.min(1, Math.max(-1, this._aimDir.y)));
  }

  /**
   * Applies the current held-weapon transform to the equipped weapon's group
   * (a presentation-only transform below the caller-owned `root`): the dip
   * (the larger of reload / switch dip) lowers the group with a muzzle-down
   * tilt, and the smoothed aim pitch tilts the muzzle toward the look
   * direction. At rest with a level aim the group returns to its identity
   * transform.
   */
  private _applyHeldTransform(): void {
    if (this._disposed) return;
    const group =
      this._equipped === "assault_rifle" ? this._rifleRoot : this._shotgunRoot;
    const dip = Math.max(this._reloadDip, this._switchDip);
    group.position.y = -dip;
    const aimTilt = Math.max(
      -AIM.maxFollowRadians,
      Math.min(AIM.maxFollowRadians, this._aimPitch * AIM.followGain),
    );
    // Positive rotation.x raises the muzzle; the dip must tilt it down.
    group.rotation.x = aimTilt - dip * DIP.tiltPerMeter;
  }

  /** One render frame: advance the switch-dip settle and re-apply the dip. */
  private _tickFrame(): void {
    if (this._disposed) return;
    const dt = Math.min(
      DIP.maxFrameDeltaSeconds,
      Math.max(0, this._scene.getEngine().getDeltaTime() / 1000),
    );
    this.update(dt);
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

  /** Creates an owned geometry-free transform at `local` under `parent`. */
  private _makeMuzzleAnchor(
    name: string,
    parent: TransformNode,
    x: number,
    y: number,
    z: number,
  ): TransformNode {
    const anchor = new TransformNode(name, this._scene);
    anchor.parent = parent;
    anchor.position.set(x, y, z);
    return anchor;
  }

  /**
   * Assault rifle — long, slim silhouette (total ≈ 0.65 m along Z):
   *   stock (rear, +Z) → receiver (middle) → long thin barrel (front, −Z)
   *   → muzzle brake at the tip, plus two accent hands on the grip and the
   *   handguard so the two-handed hold reads clearly from behind.
   */
  private _buildRifle(): void {
    this._addMesh(
      this._box(`${this._namePrefix}-rifle-stock`, 0.04, 0.05, 0.13),
      new Vector3(0, -0.01, 0.105),
      this._accentMaterial,
      this._rifleRoot,
      this._rifleMeshes,
    );
    this._addMesh(
      this._box(`${this._namePrefix}-rifle-receiver`, 0.035, 0.05, 0.24),
      new Vector3(0, 0, -0.02),
      this._bodyMaterial,
      this._rifleRoot,
      this._rifleMeshes,
    );
    // Long thin barrel extending forward (−Z).
    this._addMesh(
      this._box(`${this._namePrefix}-rifle-barrel`, 0.016, 0.016, 0.34),
      new Vector3(0, 0, -0.235),
      this._bodyMaterial,
      this._rifleRoot,
      this._rifleMeshes,
    );
    // Muzzle brake — the distinct accent tip so the muzzle location reads.
    this._addMesh(
      this._box(`${this._namePrefix}-rifle-muzzle-brake`, 0.026, 0.026, 0.04),
      new Vector3(0, 0, -0.46),
      this._accentMaterial,
      this._rifleRoot,
      this._rifleMeshes,
    );
    // Rear hand on the trigger grip, front hand on the handguard.
    this._addMesh(
      this._box(`${this._namePrefix}-rifle-hand-rear`, 0.034, 0.042, 0.04),
      new Vector3(0, -0.043, -0.075),
      this._accentMaterial,
      this._rifleRoot,
      this._rifleMeshes,
    );
    this._addMesh(
      this._box(`${this._namePrefix}-rifle-hand-front`, 0.034, 0.036, 0.05),
      new Vector3(0, -0.027, -0.2),
      this._accentMaterial,
      this._rifleRoot,
      this._rifleMeshes,
    );
  }

  /**
   * Shotgun — short, chunky, heavy silhouette (total ≈ 0.48 m along Z):
   *   stock (rear, +Z) → wide tall receiver (middle) → thick barrel (front,
   *   −Z) → muzzle collar at the tip, plus the distinctive pump grip and two
   *   accent hands (rear on the trigger grip, front on the pump).
   */
  private _buildShotgun(): void {
    this._addMesh(
      this._box(`${this._namePrefix}-shotgun-stock`, 0.065, 0.09, 0.13),
      new Vector3(0, -0.01, 0.085),
      this._accentMaterial,
      this._shotgunRoot,
      this._shotgunMeshes,
    );
    // Wide, tall receiver — the chunky core of the silhouette.
    this._addMesh(
      this._box(`${this._namePrefix}-shotgun-receiver`, 0.06, 0.095, 0.2),
      new Vector3(0, 0, -0.03),
      this._bodyMaterial,
      this._shotgunRoot,
      this._shotgunMeshes,
    );
    // Thick barrel, shorter than the rifle's.
    this._addMesh(
      this._box(`${this._namePrefix}-shotgun-barrel`, 0.045, 0.045, 0.22),
      new Vector3(0, 0, -0.19),
      this._bodyMaterial,
      this._shotgunRoot,
      this._shotgunMeshes,
    );
    // Muzzle collar — the distinct accent tip so the muzzle location reads.
    this._addMesh(
      this._box(`${this._namePrefix}-shotgun-muzzle`, 0.052, 0.052, 0.03),
      new Vector3(0, 0, -0.315),
      this._accentMaterial,
      this._shotgunRoot,
      this._shotgunMeshes,
    );
    // Distinctive pump grip — the primary silhouette differentiator.
    this._addMesh(
      this._box(`${this._namePrefix}-shotgun-pump`, 0.05, 0.04, 0.11),
      new Vector3(0, -0.062, -0.145),
      this._accentMaterial,
      this._shotgunRoot,
      this._shotgunMeshes,
    );
    // Rear hand on the trigger grip, front hand wrapping the pump.
    this._addMesh(
      this._box(`${this._namePrefix}-shotgun-hand-rear`, 0.04, 0.045, 0.045),
      new Vector3(0, -0.05, -0.075),
      this._accentMaterial,
      this._shotgunRoot,
      this._shotgunMeshes,
    );
    this._addMesh(
      this._box(`${this._namePrefix}-shotgun-hand-front`, 0.045, 0.04, 0.06),
      new Vector3(0, -0.078, -0.145),
      this._accentMaterial,
      this._shotgunRoot,
      this._shotgunMeshes,
    );
  }
}
