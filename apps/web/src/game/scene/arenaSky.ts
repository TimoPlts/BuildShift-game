/**
 * Sky/background presentation module for the BuildShift Box Fight room.
 *
 * The arena is now an enclosed clean room, so this module only sets the
 * deep-navy scene clear color (from `ARENA_PALETTE.skyColor`) and keeps a
 * large inverted fallback dome (`arena-skybox`, subtly darker navy, unlit,
 * fog-exempt) so that even if the third-person camera ever clips through a
 * wall it sees a calm dark backdrop instead of a bright outdoor sky.
 *
 * Atmospheric fog is DISABLED: the room is only 30 m across and the user
 * requires an uninterrupted, crisp polished floor — fog would haze the far
 * wall and floor without adding depth.
 *
 * The sky is purely presentational: no picking, no collisions.
 * No external textures or assets are used — the dome is a single primitive
 * with a flat emissive color.
 */
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { ARENA_PALETTE } from "./arena";

/** Diameter of the fallback dome — large enough to never be visible from
 *  any in-arena camera position. */
const SKYBOX_DIAMETER = 500;

/** Multiplier applied to the palette background color to make the dome
 *  surface subtly darker than the clear color. */
const SKYBOX_TINT_FACTOR = 0.85;

/**
 * Configures the room background on the given scene:
 *  1. Sets `scene.clearColor` from `ARENA_PALETTE.skyColor` (deep navy).
 *  2. Disables fog — the enclosed clean room is rendered crisp.
 *  3. Creates an inverted sphere named `arena-skybox` with an unlit
 *     StandardMaterial whose emissive color is a slightly darker tint of
 *     the background color. The dome is fog-exempt.
 *  4. Marks the mesh non-pickable and non-collidable (background-only).
 */
export function setupArenaSky(scene: Scene): void {
  const sky = ARENA_PALETTE.skyColor;

  // 1. Scene background.
  scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);

  // 2. No fog inside the enclosed room.
  scene.fogMode = Scene.FOGMODE_NONE;

  // 3. Inverted fallback dome.
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
  material.fogEnabled = false; // dome never fogs (the scene isn't fogged anyway)
  skybox.material = material;

  // 4. Background-only flags.
  skybox.isPickable = false;
  skybox.checkCollisions = false;
}
