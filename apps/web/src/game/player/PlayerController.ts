import {
  JUMP_INPUT_TIMING,
  PLAYER_COLLIDER,
  PLAYER_COLLIDER_HALF_TOTAL_HEIGHT,
  PLAYER_COLLIDER_TOTAL_HEIGHT,
  PLAYER_PHYSICS,
} from "@buildshift/game-config";
import {
  JumpController,
  stepVerticalMovement,
} from "@buildshift/simulation";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { computePredictionTranslation } from "./predictionMovement";

/**
 * The local (Stage 1) player: a visible capsule plus a small marker showing
 * the forward direction.
 *
 * From Stage 1D on this controller is *presentation only*. It no longer owns
 * the position — the Rapier character controller (via {@link PhysicsWorld})
 * is the collision/physics authority. Each fixed step the player builds a
 * desired translation from the shared deterministic movement math
 * (`movementInputToWorld` + `stepVerticalMovement`) — the same math the future
 * simulation server will use — feeds it to the physics world, then mirrors the
 * character body's resulting translation onto the mesh.
 *
 * Movement is camera-relative: raw WASD is rotated by the camera yaw into a
 * desired world X/Z displacement; vertical velocity is integrated (gravity).
 *
 * Jump timing (buffer + coyote) is owned by the shared, platform-independent
 * {@link JumpController} so the same deterministic rule the client uses for
 * prediction will be reusable by the authoritative server. The controller is
 * advanced only by fixed substeps (never per render frame), so it is
 * frame-rate safe. It is driven by an EXPLICIT prediction sample supplied by
 * the fixed-step runtime — the controller itself never reads browser input.
 *
 * Orientation: the player always faces the camera look direction (player yaw
 * = camera yaw).
 */
/**
 * Explicit prediction input for one local physics substep. The runtime
 * captures this from the live browser input once per prediction batch and
 * reuses it for the batch's two substeps — the controller never polls the
 * `InputManager` itself, which is what makes this step replayable.
 */
export interface PlayerPredictionInput {
  moveX: number;
  moveZ: number;
  lookYaw: number;
  jumpPressed: boolean;
}

export class PlayerController {
  private readonly mesh: AbstractMesh;
  private readonly material: StandardMaterial;
  private readonly forwardMarker: AbstractMesh;
  private readonly physics: PhysicsWorld;
  /** Owns the jump-buffer / coyote-time timing and the launch decision. */
  private readonly jumpController: JumpController;
  /** Vertical (world-Y) velocity in m/s, carried between fixed steps. */
  private verticalVelocity = 0;
  /** Grounded from the previous fixed step — used for jump eligibility. */
  private lastGrounded = true;
  private disposed = false;

  /**
   * Creates the player, initialising the Rapier physics world first (an async
   * step for the compat WASM build) so the mesh can be spawned exactly where
   * the physics world says the character is (capsule centre = PLAYER_SPAWN).
   */
  public static async create(scene: Scene): Promise<PlayerController> {
    const physics = await PhysicsWorld.create();
    return new PlayerController(scene, physics);
  }

  private constructor(scene: Scene, physics: PhysicsWorld) {
    this.physics = physics;
    this.jumpController = new JumpController(JUMP_INPUT_TIMING);

    this.material = new StandardMaterial("local-player-material", scene);
    this.material.diffuseColor = new Color3(0.25, 0.9, 0.48);
    this.material.emissiveColor = new Color3(0.02, 0.12, 0.05);

    this.mesh = MeshBuilder.CreateCapsule(
      "local-player",
      {
        height: PLAYER_COLLIDER_TOTAL_HEIGHT,
        radius: PLAYER_COLLIDER.radius,
        tessellation: 16,
      },
      scene,
    );
    this.mesh.material = this.material;
    const center = this.physics.getPosition();
    this.mesh.position.set(center.x, center.y, center.z);

    // Small visual forward indicator on the otherwise symmetric capsule:
    // a thin box on the chest, offset 0.35 m forward (Babylon -Z local).
    const markerMaterial = new StandardMaterial(
      "local-player-forward-marker",
      scene,
    );
    markerMaterial.diffuseColor = new Color3(0.95, 0.95, 0.95);
    markerMaterial.emissiveColor = new Color3(0.25, 0.25, 0.25);

    this.forwardMarker = MeshBuilder.CreateBox(
      "local-player-forward-marker",
      { width: 0.22, height: 0.08, depth: 0.06 },
      scene,
    );
    this.forwardMarker.material = markerMaterial;
    this.forwardMarker.parent = this.mesh;
    this.forwardMarker.position.set(0, 0.2, -0.35);
  }

  /**
   * Advances the player by one fixed physics substep (`deltaSeconds`).
   *
   * The explicit prediction input is turned into a *desired* translation and
   * fed to the physics world, which resolves it against the arena colliders.
   * The mesh is then mirrored to the character body's resulting translation.
   *
   * The controller never reads browser input: it is driven by an EXPLICIT
   * prediction sample (movement axes, facing yaw, and one jump edge) so the
   * same step is replayable from historical samples (Stage 2C2B).
   * `input.lookYaw` uses the shared convention: yaw 0 faces -Z, positive yaw
   * rotates toward +X.
   *
   * Named `step` (not `update`) because it satisfies the {@link
   * PredictionSimulation} boundary that the prediction loop drives per
   * substep; it is never called per render frame.
   */
  public step(deltaSeconds: number, input: PlayerPredictionInput): void {
    // --- Horizontal: camera-relative desired world displacement ----------
    // Pure, shared-math translation from the EXPLICIT intent (the same math
    // the authoritative server uses); see `computePredictionTranslation`.
    const { x: dx, z: dz } = computePredictionTranslation(input, deltaSeconds);

    // --- Jump timing: buffer + coyote, decide the launch for this step ----
    const jumpRequested = this.jumpController.step(
      deltaSeconds,
      this.lastGrounded,
      input.jumpPressed,
    );

    // --- Vertical: integrate gravity; launch at jump speed when requested -
    const nextVelocity = stepVerticalMovement(
      this.verticalVelocity,
      jumpRequested,
      this.lastGrounded,
      deltaSeconds,
      PLAYER_PHYSICS,
    );
    const dy = nextVelocity * deltaSeconds;

    // --- Physics: resolve the desired translation against the arena ------
    const grounded = this.physics.step({ x: dx, y: dy, z: dz });
    this.verticalVelocity = nextVelocity;
    this.lastGrounded = grounded;

    // --- Presentation: mirror the physics position onto the mesh ---------
    const center = this.physics.getPosition();
    this.mesh.position.set(center.x, center.y, center.z);

    // Face the camera look direction (Babylon Y rotation: 0 = -Z, positive
    // rotates toward +X — the same convention as the movement math).
    this.mesh.rotation.y = input.lookYaw;
  }

  /**
   * Clears the buffered jump / coyote timing. The runtime calls this when
   * input is cleared (pointer lock released, window blurred, or tab hidden)
   * so a stale buffered press can never fire on a later grounded step.
   */
  public resetJumpState(): void {
    this.jumpController.reset();
  }

  /** Capsule *centre* position (the physics body translation), as a Vector3. */
  public getCenterPosition(): Vector3 {
    return new Vector3(
      this.mesh.position.x,
      this.mesh.position.y,
      this.mesh.position.z,
    );
  }

  /**
   * Capsule *feet* position (centre lowered by half the collider height), as a
   * Vector3. This is the value the camera should track (see the camera's
   * "feet + target height" contract). It is derived presentation / physics
   * data; the authoritative network position is the capsule centre.
   */
  public getFeetPosition(): Vector3 {
    return new Vector3(
      this.mesh.position.x,
      this.mesh.position.y - PLAYER_COLLIDER_HALF_TOTAL_HEIGHT,
      this.mesh.position.z,
    );
  }

  /**
   * Backwards-compatible alias. Returns the *centre* position — the same
   * value the physics body reports — so callers wanting the body position are
   * unambiguous. Use {@link getFeetPosition} for the on-ground point.
   */
  public getPosition(): Vector3 {
    return this.getCenterPosition();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.forwardMarker.dispose();
    this.mesh.dispose();
    this.material.dispose();
    this.physics.dispose();
    this.disposed = true;
  }
}

