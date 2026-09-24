import type { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { ARENA, type ArenaObject } from "./arena";

/**
 * Creates the foundation scene: lighting plus the arena geometry.
 *
 * From Stage 1D on every visible object is built from the single-source
 * `ARENA` table (shared with the physics layer), so the meshes and the
 * colliders can never drift apart: each mesh is a box of
 * `2 * halfExtents` centred at `position`. The scene factory no longer owns
 * any camera — the gameplay camera is created by
 * `ThirdPersonCameraController`, which makes it the scene's active camera.
 *
 * Stage 1E adds a modest set of physics-playground obstacles (slide corridor,
 * low block, jump platform) to the `ARENA` table; they are rendered exactly
 * like the reference geometry because the table is the single source of
 * truth for both visuals and colliders.
 */
export function createFoundationScene(engine: Engine): Scene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.055, 0.07, 0.1, 1);

  const light = new HemisphericLight(
    "foundation-light",
    new Vector3(0.25, 1, 0.2),
    scene,
  );
  light.intensity = 0.9;
  light.groundColor = new Color3(0.08, 0.1, 0.14);

  for (const object of ARENA) {
    buildArenaObject(scene, object);
  }

  return scene;
}

function buildArenaObject(scene: Scene, object: ArenaObject): void {
  const material = getMaterial(scene, object.material);
  const [px, py, pz] = object.collider.position;
  const [hx, hy, hz] = object.collider.halfExtents;

  const mesh = MeshBuilder.CreateBox(
    object.id,
    { width: hx * 2, height: hy * 2, depth: hz * 2 },
    scene,
  );
  mesh.position = new Vector3(px, py, pz);
  mesh.material = material;
}

/** Creates (or reuses) the shared material for an arena material kind. */
function getMaterial(scene: Scene, kind: ArenaObject["material"]): StandardMaterial {
  const existing = scene.getMaterialByName(`${kind}-material`);
  if (existing instanceof StandardMaterial) {
    return existing;
  }

  const material = new StandardMaterial(`${kind}-material`, scene);
  switch (kind) {
    case "ground":
      material.diffuseColor = new Color3(0.18, 0.23, 0.3);
      material.specularColor = new Color3(0.04, 0.05, 0.07);
      break;
    case "accent":
      material.diffuseColor = new Color3(0.12, 0.55, 0.78);
      break;
    case "neutral":
      // Muted grey-blue used by the Stage 1E test obstacles so they read as
      // "test furniture" rather than the accent/warm reference geometry.
      material.diffuseColor = new Color3(0.42, 0.47, 0.55);
      break;
    case "warm":
      material.diffuseColor = new Color3(0.92, 0.48, 0.18);
      break;
  }
  return material;
}
