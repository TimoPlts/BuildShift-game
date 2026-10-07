/**
 * Independent sky presentation module for the BuildShift arena.
 *
 * Sets the scene clear color from `ARENA_PALETTE.skyColor` and adds a large
 * inverted sphere (`arena-skybox`) with a subtly darker emissive-unlit
 * StandardMaterial so the dome reads as a gentle atmospheric tint over the
 * background. The skybox is purely presentational: no picking, no collisions.
 *
 * No external textures or assets are used — the dome is a single primitive
 * with a flat emissive color.
 */
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { ARENA_PALETTE } from "./arena";

/** Diameter of the skybox sphere — large enough to never be visible from any
 *  in-arena camera position. */
const SKYBOX_DIAMETER = 500;

/** Multiplier applied to the palette sky color to make the dome surface
 *  subtly darker than the background clear color. */
const SKYBOX_TINT_FACTOR = 0.85;

/**
 * Configures the arena sky on the given scene:
 *  1. Sets `scene.clearColor` from `ARENA_PALETTE.skyColor`.
 *  2. Creates an inverted sphere named `arena-skybox` with an unlit
 *     StandardMaterial whose emissive color is a slightly darker tint of
 *     the sky color.
 *  3. Marks the mesh non-pickable and non-collidable (background-only).
 */
export function setupArenaSky(scene: Scene): void {
  const sky = ARENA_PALETTE.skyColor;

  // 1. Scene background.
  scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);

  // 2. Inverted sphere dome.
  const skybox = MeshBuilder.CreateSphere(
    "arena-skybox",
    { diameter: SKYBOX_DIAMETER, segments: 16 },
    scene,
  );

  const tint = sky.scale(SKYBOX_TINT_FACTOR);
  const material = new StandardMaterial("arena-skybox-material", scene);
  material.emissiveColor = tint;
  material.disableLighting = true; // unlit — only emissive contributes
  material.specularColor = new Color3(0, 0, 0);
  material.sideOrientation = Mesh.BACKSIDE; // render interior faces
  skybox.material = material;

  // 3. Background-only flags.
  skybox.isPickable = false;
  skybox.checkCollisions = false;
}
