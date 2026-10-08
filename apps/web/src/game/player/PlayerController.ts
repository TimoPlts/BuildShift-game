import {
  JUMP_INPUT_TIMING,
  PLAYER_COLLIDER_HALF_TOTAL_HEIGHT,
  PLAYER_PHYSICS,
} from "@buildshift/game-config";
import {
  JumpController,
  stepVerticalMovement,
} from "@buildshift/simulation";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { SubstepInput } from "./substepInput";
import type { PredictionState } from "./predictionState";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { computePredictionTranslation } from "./predictionMovement";
import { PlayerPresentation } from "../scene/PlayerPresentation";

/**
 * The local (Stage 1) player: a stylized low-poly body (see
 * {@link PlayerPresentation}) whose root transform mirrors the physics
 * position and facing yaw.
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
  /** Owns every visual mesh/material of the local player body. */
  private readonly presentation: PlayerPresentation;
  /**
   * Presentation root (transform only, no geometry). Its position is the
   * mirrored capsule-centre position. Its Y rotation is the NEGATED facing
   * yaw (Babylon's node Y-rotation turns local -Z toward -X for positive
   * angles, while the shared movement convention turns forward toward +X).
   * The prediction state always stores the shared-convention yaw.
   */
  private readonly mesh: TransformNode;
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

    // Presentation only: the modular low-poly body (green "local" variant).
    // Its root starts exactly where the physics world says the character is
    // (capsule centre = PLAYER_SPAWN).
    this.presentation = PlayerPresentation.create(scene, "local", "local-player");
    this.mesh = this.presentation.root;
    const center = this.physics.getPosition();
    this.mesh.position.set(center.x, center.y, center.z);
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

    // Face the camera look direction. The shared convention is yaw 0 = -Z,
    // positive toward +X; the Babylon root rotation is negated (see the
    // mesh field docs) so the body's front faces the movement forward.
    this.mesh.rotation.y = -lookYawRadians;
  }

  /**
   * Sets the mesh position and rotation directly, bypassing the physics
   * world entirely. Used by the Stage 2D multiplayer prediction system
   * which drives the local player mesh from the shared deterministic
   * `stepFullMovement` state (not from Rapier physics).
   *
   * This does NOT update the Rapier body — in the multiplayer mode the
   * physics world is inert (no `step()` calls are made).
   */
  public setMeshTransform(
    position: Readonly<{ x: number; y: number; z: number }>,
    yaw: number,
  ): void {
    this.mesh.position.set(position.x, position.y, position.z);
    this.mesh.rotation.y = -yaw;
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
      // The mesh rotation is the negated yaw (Babylon convention); the
      // prediction state stores the shared-movement yaw.
      facingYaw: -this.mesh.rotation.y,
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
    // Presentation mirror: mesh position + facing yaw (negated for the
    // Babylon root rotation — see the mesh field docs).
    this.mesh.position.set(
      state.position.x,
      state.position.y,
      state.position.z,
    );
    this.mesh.rotation.y = -state.facingYaw;
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
    this.mesh.rotation.y = -yaw;
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

    this.presentation.dispose();
    this.physics.dispose();
    this.disposed = true;
  }
}
