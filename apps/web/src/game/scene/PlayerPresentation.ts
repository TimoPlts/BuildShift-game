/**
 * PlayerPresentation — the modular, self-cleaning Babylon presentation for a
 * single player (local or remote).
 *
 * A lightweight, stylized low-poly humanoid built ONLY from Babylon
 * primitives and materials (no external assets). The body occupies the same
 * capsule-centre origin the authoritative replicated position is defined at
 * (feet at -0.9 m, top of the collider envelope at +0.9 m), so existing
 * camera framing, match-distance readability, and all gameplay code are
 * unchanged.
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
 * Procedural presentation (visual-only; local and remote share the same
 * logic where practical):
 *  - The display state is DERIVED from the same canonical position stream
 *    `setTransform` already receives (predicted for the local player,
 *    interpolated for remote players): horizontal speed → idle / walk /
 *    run; vertical velocity → jump / fall; the grounded transition → a
 *    landing dip. See `./player/playerPoseModel` for the pure math.
 *  - The local player additionally holds a weapon-aim stance derived from
 *    the scene's active camera (the same canonical aim the runtime uses for
 *    firing); remote players use the facing-neutral stance because their
 *    aim pitch is not replicated.
 *  - The pose advances on the scene's before-render observable, so it is
 *    smooth at render cadence regardless of the position stream's cadence.
 *  - Pose transforms are applied to presentation meshes and pivots BELOW
 *    `visualRoot` only. `root` (the gameplay mirror) and `visualRoot` are
 *    touched exclusively by `setTransform`, so visual animation can never
 *    mutate gameplay transforms.
 *
 * Ownership / lifecycle:
 *  - The component owns every mesh, material, and pivot it creates (all
 *    named with the provided prefix) and ONE scene before-render observer.
 *  - `dispose()` is idempotent and releases everything it owns, including
 *    the observer. After dispose, every method is a safe no-op.
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
import type { Observer, Scene } from "@babylonjs/core";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";import { PLAYER_COLLIDER_HALF_TOTAL_HEIGHT } from "@buildshift/game-config";
import {
  DEFAULT_PLAYER_POSE_CONFIG,
  PlayerPoseModel,
  type PlayerPose,
} from "./player/playerPoseModel";

/** Which side of the match this presentation belongs to. */
export type PlayerVariant = "local" | "remote";

/** Optional presentation construction options. */
export interface PlayerPresentationOptions {
  /**
   * Injectable clock (milliseconds) for the kinematic sampling and the
   * render-frame pose clock. Defaults to `performance.now()`. Tests pass a
   * manual clock for determinism.
   */
  readonly clock?: () => number;
}

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
    bodyDiffuse: new Color3(0.15, 0.78, 0.35),
    bodyEmissive: new Color3(0.01, 0.12, 0.04),
    accentDiffuse: new Color3(0.05, 0.32, 0.30),
    accentEmissive: new Color3(0.01, 0.06, 0.06),
    visorDiffuse: new Color3(0.6, 1.0, 0.85),
    visorEmissive: new Color3(0.5, 1.0, 0.75),
  },
  remote: {
    bodyDiffuse: new Color3(0.82, 0.25, 0.15),
    bodyEmissive: new Color3(0.08, 0.02, 0.01),
    accentDiffuse: new Color3(0.42, 0.12, 0.08),
    accentEmissive: new Color3(0.05, 0.01, 0.01),
    visorDiffuse: new Color3(1.0, 0.75, 0.55),
    visorEmissive: new Color3(0.95, 0.6, 0.4),
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

/**
 * Procedural pose tuning (presentation-only radians / metres). The body's
 * local -Z is its forward (the visor side).
 */
const POSE = {
  /** Forward knee tuck (rotation.x) while jumping: [left, right]. */
  jumpTuckLeg: [0.60, 0.32] as const,
  /** Fore/aft leg split while falling: [left, right]. */
  fallLeg: [0.15, -0.15] as const,
  /** Lateral knee spread (rotation.z, knees OUT) while falling. */
  fallLegSpread: [-0.22, 0.22] as const,
  /** Weapon-aim arm lift (rotation.x, forward-up) for [left, right]. */
  aimArmX: [-1.38, -1.12] as const,
  /** How the aim pitch tilts the aiming arms (radians per radian). */
  aimArmPitchSensitivity: 0.6,
  aimArmXMin: -2.4,
  aimArmXMax: -0.5,
  /** Two-handed grip: hands drawn slightly toward the midline (rotation.z). */
  aimArmGripZ: [0.28, -0.28] as const,
  /** Arms flung upward while falling (non-aiming body only). */
  fallArmX: -1.95,
  /** Idle arm sway (radians, driven by the breath oscillator). */
  idleArmSway: 0.03,
  /** Torso lean per radian of aim pitch while aiming (up = slight back). */
  aimSpineLean: 0.22,
  /** Visor tilt per radian of aim pitch. */
  aimVisorPitch: 0.4,
  /** Largest render-frame delta fed to the pose clock (seconds). */
  maxFrameDeltaSeconds: 0.1,
} as const;

/** The spine pivot's rest position (waist height, spine-local parent = visualRoot). */
const SPINE_BASE_Y = -0.18;

export class PlayerPresentation {
  /**
   * Root transform. Its position IS the authoritative capsule-centre
   * position. Its Y rotation is the NEGATED shared facing yaw (Babylon's
   * node Y-rotation turns local -Z toward -X for positive angles, while the
   * shared convention turns forward toward +X — see {@link setTransform}).
   *
   * GAMEPLAY MIRROR: never animated by the procedural pose.
   */
  readonly root: TransformNode;
  /**
   * Visual-only child offset used when replicated multiplayer Y is
   * feet-based. Only `setTransform` writes it — the procedural pose never
   * touches it.
   */
  readonly visualRoot: TransformNode;

  private readonly _scene: Scene;
  private readonly _variant: PlayerVariant;
  private readonly _base: PresentationPalette;
  private readonly _meshes: Mesh[] = [];
  private readonly _materials: StandardMaterial[] = [];
  private readonly _pivots: TransformNode[] = [];
  private readonly _bodyMaterial: StandardMaterial;
  private readonly _accentMaterial: StandardMaterial;
  private readonly _visorMaterial: StandardMaterial;
  private readonly _visorMesh: Mesh;
  /** Animation pivots (presentation only, below visualRoot). */
  private readonly _spinePivot: TransformNode;
  private readonly _legLeftPivot: TransformNode;
  private readonly _legRightPivot: TransformNode;
  private readonly _armLeftPivot: TransformNode;
  private readonly _armRightPivot: TransformNode;

  private readonly _poseModel: PlayerPoseModel;
  private readonly _observer: Observer<Scene>;
  private readonly _clock: () => number;
  private readonly _aimDirection = new Vector3();
  /**
   * The canonical camera forward axis in this engine build (left-handed:
   * local +Z is the view direction — the same constant the runtime's
   * AimController reads for firing).
   */
  private readonly _cameraForward = Vector3.Forward();
  private _lastFrameMs: number | null = null;
  private _componentEnabled = true;
  private _disposed = false;

  private constructor(
    scene: Scene,
    variant: PlayerVariant,
    namePrefix: string,
    clock: (() => number) | undefined,
  ) {
    this._scene = scene;
    this._variant = variant;
    this._base = VARIANT_PALETTES[variant];
    this._clock = clock ?? (() => performance.now());

    this.root = new TransformNode(`${namePrefix}-root`, scene);
    this.visualRoot = new TransformNode(`${namePrefix}-visual-root`, scene);
    this.visualRoot.parent = this.root;

    this._bodyMaterial = this._makeMaterial(`${namePrefix}-material-body`, scene);
    this._accentMaterial = this._makeMaterial(`${namePrefix}-material-accent`, scene);
    this._visorMaterial = this._makeMaterial(`${namePrefix}-material-visor`, scene);
    this._applyPalette(this._base);

    // --- Animation pivots (presentation-only joint transforms) ------------
    // Spine at the waist: carries the torso, arms, head, and gear so the
    // upper body can bob / lean / dip as one unit.
    this._spinePivot = this._makePivot(`${namePrefix}-pivot-spine`, scene, 0, SPINE_BASE_Y, 0);
    // Hips: tops of the leg boxes (legs hang from the hip pivots).
    this._legLeftPivot = this._makePivot(
      `${namePrefix}-pivot-leg-left`,
      scene,
      -0.115,
      -0.34,
      0,
    );
    this._legRightPivot = this._makePivot(
      `${namePrefix}-pivot-leg-right`,
      scene,
      0.115,
      -0.34,
      0,
    );
    // Shoulders: tops of the arm boxes, in spine-local space.
    this._armLeftPivot = this._makePivot(
      `${namePrefix}-pivot-arm-left`,
      scene,
      -0.27,
      0.36,
      0,
      this._spinePivot,
    );
    this._armRightPivot = this._makePivot(
      `${namePrefix}-pivot-arm-right`,
      scene,
      0.27,
      0.36,
      0,
      this._spinePivot,
    );

    // --- Body layout (origin = capsule centre; feet at -0.9, top <= +0.9) --
    // Stylized BuildShift character: inverted-V silhouette with broad
    // shoulders, narrow legs, and a distinctive head crest. All meshes are
    // parented under joint pivots so the procedural pose can animate them.
    // Legs: narrow boxes for an athletic proportion.
    this._addMesh(
      this._box(`${namePrefix}-leg-left`, scene, 0.15, 0.56, 0.18),
      new Vector3(0, -0.28, 0),
      this._bodyMaterial,
      this._legLeftPivot,
    );
    this._addMesh(
      this._box(`${namePrefix}-leg-right`, scene, 0.15, 0.56, 0.18),
      new Vector3(0, -0.28, 0),
      this._bodyMaterial,
      this._legRightPivot,
    );
    // Pelvis: bridges the legs into the broader torso.
    this._addMesh(
      this._box(`${namePrefix}-pelvis`, scene, 0.30, 0.13, 0.20),
      new Vector3(0, -0.28, 0),
      this._bodyMaterial,
    );
    // Torso: broad shoulders create the inverted-V heroic silhouette.
    this._addMesh(
      this._box(`${namePrefix}-torso`, scene, 0.46, 0.54, 0.24),
      new Vector3(0, 0.24, 0),
      this._bodyMaterial,
      this._spinePivot,
    );
    // Arms: slightly thinner than the torso for contrast.
    this._addMesh(
      this._box(`${namePrefix}-arm-left`, scene, 0.10, 0.44, 0.13),
      new Vector3(0, -0.22, 0),
      this._bodyMaterial,
      this._armLeftPivot,
    );
    this._addMesh(
      this._box(`${namePrefix}-arm-right`, scene, 0.10, 0.44, 0.13),
      new Vector3(0, -0.22, 0),
      this._bodyMaterial,
      this._armRightPivot,
    );
    // Shoulder pads: pronounced accent blocks define the shoulder line.
    this._addMesh(
      this._box(`${namePrefix}-pad-left`, scene, 0.19, 0.11, 0.18),
      new Vector3(-0.26, 0.53, 0),
      this._accentMaterial,
      this._spinePivot,
    );
    this._addMesh(
      this._box(`${namePrefix}-pad-right`, scene, 0.19, 0.11, 0.18),
      new Vector3(0.26, 0.53, 0),
      this._accentMaterial,
      this._spinePivot,
    );
    // Head: low-segment sphere with flat shading for a faceted stylized look.
    const head = MeshBuilder.CreateSphere(
      `${namePrefix}-head`,
      { diameter: 0.32, segments: 6 },
      scene,
    );
    head.convertToFlatShadedMesh();
    this._addMesh(head, new Vector3(0, 0.66, 0), this._accentMaterial, this._spinePivot);
    // Visor: wide emissive strip on the -Z (forward) face of the head.
    // Primary orientation cue at match distance; tilts with aim pitch.
    this._visorMesh = this._box(`${namePrefix}-visor`, scene, 0.20, 0.055, 0.05);
    this._addMesh(
      this._visorMesh,
      new Vector3(0, 0.68, -0.15),
      this._visorMaterial,
      this._spinePivot,
    );
    // Head crest: small accent ridge on top for a distinctive silhouette.
    this._addMesh(
      this._box(`${namePrefix}-crest`, scene, 0.06, 0.04, 0.12),
      new Vector3(0, 0.84, 0),
      this._accentMaterial,
      this._spinePivot,
    );
    // Back pack: accent block on the +Z side for rear-facing readability.
    this._addMesh(
      this._box(`${namePrefix}-backpack`, scene, 0.19, 0.18, 0.09),
      new Vector3(0, 0.30, 0.17),
      this._accentMaterial,
      this._spinePivot,
    );

    // --- Procedural pose clock: one scene before-render observer ----------
    this._poseModel = new PlayerPoseModel();
    this._observer = this._scene.onBeforeRenderObservable.add(() =>
      this._tickFrame(),
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
    options: PlayerPresentationOptions = {},
  ): PlayerPresentation {
    return new PlayerPresentation(scene, variant, namePrefix, options.clock);
  }

  /** The owned forward-orientation visor mesh (for tests / debugging). */
  public get visorMesh(): Mesh {
    return this._visorMesh;
  }

  /** The owned body material (for tests / debugging). */
  public get bodyMaterial(): StandardMaterial {
    return this._bodyMaterial;
  }

  /** The owned spine (upper-body) animation pivot (for tests / debugging). */
  public get spinePivot(): TransformNode {
    return this._spinePivot;
  }

  /** True once {@link dispose} has run. */
  public get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * The current smoothed display pose (read-only; for tests / debugging).
   */
  public get pose(): Readonly<PlayerPose> {
    return this._poseModel.pose;
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
   *
   * The same canonical position stream also feeds the procedural pose's
   * kinematic estimate (visual-only; nothing gameplay is read or written
   * beyond this transform).
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
    // Display-state kinematics derived from the same canonical stream.
    this._poseModel.sample(position.x, position.y, position.z, this._clock());
  }

  /** Shows or hides every owned mesh (the root transform itself has no mesh). */
  public setEnabled(enabled: boolean): void {
    if (this._disposed) return;
    this._componentEnabled = enabled;
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
   * Idempotent teardown: removes the before-render observer, disposes every
   * owned mesh, material, and pivot, and the root transform. Safe to call
   * multiple times; afterwards all methods are no-ops.
   */
  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._scene.onBeforeRenderObservable.remove(this._observer);
    for (const mesh of this._meshes) {
      mesh.dispose();
    }
    for (const material of this._materials) {
      material.dispose();
    }
    for (const pivot of this._pivots) {
      pivot.dispose();
    }
    this.root.dispose();
  }

  // --- internals -----------------------------------------------------------

  private _makeMaterial(name: string, scene: Scene): StandardMaterial {
    const material = new StandardMaterial(name, scene);
    this._materials.push(material);
    return material;
  }

  private _makePivot(
    name: string,
    scene: Scene,
    x: number,
    y: number,
    z: number,
    parent: TransformNode = this.visualRoot,
  ): TransformNode {
    const pivot = new TransformNode(name, scene);
    pivot.parent = parent;
    pivot.position.set(x, y, z);
    this._pivots.push(pivot);
    return pivot;
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

  private _addMesh(
    mesh: Mesh,
    localPosition: Vector3,
    material: StandardMaterial,
    parent: TransformNode = this.visualRoot,
  ): void {
    // Presentation safety: never pickable, never a collision source.
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.material = material;
    mesh.parent = parent;
    mesh.position.copyFrom(localPosition);
    this._meshes.push(mesh);
  }

  /**
   * One render frame: derives the aim input from the existing canonical
   * state, advances the pose clock, and applies the pose to the
   * presentation meshes/pivots (never to the gameplay transforms).
   */
  private _tickFrame(): void {
    if (this._disposed) return;
    const nowMs = this._clock();
    const dt =
      this._lastFrameMs === null
        ? 0
        : Math.min(
            POSE.maxFrameDeltaSeconds,
            Math.max(0, (nowMs - this._lastFrameMs) / 1000),
          );
    this._lastFrameMs = nowMs;
    if (!this._componentEnabled) return;

    if (this._variant === "local") {
      // The local player's canonical aim is the active camera's direction —
      // the same source the runtime's AimController reads for firing.
      const camera = this._scene.activeCamera;
      if (camera) {
        camera.getDirectionToRef(this._cameraForward, this._aimDirection);
        const pitch = Math.asin(
          Math.min(1, Math.max(-1, this._aimDirection.y)),
        );
        this._poseModel.setAim(pitch, true);
      }
    } else {
      // Remote aim pitch is not replicated: the same pose logic runs with
      // the facing-neutral stance.
      this._poseModel.setAim(0, false);
    }

    this._poseModel.advance(dt);
    this._applyPose(this._poseModel.pose);
  }

  /**
   * Applies the smoothed pose to presentation meshes/pivots only. All
   * values are local-space presentation transforms below `visualRoot`;
   * `root` / `visualRoot` are untouched, so the animation cannot mutate
   * gameplay transforms.
   */
  private _applyPose(p: PlayerPose): void {
    const phase = p.walkPhase;
    const swing = Math.sin(phase);

    // --- Legs: grounded gait, blended to the jump tuck and the fall split --
    let legLeft = p.legSwing * swing;
    let legRight = -p.legSwing * swing;
    legLeft += (POSE.jumpTuckLeg[0] - legLeft) * p.jumpBlend;
    legRight += (POSE.jumpTuckLeg[1] - legRight) * p.jumpBlend;
    legLeft += (POSE.fallLeg[0] - legLeft) * p.fallBlend;
    legRight += (POSE.fallLeg[1] - legRight) * p.fallBlend;
    this._legLeftPivot.rotation.x = legLeft;
    this._legRightPivot.rotation.x = legRight;
    this._legLeftPivot.rotation.z = POSE.fallLegSpread[0] * p.fallBlend;
    this._legRightPivot.rotation.z = POSE.fallLegSpread[1] * p.fallBlend;

    // --- Arms: counter-swing + breath sway, then the pose overrides --------
    let armLeft = -p.armSwing * swing + POSE.idleArmSway * p.breath;
    let armRight = p.armSwing * swing - POSE.idleArmSway * p.breath;
    // Falling: arms fling up (only for the non-aiming body; the aiming body
    // keeps its weapon-ready stance).
    const fling = p.fallBlend * (1 - p.armRaise);
    armLeft += (POSE.fallArmX - armLeft) * fling;
    armRight += (POSE.fallArmX - armRight) * fling;
    // Weapon-aim stance: hands forward-up, tilted by the aim pitch, drawn
    // slightly together for a two-handed grip.
    const aimLeft = Math.min(
      POSE.aimArmXMax,
      Math.max(
        POSE.aimArmXMin,
        POSE.aimArmX[0] - p.aimPitch * POSE.aimArmPitchSensitivity,
      ),
    );
    const aimRight = Math.min(
      POSE.aimArmXMax,
      Math.max(
        POSE.aimArmXMin,
        POSE.aimArmX[1] - p.aimPitch * POSE.aimArmPitchSensitivity,
      ),
    );
    armLeft += (aimLeft - armLeft) * p.armRaise;
    armRight += (aimRight - armRight) * p.armRaise;
    this._armLeftPivot.rotation.x = armLeft;
    this._armRightPivot.rotation.x = armRight;
    this._armLeftPivot.rotation.z = POSE.aimArmGripZ[0] * p.armRaise;
    this._armRightPivot.rotation.z = POSE.aimArmGripZ[1] * p.armRaise;

    // --- Upper body: gait bob, landing dip, forward lean, aim lean ---------
    this._spinePivot.position.y =
      SPINE_BASE_Y +
      p.bob -
      p.landingDip * DEFAULT_PLAYER_POSE_CONFIG.maxLandingDipMeters;
    this._spinePivot.rotation.x =
      p.lean - p.aimPitch * POSE.aimSpineLean * p.armRaise;

    // --- Visor: tilts with the aim pitch so the look direction reads -------
    this._visorMesh.rotation.x = p.aimPitch * POSE.aimVisorPitch;
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
