/**
 * Clean Box Fight room shell — decorative geometry for the BuildShift 1v1
 * arena, derived from the validated build scale (shared `BUILD_GRID` /
 * `BUILD_BOUNDS`) and the shared `ARENA_COLLIDERS` ground entry.
 *
 * The room is a cohesive enclosed interior, modelled on a tidy competitive
 * "box fight" room rather than an outdoor physics-test playground:
 *
 *  - Four pale-blue perimeter wall panels (`arena-shell-n/s/e/w`) forming
 *    the indestructible arena shell, sized from the ground slab footprint
 *    and rising exactly to the ceiling underside so the room encloses.
 *  - Warm brass cap trim along the top of each wall (`arena-shell-cap-*`).
 *  - A single enclosed ceiling slab (`arena-ceiling`) spanning the room at
 *    the derived ceiling height — ABOVE the maximum legal build height by a
 *    clearance derived from the real third-person orbit camera plus shared
 *    jump physics, so the camera stays under the ceiling even when a jumping
 *    player on the highest legal build looks straight down. Building
 *    heights are unchanged.
 *
 * What was REMOVED (user requirement — the floor must stay clean):
 *  - the raised play-field plate,
 *  - all floor build-grid lines (no squares/lattice on the ground),
 *  - the neon spawn pads, start-line bars, and every cyan accent.
 *
 * All boundary dimensions are derived from the shared `ARENA_COLLIDERS`
 * ground entry and the shared build grid — never duplicated or modified.
 * No gameplay geometry, spawn positions, collision bodies, camera rules, or
 * networking state are created or altered here.
 *
 * Performance: 9 static boxes total in this module, 3 shared materials
 * (exported through the `ensure*` helpers so the environment/spawn-zone
 * layers reuse them). No per-frame work, no textures.
 */
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import {
  ARENA_COLLIDERS,
  BUILD_BOUNDS,
  BUILD_GRID,
  PLAYER_PHYSICS,
} from "@buildshift/game-config";
import { THIRD_PERSON_CAMERA } from "../camera/cameraConfig";
import { AIM_EYE_HEIGHT_STANDING } from "../aim/authoritativeAim";
import { ARENA_PALETTE } from "./arena";

/** Stable id of the ground collider from which we derive the arena boundary. */
const GROUND_ID = "foundation-ground";

/** Thickness (metres) of each shell wall — solid, not a thin sheet. */
const SHELL_THICKNESS = 0.3;

/** Height (metres) of the brass cap strip sitting on top of each wall. */
const SHELL_CAP_HEIGHT = 0.1;

/**
 * Extra safety (metres) added on top of the derived third-person camera
 * clearance, covering transient presentation nudges (recoil pitch, camera
 * motion dips) beyond the conservative orbit bound.
 */
const CEILING_SAFETY = 1.0;

/**
 * Shared jump apex (metres) above the feet: v² / (2|g|) from the shared
 * `PLAYER_PHYSICS` (jumpSpeed 9, gravity −25 → 1.62 m).
 */
export function jumpApexHeight(): number {
  return (
    (PLAYER_PHYSICS.jumpSpeed * PLAYER_PHYSICS.jumpSpeed) /
    (2 * Math.abs(PLAYER_PHYSICS.gravity))
  );
}

/**
 * Conservative vertical clearance (metres) needed above the top legal build
 * so the third-person camera stays below the ceiling.
 *
 * Derived from the REAL camera formula in `ThirdPersonCameraController`
 * (centred-aim line-sharing camera): cameraY = eyeY − t·sin(pitch) with
 * eyeY = feet + standing eye height and t ≤ `distance` along the line
 * (recoil kickback and the floor guard only ever shrink the upward extent).
 * Looking down at the −60° clamp raises the camera by at most
 * distance·sin 60° ≈ 4.5 m above the eye; using the FULL `distance` also
 * absorbs the along-line bob/kickback projection. Adding the shared jump
 * apex and a small safety margin bounds the worst case: a player standing on
 * the highest legal build, jumping, looking straight down.
 */
export function ceilingCameraClearance(): number {
  return (
    THIRD_PERSON_CAMERA.distance +
    AIM_EYE_HEIGHT_STANDING +
    jumpApexHeight() +
    CEILING_SAFETY
  );
}

/** Thickness (metres) of the ceiling slab. */
const CEILING_THICKNESS = 0.2;

/**
 * The world-space top of the build volume (top of the highest legal layer).
 */
export function maxBuildHeight(): number {
  return (
    (BUILD_BOUNDS.maxLayer - BUILD_BOUNDS.minLayer + 1) * BUILD_GRID.layerHeight
  );
}

/**
 * The underside height of the enclosed ceiling — the maximum legal build
 * height plus the derived third-person camera clearance, so even a jumping
 * player on the highest legal build looking straight down keeps the camera
 * below the ceiling. Building is NOT capped at this height; the ceiling
 * simply encloses the room far above anything a player can legally place.
 */
export function ceilingHeight(): number {
  return maxBuildHeight() + ceilingCameraClearance();
}

/**
 * The interior height of the perimeter shell walls — equal to the ceiling
 * underside so the room actually encloses from the inside (no horizontal
 * gap between wall tops and ceiling). Exported so the environment layer
 * frames the walls at exactly the same height.
 */
export function shellWallHeight(): number {
  return ceilingHeight();
}

/**
 * Creates (or reuses) the shared pale-blue wall-panel material so dependent
 * decoration modules never duplicate it.
 */
export function ensureWallPanelMaterial(scene: Scene): StandardMaterial {
  const existing = scene.getMaterialByName("arena-wall-material");
  if (existing instanceof StandardMaterial) {
    return existing;
  }
  const material = new StandardMaterial("arena-wall-material", scene);
  material.diffuseColor = ARENA_PALETTE.wallPanelColor;
  material.specularColor = new Color3(0.02, 0.02, 0.03);
  return material;
}

/**
 * Creates (or reuses) the shared warm-brass trim material used by every
 * perimeter/ceiling trim piece (wall caps, crown lines, beams, spawn-side
 * marks). Muted, low-emissive brass — never a neon glow.
 */
export function ensureTrimMaterial(scene: Scene): StandardMaterial {
  const existing = scene.getMaterialByName("arena-trim-material");
  if (existing instanceof StandardMaterial) {
    return existing;
  }
  const material = new StandardMaterial("arena-trim-material", scene);
  material.diffuseColor = ARENA_PALETTE.trimColor;
  material.emissiveColor = ARENA_PALETTE.trimColor.scale(0.12); // faint warm sheen
  material.specularColor = new Color3(0.2, 0.16, 0.08);
  material.specularPower = 64;
  return material;
}

/**
 * Creates (or reuses) the shared burgundy architectural-section material
 * used by the perimeter bands, pilasters and spawn-side insets.
 */
export function ensureSectionMaterial(scene: Scene): StandardMaterial {
  const existing = scene.getMaterialByName("arena-section-material");
  if (existing instanceof StandardMaterial) {
    return existing;
  }
  const material = new StandardMaterial("arena-section-material", scene);
  material.diffuseColor = ARENA_PALETTE.wallSectionColor;
  material.specularColor = new Color3(0.03, 0.02, 0.02);
  return material;
}

/**
 * Adds the clean room-shell geometry to the scene:
 *  - Four tall pale-blue perimeter wall panels + brass cap trim.
 *  - One enclosed ceiling slab above the maximum build height.
 *
 * All meshes are non-pickable and non-collidable. Dimensions derive from
 * the shared `ARENA_COLLIDERS` ground entry and the shared build grid so
 * they always match the gameplay arena without duplicating or modifying it.
 */
export function setupArenaDecorations(scene: Scene): void {
  const ground = ARENA_COLLIDERS.find((c) => c.id === GROUND_ID);
  if (!ground) {
    throw new Error(
      `ARENA_COLLIDERS missing "${GROUND_ID}" — cannot derive arena boundary`,
    );
  }

  const [gx, , gz] = ground.position;
  const [hx, , hz] = ground.halfExtents;

  const wallHeight = shellWallHeight();
  const ceilingY = ceilingHeight();

  const wallMaterial = ensureWallPanelMaterial(scene);
  const trimMaterial = ensureTrimMaterial(scene);

  // Ceiling: warm dark slab. The underside is what the interior camera
  // sees; the slab is a box, so it renders correctly from both sides.
  const existingCeiling = scene.getMaterialByName("arena-ceiling-material");
  const ceilingMaterial =
    existingCeiling instanceof StandardMaterial
      ? existingCeiling
      : createCeilingMaterial(scene);

  // --- Perimeter walls + brass cap trim ----------------------------------

  const walls: Array<{ id: "n" | "s" | "e" | "w"; x: number; z: number; width: number; depth: number }> = [
    { id: "n", x: gx, z: gz - hz, width: hx * 2, depth: SHELL_THICKNESS },
    { id: "s", x: gx, z: gz + hz, width: hx * 2, depth: SHELL_THICKNESS },
    { id: "e", x: gx + hx, z: gz, width: SHELL_THICKNESS, depth: hz * 2 },
    { id: "w", x: gx - hx, z: gz, width: SHELL_THICKNESS, depth: hz * 2 },
  ];

  for (const wall of walls) {
    createBox(
      scene,
      `arena-shell-${wall.id}`,
      wallMaterial,
      new Vector3(wall.x, wallHeight / 2, wall.z),
      wall.width,
      wallHeight,
      wall.depth,
    );
    createBox(
      scene,
      `arena-shell-cap-${wall.id}`,
      trimMaterial,
      new Vector3(wall.x, wallHeight + SHELL_CAP_HEIGHT / 2, wall.z),
      wall.width,
      SHELL_CAP_HEIGHT,
      wall.depth,
    );
  }

  // --- Enclosed ceiling ---------------------------------------------------

  createBox(
    scene,
    "arena-ceiling",
    ceilingMaterial,
    new Vector3(gx, ceilingY + CEILING_THICKNESS / 2, gz),
    hx * 2,
    CEILING_THICKNESS,
    hz * 2,
  );
}

/**
 * Creates the warm dark ceiling material (only when not already present).
 */
function createCeilingMaterial(scene: Scene): StandardMaterial {
  const material = new StandardMaterial("arena-ceiling-material", scene);
  material.diffuseColor = ARENA_PALETTE.ceilingColor;
  material.specularColor = new Color3(0.02, 0.02, 0.02);
  return material;
}

/**
 * Creates a box-shaped decorative mesh, marked non-pickable and
 * non-collidable.
 */
function createBox(
  scene: Scene,
  name: string,
  material: StandardMaterial,
  position: Vector3,
  width: number,
  height: number,
  depth: number,
): void {
  const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  mesh.position = position;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
}
