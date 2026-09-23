import type { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";

/**
 * Creates the foundation scene: ground, lighting, and temporary arena
 * geometry. The scene factory no longer owns any camera — the gameplay
 * camera is created by `ThirdPersonCameraController`, which makes it the
 * scene's active camera (exactly one active gameplay camera).
 */
export function createFoundationScene(
  engine: Engine,
): Scene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.055, 0.07, 0.1, 1);

  const light = new HemisphericLight(
    "foundation-light",
    new Vector3(0.25, 1, 0.2),
    scene,
  );
  light.intensity = 0.9;
  light.groundColor = new Color3(0.08, 0.1, 0.14);

  const groundMaterial = new StandardMaterial("ground-material", scene);
  groundMaterial.diffuseColor = new Color3(0.18, 0.23, 0.3);
  groundMaterial.specularColor = new Color3(0.04, 0.05, 0.07);

  const accentMaterial = new StandardMaterial("accent-material", scene);
  accentMaterial.diffuseColor = new Color3(0.12, 0.55, 0.78);

  const warmMaterial = new StandardMaterial("warm-material", scene);
  warmMaterial.diffuseColor = new Color3(0.92, 0.48, 0.18);

  const ground = MeshBuilder.CreateGround(
    "foundation-ground",
    { width: 30, height: 30 },
    scene,
  );
  ground.material = groundMaterial;

  const centerBox = MeshBuilder.CreateBox("center-box", { size: 2.5 }, scene);
  centerBox.position = new Vector3(0, 1.25, 0);
  centerBox.material = accentMaterial;

  const platform = MeshBuilder.CreateBox(
    "reference-platform",
    { width: 7, height: 0.5, depth: 4 },
    scene,
  );
  platform.position = new Vector3(-5, 0.25, 4);
  platform.material = warmMaterial;

  const tallBox = MeshBuilder.CreateBox(
    "reference-tower",
    { width: 1.5, height: 5, depth: 1.5 },
    scene,
  );
  tallBox.position = new Vector3(5, 2.5, -3);
  tallBox.material = accentMaterial;

  return scene;
}
