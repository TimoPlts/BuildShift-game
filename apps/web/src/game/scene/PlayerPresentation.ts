/**
 * PlayerPresentation — the modular, self-cleaning Babylon presentation for a
 * single player (local or remote).
 *
 * A lightweight, stylized low-poly humanoid built ONLY from Babylon
 * primitives and materials (no external assets). The body occupies the same
 * capsule-centre origin the authoritative replicated position is defined at
 * (feet at -0.9 m, top of the collider envelope at +0.9 m), so existing camera
 * framing, match-distance readability, and all gameplay code are unchanged.
 *
 * Visual contract:
 *  - `local`  and `remote` variants use clearly distinct palettes
 *    (green vs red) so the two players are readable at match distance.
 *  - Forward orientation is shown by an emissive face visor on the -Z side of
 *    the head plus asymmetric shoulder pads and a back pack, so the facing
 *    direction is readable from the front AND the back.
 *  - `applyState(wasEliminated, hitFlashFrames)` drives the eliminated /
 *    hit-flash tint. It returns the remaining flash frame count (the same
 *    frame-decay contract the runtime already uses).
 *
 * Ownership / lifecycle:
 *  - The component owns every mesh and material it creates (all named with
 *    the provided prefix) and owns no scene observers or listeners.
 *  - `dispose()` is idempotent and releases everything it owns. After
 *    dispose, every method is a safe no-op.
 *
 * This component is presentation only: it never moves the player, never
 * decides who is hit or eliminated, and never touches gameplay state. The
 * runtime drives it exclusively from replicated / predicted positions.
 */
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PLAYER_COLLIDER_HALF_TOTAL_HEIGHT } from "@buildshift/game-config";

/** Which side of the match this presentation belongs to. */
export type PlayerVariant = "local" | "remote";

/**
 * The full material state of the body. Kept as plain pre-allocated Color3
 * values so per-frame state changes never allocate.
 */
interface PresentationPalette {
  bodyDiffuse: Color3;
  bodyEmissive: Color3;
  accentDiffuse: Color3;
  accentEmissive: Color3;
  visorDiffuse: Color3;
  visorEmissive: Color3;
}

/** Distinct, saturated palettes so the two players read apart at distance. */
const VARIANT_PALETTES: Record<PlayerVariant, PresentationPalette> = {
  local: {
    bodyDiffuse: new Color3(0.2, 0.72, 0.4),
    bodyEmissive: new Color3(0.02, 0.1, 0.05),
    accentDiffuse: new Color3(0.1, 0.38, 0.26),
    accentEmissive: new Color3(0.01, 0.05, 0.03),
    visorDiffuse: new Color3(0.7, 1.0, 0.8),
    visorEmissive: new Color3(0.55, 0.95, 0.7),
  },
  remote: {
    bodyDiffuse: new Color3(0.78, 0.28, 0.22),
    bodyEmissive: new Color3(0.06, 0.02, 0.02),
    accentDiffuse: new Color3(0.48, 0.14, 0.12),
    accentEmissive: new Color3(0.04, 0.01, 0.01),
    visorDiffuse: new Color3(1.0, 0.82, 0.7),
    visorEmissive: new Color3(0.9, 0.65, 0.5),
  },
};

/** Shared neutral palette for an eliminated player (both variants). */
const ELIMINATED_PALETTE: PresentationPalette = {
  bodyDiffuse: new Color3(0.16, 0.16, 0.17),
  bodyEmissive: new Color3(0, 0, 0),
  accentDiffuse: new Color3(0.12, 0.12, 0.13),
  accentEmissive: new Color3(0, 0, 0),
  visorDiffuse: new Color3(0.1, 0.1, 0.1),
  visorEmissive: new Color3(0.03, 0.03, 0.03),
};

/**
 * Hit-flash emissive overlay: the variant's diffuse stays, the emissive
 * flashes warm so a hit reads clearly without re-creating any material.
 */
const FLASH_EMISSIVE = {
  body: new Color3(0.75, 0.22, 0.05),
  accent: new Color3(0.6, 0.18, 0.05),
} as const;

export class PlayerPresentation {
  /**
   * Root transform. Its position IS the authoritative capsule-centre
   * position. Its Y rotation is the NEGATED shared facing yaw (Babylon's
   * node Y-rotation turns local -Z toward -X for positive angles, while the
   * shared convention turns forward toward +X — see {@link setTransform}).
   */
  readonly root: TransformNode;
  /** Visual-only child offset used when replicated multiplayer Y is feet-based. */
  readonly visualRoot: TransformNode;

  private readonly _base: PresentationPalette;
  private readonly _meshes: Mesh[] = [];
  private readonly _materials: StandardMaterial[] = [];
  private readonly _bodyMaterial: StandardMaterial;
  private readonly _accentMaterial: StandardMaterial;
  private readonly _visorMaterial: StandardMaterial;
  private readonly _visorMesh: Mesh;
  private _disposed = false;

  private constructor(scene: Scene, variant: PlayerVariant, namePrefix: string) {
    this._base = VARIANT_PALETTES[variant];

    this.root = new TransformNode(`${namePrefix}-root`, scene);
    this.visualRoot = new TransformNode(`${namePrefix}-visual-root`, scene);
    this.visualRoot.parent = this.root;

    this._bodyMaterial = this._makeMaterial(`${namePrefix}-material-body`, scene);
    this._accentMaterial = this._makeMaterial(`${namePrefix}-material-accent`, scene);
    this._visorMaterial = this._makeMaterial(`${namePrefix}-material-visor`, scene);
    this._applyPalette(this._base);

    // --- Body layout (origin = capsule centre; feet at -0.9, top <= +0.9) --
    // Legs: simple boxes, the boot line comes from the pelvis overlap.
    this._addMesh(
      this._box(`${namePrefix}-leg-left`, scene, 0.17, 0.56, 0.2),
      new Vector3(-0.115, -0.62, 0),
      this._bodyMaterial,
    );
    this._addMesh(
      this._box(`${namePrefix}-leg-right`, scene, 0.17, 0.56, 0.2),
      new Vector3(0.115, -0.62, 0),
      this._bodyMaterial,
    );
    // Pelvis: bridges the legs into the torso.
    this._addMesh(
      this._box(`${namePrefix}-pelvis`, scene, 0.32, 0.14, 0.22),
      new Vector3(0, -0.28, 0),
      this._bodyMaterial,
    );
    // Torso: the widest body box, broad at the shoulders.
    this._addMesh(
      this._box(`${namePrefix}-torso`, scene, 0.42, 0.56, 0.24),
      new Vector3(0, 0.06, 0),
      this._bodyMaterial,
    );
    // Arms.
    this._addMesh(
      this._box(`${namePrefix}-arm-left`, scene, 0.11, 0.44, 0.14),
      new Vector3(-0.27, -0.04, 0),
      this._bodyMaterial,
    );
    this._addMesh(
      this._box(`${namePrefix}-arm-right`, scene, 0.11, 0.44, 0.14),
      new Vector3(0.27, -0.04, 0),
      this._bodyMaterial,
    );
    // Shoulder pads: accent contrast on the widest part of the silhouette.
    this._addMesh(
      this._box(`${namePrefix}-pad-left`, scene, 0.15, 0.09, 0.17),
      new Vector3(-0.235, 0.36, 0),
      this._accentMaterial,
    );
    this._addMesh(
      this._box(`${namePrefix}-pad-right`, scene, 0.15, 0.09, 0.17),
      new Vector3(0.235, 0.36, 0),
      this._accentMaterial,
    );
    // Head: low-segment sphere converted to flat shading for a faceted
    // low-poly look (Babylon 9: flat shading is a per-mesh transform).
    const head = MeshBuilder.CreateSphere(
      `${namePrefix}-head`,
      { diameter: 0.3, segments: 5 },
      scene,
    );
    head.convertToFlatShadedMesh();
    this._addMesh(head, new Vector3(0, 0.47, 0), this._accentMaterial);
    // Visor: emissive strip on the -Z (forward) face of the head. The
    // primary orientation cue at match distance.
    this._visorMesh = this._box(`${namePrefix}-visor`, scene, 0.17, 0.055, 0.05);
    this._addMesh(this._visorMesh, new Vector3(0, 0.49, -0.145), this._visorMaterial);
    // Back pack: accent block on the +Z side so facing is readable from behind.
    this._addMesh(
      this._box(`${namePrefix}-backpack`, scene, 0.17, 0.16, 0.09),
      new Vector3(0, 0.12, 0.16),
      this._accentMaterial,
    );
  }

  /**
   * Creates the presentation in `scene`. `namePrefix` prefixes every owned
   * mesh/material name (e.g. "local-player" / "remote-player").
   */
  public static create(
    scene: Scene,
    variant: PlayerVariant,
    namePrefix: string,
  ): PlayerPresentation {
    return new PlayerPresentation(scene, variant, namePrefix);
  }

  /** The owned forward-orientation visor mesh (for tests / debugging). */
  public get visorMesh(): Mesh {
    return this._visorMesh;
  }

  /** The owned body material (for tests / debugging). */
  public get bodyMaterial(): StandardMaterial {
    return this._bodyMaterial;
  }

  /** True once {@link dispose} has run. */
  public get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * Moves the body to the (predicted / interpolated / authoritative)
   * capsule-centre position and faces it along the shared-movement yaw
   * (yaw 0 faces -Z, positive toward +X).
   *
   * Note the sign flip: Babylon's node `rotation.y` turns the local -Z axis
   * toward -X for positive angles (right-handed Y rotation), while the shared
   * yaw convention turns forward toward +X. Negating keeps the body's front
   * (local -Z, the visor side) facing the movement forward.
   */
  public setTransform(
    position: Readonly<{ x: number; y: number; z: number }>,
    yaw: number,
  ): void {
    if (this._disposed) return;
    this.root.position.set(position.x, position.y, position.z);
    this.root.rotation.y = -yaw;
    // The two-player room replicates feet at y=0 on grounded players while
    // this root intentionally stays at that unmodified gameplay transform.
    // Move only the rendered body into the capsule envelope.
    this.visualRoot.position.y = PLAYER_COLLIDER_HALF_TOTAL_HEIGHT;
  }

  /** Shows or hides every owned mesh (the root transform itself has no mesh). */
  public setEnabled(enabled: boolean): void {
    if (this._disposed) return;
    for (const mesh of this._meshes) {
      mesh.setEnabled(enabled);
    }
  }

  /**
   * Applies the replicated presentation state and returns the remaining
   * hit-flash frame count (frame-decay contract):
   *  - eliminated players render in the shared dark palette (flash suppressed);
   *  - while `hitFlashFrames > 0` the body flashes warm emissive and the
   *    counter decrements by one per call;
   *  - otherwise the variant's base palette is restored.
   */
  public applyState(wasEliminated: boolean, hitFlashFrames: number): number {
    if (this._disposed) return hitFlashFrames;
    if (wasEliminated) {
      this._applyPalette(ELIMINATED_PALETTE);
      return hitFlashFrames;
    }
    if (hitFlashFrames > 0) {
      this._applyFlash();
      return hitFlashFrames - 1;
    }
    this._applyPalette(this._base);
    return hitFlashFrames;
  }

  /**
   * Idempotent teardown: disposes every owned mesh and material and the root
   * transform. Safe to call multiple times; afterwards all methods are no-ops.
   */
  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const mesh of this._meshes) {
      mesh.dispose();
    }
    for (const material of this._materials) {
      material.dispose();
    }
    this.root.dispose();
  }

  // --- internals -----------------------------------------------------------

  private _makeMaterial(name: string, scene: Scene): StandardMaterial {
    const material = new StandardMaterial(name, scene);
    this._materials.push(material);
    return material;
  }

  private _box(
    name: string,
    scene: Scene,
    width: number,
    height: number,
    depth: number,
  ): Mesh {
    // Single-segment boxes: one quad per face, the low-poly silhouette.
    return MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  }

  private _addMesh(mesh: Mesh, localPosition: Vector3, material: StandardMaterial): void {
    // Presentation safety: never pickable, never a collision source.
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.material = material;
    mesh.parent = this.visualRoot;
    mesh.position.copyFrom(localPosition);
    this._meshes.push(mesh);
  }

  private _applyPalette(palette: PresentationPalette): void {
    this._bodyMaterial.diffuseColor.copyFrom(palette.bodyDiffuse);
    this._bodyMaterial.emissiveColor.copyFrom(palette.bodyEmissive);
    this._accentMaterial.diffuseColor.copyFrom(palette.accentDiffuse);
    this._accentMaterial.emissiveColor.copyFrom(palette.accentEmissive);
    this._visorMaterial.diffuseColor.copyFrom(palette.visorDiffuse);
    this._visorMaterial.emissiveColor.copyFrom(palette.visorEmissive);
  }

  private _applyFlash(): void {
    this._bodyMaterial.diffuseColor.copyFrom(this._base.bodyDiffuse);
    this._bodyMaterial.emissiveColor.copyFrom(FLASH_EMISSIVE.body);
    this._accentMaterial.diffuseColor.copyFrom(this._base.accentDiffuse);
    this._accentMaterial.emissiveColor.copyFrom(FLASH_EMISSIVE.accent);
    this._visorMaterial.diffuseColor.copyFrom(this._base.visorDiffuse);
    this._visorMaterial.emissiveColor.copyFrom(this._base.visorEmissive);
  }
}
