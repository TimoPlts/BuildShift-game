/**
 * Independent decorative arena geometry module for the BuildShift Box Fight arena.
 *
 * Adds purely presentational, non-collidable, non-pickable low-poly set
 * pieces to the scene:
 *  - A raised play-field plate (`arena-playfield-plate`) inset from the
 *    boundary, giving the floor an intentional, framed look.
 *  - Four solid perimeter walls (`arena-wall-n/s/e/w`) with bright accent
 *    cap strips (`arena-wall-cap-n/s/e/w`) marking the boundary.
 *  - Four tall corner posts (`arena-post-ne/nw/se/sw`) as corner landmarks.
 *  - Four ground border strips (`arena-border-n/s/e/w`) along the floor edge.
 *  - A center ring (`arena-center-ring`) framing the open build centre.
 *  - A spawn pad (`arena-spawn-pad`) and low start-line bar
 *    (`arena-spawn-bar`) placed from the shared `PLAYER_SPAWN` so the
 *    spawn side reads clearly from across the arena.
 *
 * All boundary dimensions are derived from the shared `ARENA_COLLIDERS`
 * ground entry — never duplicated or modified. The spawn marker derives
 * from the shared `PLAYER_SPAWN`.
 *
 * This module does NOT create or alter any gameplay geometry, spawn
 * positions, collision bodies, or networking state.
 */
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { ARENA_COLLIDERS, PLAYER_SPAWN } from "@buildshift/game-config";
import { ARENA_PALETTE } from "./arena";

/** Stable id of the ground collider from which we derive the arena boundary. */
const GROUND_ID = "foundation-ground";

/** Thickness (metres) of each perimeter wall. */
const WALL_THICKNESS = 0.2;

/** Height (metres) of each perimeter wall above the ground surface. */
const WALL_HEIGHT = 1.3;

/** Height (metres) of the accent cap strip sitting on top of each wall. */
const WALL_CAP_HEIGHT = 0.08;

/** Diameter (metres) of each corner post. */
const POST_DIAMETER = 0.3;

/** Height (metres) of each corner post above the ground surface. */
const POST_HEIGHT = 1.7;

/** Outer diameter (metres) of the center ring. */
const RING_DIAMETER = 5;

/** Thickness (metres) of the center ring cross-section. */
const RING_THICKNESS = 0.18;

/**
 * Small vertical offset so the ring sits just above the play-field plate
 * without floating or z-fighting.
 */
const RING_Y_OFFSET = 0.1;

/** Width (metres) of the ground border strip. */
const BORDER_WIDTH = 0.15;

/** Height (metres) of the ground border strip. */
const BORDER_HEIGHT = 0.04;

/** Gap (metres) between the play-field plate edge and the arena boundary. */
const PLATE_INSET = 0.8;

/** Height (metres) of the play-field plate above the ground surface. */
const PLATE_HEIGHT = 0.02;

/** Diameter (metres) of the spawn pad. */
const PAD_DIAMETER = 2.6;

/** Height (metres) of the spawn pad. */
const PAD_HEIGHT = 0.04;

/**
 * Vertical position of the spawn pad centre — the pad base rests on the
 * ground surface (y = 0).
 */
const PAD_Y = PAD_HEIGHT / 2;

/** Width (metres) of the low start-line bar behind the spawn pad. */
const BAR_WIDTH = 3.6;

/** Height (metres) of the start-line bar. */
const BAR_HEIGHT = 0.7;

/** Depth (metres) of the start-line bar. */
const BAR_DEPTH = 0.12;

/** Distance (metres) behind the spawn point (along +Z) where the bar sits. */
const BAR_OFFSET = 1.7;

/**
 * Adds decorative, non-interactive arena geometry to the scene:
 *  - A raised play-field plate (arena-playfield-plate) inset from the edge.
 *  - Four thin perimeter walls (arena-wall-n/s/e/w) along the ground boundary.
 *  - Four accent cap strips (arena-wall-cap-n/s/e/w) on top of each wall.
 *  - Four corner posts (arena-post-ne/nw/se/sw) at the wall intersections.
 *  - Four ground border strips (arena-border-n/s/e/w) along the floor edge.
 *  - A center ring (arena-center-ring) using the palette accent color.
 *  - A spawn pad (arena-spawn-pad) and start-line bar (arena-spawn-bar)
 *    positioned from the shared PLAYER_SPAWN.
 *
 * All meshes are non-pickable and non-collidable. Dimensions are derived from
 * the shared `ARENA_COLLIDERS` ground entry so they always match the gameplay
 * arena without duplicating or modifying it.
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

  // --- Materials -------------------------------------------------------

  // Play-field plate: lighter slate — the intentional competition floor.
  const plateMaterial = new StandardMaterial("arena-plate-material", scene);
  plateMaterial.diffuseColor = ARENA_PALETTE.playFieldColor;
  plateMaterial.specularColor = new Color3(0.03, 0.04, 0.06);

  // Perimeter wall: solid dark navy — a clean, readable boundary.
  const wallMaterial = new StandardMaterial("arena-wall-material", scene);
  wallMaterial.diffuseColor = ARENA_PALETTE.wallColor;
  wallMaterial.specularColor = new Color3(0.03, 0.04, 0.05);

  // Corner posts: navy body with a subtle accent glow so corners read at a
  // glance.
  const postMaterial = new StandardMaterial("arena-post-material", scene);
  postMaterial.diffuseColor = ARENA_PALETTE.wallColor;
  postMaterial.emissiveColor = ARENA_PALETTE.accentColor.clone().scale(0.25);
  postMaterial.specularColor = new Color3(0.1, 0.12, 0.15);

  // Accent glow: shared by the wall caps, border strips, center ring, and
  // spawn markers — one bright cyan material keeps the identity consistent
  // and the material count low.
  const accentGlowMaterial = new StandardMaterial(
    "arena-accent-glow-material",
    scene,
  );
  accentGlowMaterial.diffuseColor = ARENA_PALETTE.accentColor;
  accentGlowMaterial.emissiveColor = ARENA_PALETTE.accentColor
    .clone()
    .scale(0.45);
  accentGlowMaterial.specularColor = new Color3(0.1, 0.12, 0.15);

  // --- Play-field plate ------------------------------------------------

  createPlate(
    scene,
    "arena-playfield-plate",
    plateMaterial,
    new Vector3(gx, PLATE_HEIGHT / 2, gz),
    hx * 2 - PLATE_INSET * 2,
    PLATE_HEIGHT,
    hz * 2 - PLATE_INSET * 2,
  );

  // --- Perimeter walls + caps -------------------------------------------

  // North wall (negative Z edge)
  createWall(
    scene,
    "arena-wall-n",
    wallMaterial,
    new Vector3(gx, WALL_HEIGHT / 2, gz - hz),
    hx * 2,
    WALL_HEIGHT,
    WALL_THICKNESS,
  );
  createWall(
    scene,
    "arena-wall-cap-n",
    accentGlowMaterial,
    new Vector3(gx, WALL_HEIGHT + WALL_CAP_HEIGHT / 2, gz - hz),
    hx * 2,
    WALL_CAP_HEIGHT,
    WALL_THICKNESS,
  );

  // South wall (positive Z edge)
  createWall(
    scene,
    "arena-wall-s",
    wallMaterial,
    new Vector3(gx, WALL_HEIGHT / 2, gz + hz),
    hx * 2,
    WALL_HEIGHT,
    WALL_THICKNESS,
  );
  createWall(
    scene,
    "arena-wall-cap-s",
    accentGlowMaterial,
    new Vector3(gx, WALL_HEIGHT + WALL_CAP_HEIGHT / 2, gz + hz),
    hx * 2,
    WALL_CAP_HEIGHT,
    WALL_THICKNESS,
  );

  // East wall (positive X edge)
  createWall(
    scene,
    "arena-wall-e",
    wallMaterial,
    new Vector3(gx + hx, WALL_HEIGHT / 2, gz),
    WALL_THICKNESS,
    WALL_HEIGHT,
    hz * 2,
  );
  createWall(
    scene,
    "arena-wall-cap-e",
    accentGlowMaterial,
    new Vector3(gx + hx, WALL_HEIGHT + WALL_CAP_HEIGHT / 2, gz),
    WALL_THICKNESS,
    WALL_CAP_HEIGHT,
    hz * 2,
  );

  // West wall (negative X edge)
  createWall(
    scene,
    "arena-wall-w",
    wallMaterial,
    new Vector3(gx - hx, WALL_HEIGHT / 2, gz),
    WALL_THICKNESS,
    WALL_HEIGHT,
    hz * 2,
  );
  createWall(
    scene,
    "arena-wall-cap-w",
    accentGlowMaterial,
    new Vector3(gx - hx, WALL_HEIGHT + WALL_CAP_HEIGHT / 2, gz),
    WALL_THICKNESS,
    WALL_CAP_HEIGHT,
    hz * 2,
  );

  // --- Corner posts ----------------------------------------------------

  createPost(scene, "arena-post-ne", postMaterial, new Vector3(gx + hx, POST_HEIGHT / 2, gz - hz), POST_DIAMETER, POST_HEIGHT);
  createPost(scene, "arena-post-nw", postMaterial, new Vector3(gx - hx, POST_HEIGHT / 2, gz - hz), POST_DIAMETER, POST_HEIGHT);
  createPost(scene, "arena-post-se", postMaterial, new Vector3(gx + hx, POST_HEIGHT / 2, gz + hz), POST_DIAMETER, POST_HEIGHT);
  createPost(scene, "arena-post-sw", postMaterial, new Vector3(gx - hx, POST_HEIGHT / 2, gz + hz), POST_DIAMETER, POST_HEIGHT);

  // --- Ground border strips --------------------------------------------

  createBorder(
    scene, "arena-border-n", accentGlowMaterial,
    new Vector3(gx, BORDER_HEIGHT / 2, gz - hz + BORDER_WIDTH / 2),
    hx * 2, BORDER_HEIGHT, BORDER_WIDTH,
  );
  createBorder(
    scene, "arena-border-s", accentGlowMaterial,
    new Vector3(gx, BORDER_HEIGHT / 2, gz + hz - BORDER_WIDTH / 2),
    hx * 2, BORDER_HEIGHT, BORDER_WIDTH,
  );
  createBorder(
    scene, "arena-border-e", accentGlowMaterial,
    new Vector3(gx + hx - BORDER_WIDTH / 2, BORDER_HEIGHT / 2, gz),
    BORDER_WIDTH, BORDER_HEIGHT, hz * 2,
  );
  createBorder(
    scene, "arena-border-w", accentGlowMaterial,
    new Vector3(gx - hx + BORDER_WIDTH / 2, BORDER_HEIGHT / 2, gz),
    BORDER_WIDTH, BORDER_HEIGHT, hz * 2,
  );

  // --- Center ring -----------------------------------------------------

  const ring = MeshBuilder.CreateTorus(
    "arena-center-ring",
    {
      diameter: RING_DIAMETER,
      thickness: RING_THICKNESS,
      tessellation: 32,
    },
    scene,
  );
  ring.position = new Vector3(gx, RING_Y_OFFSET, gz);
  ring.material = accentGlowMaterial;
  ring.isPickable = false;
  ring.checkCollisions = false;

  // --- Spawn side markers ----------------------------------------------

  // Flat glowing pad under the spawn point.
  const pad = MeshBuilder.CreateCylinder(
    "arena-spawn-pad",
    { diameter: PAD_DIAMETER, height: PAD_HEIGHT, tessellation: 24 },
    scene,
  );
  pad.position = new Vector3(PLAYER_SPAWN.x, PAD_Y, PLAYER_SPAWN.z);
  pad.material = accentGlowMaterial;
  pad.isPickable = false;
  pad.checkCollisions = false;

  // Low start-line bar just behind the pad, marking the spawn side.
  const bar = MeshBuilder.CreateBox(
    "arena-spawn-bar",
    { width: BAR_WIDTH, height: BAR_HEIGHT, depth: BAR_DEPTH },
    scene,
  );
  bar.position = new Vector3(
    PLAYER_SPAWN.x,
    BAR_HEIGHT / 2,
    PLAYER_SPAWN.z + BAR_OFFSET,
  );
  bar.material = accentGlowMaterial;
  bar.isPickable = false;
  bar.checkCollisions = false;
}

/**
 * Creates the raised play-field plate, marks it non-pickable and
 * non-collidable.
 */
function createPlate(
  scene: Scene,
  name: string,
  material: StandardMaterial,
  position: Vector3,
  width: number,
  height: number,
  depth: number,
): void {
  const plate = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  plate.position = position;
  plate.material = material;
  plate.isPickable = false;
  plate.checkCollisions = false;
}

/**
 * Creates a thin box-shaped perimeter wall or cap strip, marks it
 * non-pickable and non-collidable.
 */
function createWall(
  scene: Scene,
  name: string,
  material: StandardMaterial,
  position: Vector3,
  width: number,
  height: number,
  depth: number,
): void {
  const wall = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  wall.position = position;
  wall.material = material;
  wall.isPickable = false;
  wall.checkCollisions = false;
}

/**
 * Creates a cylindrical corner post, marks it non-pickable and non-collidable.
 */
function createPost(
  scene: Scene,
  name: string,
  material: StandardMaterial,
  position: Vector3,
  diameter: number,
  height: number,
): void {
  const post = MeshBuilder.CreateCylinder(
    name,
    { diameter, height, tessellation: 12 },
    scene,
  );
  post.position = position;
  post.material = material;
  post.isPickable = false;
  post.checkCollisions = false;
}

/**
 * Creates a thin ground-level border strip, marks it non-pickable and
 * non-collidable.
 */
function createBorder(
  scene: Scene,
  name: string,
  material: StandardMaterial,
  position: Vector3,
  width: number,
  height: number,
  depth: number,
): void {
  const strip = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  strip.position = position;
  strip.material = material;
  strip.isPickable = false;
  strip.checkCollisions = false;
}
