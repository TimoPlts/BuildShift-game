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
import type { SubstepInput } from "../network/inputBatcher";
import type { PredictionState } from "../network/predictionState";
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
 * (`movementInputToWorld` + `stepVerticalMovement`) — the same math the
 * authoritative simulation server will use — feeds it to the physics world,
 * then mirrors the character body's resulting translation onto the mesh.
 *
 * Deterministic explicit input (Stage 2C2A): this controller no longer reads
 * the browser. It simulates purely from the {@link SubstepInput} the runtime
 * hands it — one sample shared by a two-substep prediction batch. That is what
 * makes historical replay possible (replay feeds recorded inputs, never the
 * live keyboard). Movement is camera-relative: the local X/Z axes are rotated
 * by the batch's captured yaw into a desired world displacement; vertical
 * velocity is integrated (gravity).
 *
 * Jump timing (buffer + coyote) is owned by the shared, platform-independent
 * {@link JumpController} so the same deterministic rule the client uses for
 * prediction will be reusable by the authoritative server. The controller is
 * advanced only by fixed steps (never per render frame), so it is
 * frame-rate safe.
 *
 * Orientation: the player always faces the camera look direction (player yaw
 * = camera yaw).
 */
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
   * Advances the player by one fixed physics step (`deltaSeconds`) using the
   * explicit simulation input supplied by the runtime.
   *
   * The camera-relative local axes are turned into a *desired* world
   * translation and fed to the physics world, which resolves it against the
   * arena colliders. The mesh is then mirrored to the character body's
   * resulting translation.
   *
   * `simulationInput` is the per-substep slice of the prediction batch (see
   * {@link SubstepInput}). `moveX` / `moveZ` are the captured local axes,
   * `lookYawRadians` the batch's captured yaw, and `jumpPressed` the jump edge
   * for THIS substep only (the runtime forces it false on the batch's second
   * substep so a late press is never consumed mid-batch). It is handed to the
   * shared {@link JumpController}, which applies jump-buffer + coyote-time and
   * decides whether a jump launches on this step.
   *
   * `lookYawRadians` uses the shared convention: yaw 0 faces -Z, positive yaw
   * rotates toward +X.
   */
  public update(
    deltaSeconds: number,
    simulationInput: Readonly<SubstepInput>,
  ): void {
    const { moveX, moveZ, lookYaw: lookYawRadians, jumpPressed } =
      simulationInput;

    // --- Horizontal: camera-relative desired world displacement ----------
    // Pure, shared-math translation from the EXPLICIT intent (the same math the
    // authoritative server uses); see `computePredictionTranslation`.
    const { x: dx, z: dz } = computePredictionTranslation(
      { moveX, moveZ, lookYaw: lookYawRadians },
      deltaSeconds,
    );

    // --- Jump timing: buffer + coyote, decide the launch for this step ----
    const jumpRequested = this.jumpController.step(
      deltaSeconds,
      this.lastGrounded,
      jumpPressed,
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
    this.mesh.rotation.y = lookYawRadians;
  }

  /**
   * Captures the complete local prediction state as a plain-data
   * {@link PredictionState} (Stage 2C2B reconciliation checkpoint).
   *
   * Everything is a *value* copy — the physics position, vertical velocity,
   * lagged grounded flag, the shared {@link JumpController} timing snapshot,
   * and the current facing yaw (read from the mesh's Y rotation). The returned
   * object holds no references into this controller, so later simulation can
   * never mutate a stored checkpoint.
   */
  public capturePredictionState(): PredictionState {
    const center = this.physics.getPosition();
    return {
      position: { x: center.x, y: center.y, z: center.z },
      verticalVelocity: this.verticalVelocity,
      lastGrounded: this.lastGrounded,
      jump: this.jumpController.captureState(),
      facingYaw: this.mesh.rotation.y,
    };
  }

  /**
   * Restores the complete local prediction state from a previously captured
   * {@link PredictionState}. After this call:
   *
   * - the physics capsule-centre position equals `state.position`
   * - the mesh position equals `state.position`
   * - the mesh facing yaw equals `state.facingYaw`
   *
   * The vertical velocity, lagged grounded flag, and the shared
   * {@link JumpController} timing are also restored, so deterministic
   * simulation resumes exactly from the checkpoint.
   */
  public restorePredictionState(state: Readonly<PredictionState>): void {
    this.physics.setPosition(state.position);
    this.verticalVelocity = state.verticalVelocity;
    this.lastGrounded = state.lastGrounded;
    this.jumpController.restoreState(state.jump);
    // Presentation mirror: mesh position + facing yaw.
    this.mesh.position.set(
      state.position.x,
      state.position.y,
      state.position.z,
    );
    this.mesh.rotation.y = state.facingYaw;
  }

  /**
   * Narrow server-authoritative override: sets ONLY the position (physics
   * capsule centre + mesh) and the facing yaw. It deliberately does NOT touch
   * `verticalVelocity`, `lastGrounded`, or the {@link JumpController} timing.
   *
   * Reconciliation first restores the local deterministic checkpoint at ack N
   * (via {@link restorePredictionState}), then applies only the
   * server-authoritative position + yaw on top — the remaining deterministic
   * state stays as the client checkpoint (docs/TECHNICAL_ARCHITECTURE.md §18).
   */
  public setAuthoritativePosition(
    position: Readonly<{ x: number; y: number; z: number }>,
    yaw: number,
  ): void {
    this.physics.setPosition(position);
    this.mesh.position.set(position.x, position.y, position.z);
    this.mesh.rotation.y = yaw;
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

