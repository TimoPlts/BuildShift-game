import {
  JUMP_INPUT_TIMING,
  PLAYER_MOVEMENT,
  PLAYER_PHYSICS,
} from "@buildshift/game-config";
import {
  JumpController,
  movementInputToWorld,
  stepVerticalMovement,
} from "@buildshift/simulation";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { InputManager } from "../input/InputManager";
import {
  CHARACTER_HEIGHT_OVER_2,
  PhysicsWorld,
} from "../physics/PhysicsWorld";

const PLAYER_HEIGHT = 1.8;

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
 * advanced only by fixed steps (never per render frame), so it is
 * frame-rate safe and the jump edge is polled *inside* the fixed-step loop —
 * guaranteeing a press always reaches a step and can't be lost.
 *
 * Orientation: the player always faces the camera look direction (player yaw
 * = camera yaw).
 */
export class PlayerController {
  private readonly mesh: AbstractMesh;
  private readonly material: StandardMaterial;
  private readonly forwardMarker: AbstractMesh;
  private readonly physics: PhysicsWorld;
  private readonly input: InputManager;
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
  public static async create(
    scene: Scene,
    input: InputManager,
  ): Promise<PlayerController> {
    const physics = await PhysicsWorld.create();
    return new PlayerController(scene, input, physics);
  }

  private constructor(
    scene: Scene,
    input: InputManager,
    physics: PhysicsWorld,
  ) {
    this.input = input;
    this.physics = physics;
    this.jumpController = new JumpController(JUMP_INPUT_TIMING);

    this.material = new StandardMaterial("local-player-material", scene);
    this.material.diffuseColor = new Color3(0.25, 0.9, 0.48);
    this.material.emissiveColor = new Color3(0.02, 0.12, 0.05);

    this.mesh = MeshBuilder.CreateCapsule(
      "local-player",
      { height: PLAYER_HEIGHT, radius: 0.35, tessellation: 16 },
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
   * Advances the player by one fixed physics step (`deltaSeconds`).
   *
   * The camera-relative input is turned into a *desired* translation and fed
   * to the physics world, which resolves it against the arena colliders. The
   * mesh is then mirrored to the character body's resulting translation.
   *
   * The jump key edge is **polled here, per fixed step** (not per render
   * frame) and handed to the shared {@link JumpController}, which applies
   * jump-buffer + coyote-time and decides whether a jump launches on this
   * step. Polling inside the step is what guarantees a press can never be
   * consumed without a simulation step actually running.
   * `cameraYawRadians` uses the shared convention: yaw 0 faces -Z, positive
   * yaw rotates toward +X.
   */
  public update(deltaSeconds: number, cameraYawRadians: number): void {
    // --- Horizontal: camera-relative desired world displacement ----------
    const localInput = this.input.getMovementInput();
    const worldInput = movementInputToWorld(localInput, cameraYawRadians);
    const inputLength = Math.hypot(worldInput.x, worldInput.z);
    const normalization = inputLength > 1 ? 1 / inputLength : 1;
    const distance = PLAYER_MOVEMENT.moveSpeed * deltaSeconds;
    const dx = worldInput.x * normalization * distance;
    const dz = worldInput.z * normalization * distance;

    // --- Jump timing: buffer + coyote, decide the launch for this step ----
    // Poll the raw edge now (per step) and let the shared controller decide.
    const jumpPressed = this.input.pollJumpPressed();
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
    this.mesh.rotation.y = cameraYawRadians;
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
   * "feet + target height" contract) and the value that should be synced to
   * the future server.
   */
  public getFeetPosition(): Vector3 {
    return new Vector3(
      this.mesh.position.x,
      this.mesh.position.y - CHARACTER_HEIGHT_OVER_2,
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

