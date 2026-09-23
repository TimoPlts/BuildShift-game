import { PLAYER_MOVEMENT } from "@buildshift/game-config";
import { stepHorizontalMovement } from "@buildshift/simulation";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { InputManager } from "../input/InputManager";

const PLAYER_HEIGHT = 1.8;

/** Bridges shared movement rules to the local Babylon player representation. */
export class PlayerController {
  private readonly mesh: AbstractMesh;
  private readonly material: StandardMaterial;
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
  }

  public update(deltaSeconds: number): void {
    const nextPosition = stepHorizontalMovement(
      { x: this.mesh.position.x, z: this.mesh.position.z },
      this.input.getMovementInput(),
      deltaSeconds,
      PLAYER_MOVEMENT,
    );

    this.mesh.position.x = nextPosition.x;
    this.mesh.position.z = nextPosition.z;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.mesh.dispose();
    this.material.dispose();
    this.disposed = true;
  }
}
