/**
 * Independent decorative arena geometry module for the BuildShift Box Fight arena.
 *
 * Adds purely presentational, non-collidable, non-pickable perimeter walls and
 * a center ring to the scene. All boundary dimensions are derived from the
 * shared `ARENA_COLLIDERS` ground entry — never duplicated or modified.
 *
 * This module does NOT create or alter any gameplay geometry, spawn positions,
 * collision bodies, or networking state.
 */
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { ARENA_COLLIDERS } from "@buildshift/game-config";
import { ARENA_PALETTE } from "./arena";

/** Stable id of the ground collider from which we derive the arena boundary. */
const GROUND_ID = "foundation-ground";

/** Thickness (metres) of each perimeter wall. */
const WALL_THICKNESS = 0.2;

/** Height (metres) of each perimeter wall above the ground surface. */
const WALL_HEIGHT = 1.0;

/** Outer diameter (metres) of the center ring. */
const RING_DIAMETER = 5;

/** Thickness (metres) of the center ring cross-section. */
const RING_THICKNESS = 0.15;

/**
 * Small vertical offset so the ring sits just above the ground plane
 * without z-fighting.
 */
const RING_Y_OFFSET = 0.02;

/**
 * Adds decorative, non-interactive arena geometry to the scene:
 *  - Four thin perimeter walls (arena-wall-n/s/e/w) along the ground boundary.
 *  - A center ring (arena-center-ring) using the palette accent color.
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

  // Shared material for all decorative walls (accent-tinted, semi-transparent).
  const wallMaterial = new StandardMaterial("arena-wall-material", scene);
  wallMaterial.diffuseColor = ARENA_PALETTE.accentColor;
  wallMaterial.alpha = 0.35;

  // --- Perimeter walls -------------------------------------------------

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

  const ringMaterial = new StandardMaterial("arena-ring-material", scene);
  ringMaterial.diffuseColor = ARENA_PALETTE.accentColor;
  ring.material = ringMaterial;
  ring.isPickable = false;
  ring.checkCollisions = false;
}

/**
 * Creates a thin box-shaped perimeter wall, marks it non-pickable and
 * non-collidable.
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
