import { PLAYER_MOVEMENT } from "@buildshift/game-config";
import { movementInputToWorld, stepHorizontalMovement } from "@buildshift/simulation";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { InputManager } from "../input/InputManager";

const PLAYER_HEIGHT = 1.8;

/**
 * Bridges shared movement rules to the local Babylon player representation.
 *
 * Movement is camera-relative: raw WASD (player-local input) is rotated by
 * the camera yaw with the shared `movementInputToWorld` math, then stepped
 * by the shared `stepHorizontalMovement`. The controller itself has no
 * camera dependency — it only receives the yaw in radians each update.
 *
 * Orientation: the player always faces the camera look direction
 * (player yaw = camera yaw). W runs forward, S walks backward while still
 * facing the aim direction, A/D strafe.
 */
export class PlayerController {
  private readonly mesh: AbstractMesh;
  private readonly material: StandardMaterial;
  private readonly forwardMarker: AbstractMesh;
  private disposed = false;

  public constructor(
    scene: Scene,
    private readonly input: InputManager,
  ) {
    this.material = new StandardMaterial("local-player-material", scene);
    this.material.diffuseColor = new Color3(0.25, 0.9, 0.48);
    this.material.emissiveColor = new Color3(0.02, 0.12, 0.05);

    this.mesh = MeshBuilder.CreateCapsule(
      "local-player",
      { height: PLAYER_HEIGHT, radius: 0.35, tessellation: 16 },
      scene,
    );
    this.mesh.material = this.material;
    this.mesh.position.set(0, PLAYER_HEIGHT / 2, 6);

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
   * Advances the player one frame. `cameraYawRadians` uses the shared
   * convention: yaw 0 faces -Z, positive yaw rotates toward +X.
   */
  public update(deltaSeconds: number, cameraYawRadians: number): void {
    const localInput = this.input.getMovementInput();
    const worldInput = movementInputToWorld(localInput, cameraYawRadians);

    const nextPosition = stepHorizontalMovement(
      { x: this.mesh.position.x, z: this.mesh.position.z },
      worldInput,
      deltaSeconds,
      PLAYER_MOVEMENT,
    );

    this.mesh.position.x = nextPosition.x;
    this.mesh.position.z = nextPosition.z;

    // Face the camera look direction (Babylon Y rotation: 0 = -Z, positive
    // rotates toward +X — the same convention as the movement math).
    this.mesh.rotation.y = cameraYawRadians;
  }

  /** Feet position (a cloned Vector3; safe to mutate by the caller). */
  public getPosition(): Vector3 {
    return this.mesh.position.clone();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.forwardMarker.dispose();
    this.mesh.dispose();
    this.material.dispose();
    this.disposed = true;
  }
}

