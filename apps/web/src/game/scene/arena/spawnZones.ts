/**
 * Arena spawn-side presentation for the clean Box Fight room (redesigned).
 *
 * The old treatment — glowing floor rings and lane strips running out of
 * each spawn — was floor clutter and is REMOVED by user requirement: the
 * playable floor stays completely empty. Each spawn side is now marked by
 * a single restrained brass inset panel mounted high on the room's end
 * WALL behind the spawn (perimeter decoration, off the buildable floor):
 *  - `arena-spawnzone-mark-{primary,mirror}`
 *
 * Purely presentational: non-pickable, non-collidable. Spawn sides are
 * DERIVED from the shared `PLAYER_SPAWN` (primary) and its mirror across
 * the arena ground centre (same convention as the room shell) — never
 * duplicated or modified.
 *
 * Performance: 2 static meshes reusing the shared brass trim material from
 * `arenaDecorations` (created on demand). No per-frame work.
 */
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { ARENA_COLLIDERS, PLAYER_SPAWN } from "@buildshift/game-config";
import { ensureTrimMaterial } from "../arenaDecorations";

/** Stable id of the ground collider from which we derive the arena centre. */
const GROUND_ID = "foundation-ground";

/** Half of the shell wall thickness — distance from wall centre to face. */
const WALL_FACE_INSET = 0.15;

/** Width (metres) of the wall-mounted spawn-side inset panel. */
const MARK_WIDTH = 3.0;
/** Height (metres) of the panel. */
const MARK_HEIGHT = 2.2;
/** Thickness (metres) the panel stands proud of the wall's inner face. */
const MARK_PROUD = 0.08;
/** Vertical centre (metres) of the panel on the end wall — well above the
 *  floor and clear of any buildable volume. */
const MARK_Y = 7.5;

/**
 * Adds the spawn-side wall marks for both 1v1 sides to the scene. The
 * mirror side is the shared `PLAYER_SPAWN` reflected across the arena
 * ground centre — the same mirror convention the room shell uses.
 */
export function setupArenaSpawnZones(scene: Scene): void {
  const ground = ARENA_COLLIDERS.find((c) => c.id === GROUND_ID);
  if (!ground) {
    throw new Error(
      `ARENA_COLLIDERS missing "${GROUND_ID}" — cannot derive arena centre`,
    );
  }
  const [gx, , gz] = ground.position;
  const [, , hz] = ground.halfExtents;

  const trimMaterial = ensureTrimMaterial(scene);

  createSpawnMark(scene, trimMaterial, "arena-spawnzone-mark-primary", gz, hz, {
    x: PLAYER_SPAWN.x,
    z: PLAYER_SPAWN.z,
  });
  createSpawnMark(scene, trimMaterial, "arena-spawnzone-mark-mirror", gz, hz, {
    x: gx * 2 - PLAYER_SPAWN.x,
    z: gz * 2 - PLAYER_SPAWN.z,
  });
}

/**
 * Mounts the single inset panel for one spawn side on the end wall nearest
 * that spawn (the wall behind the spawning player). Non-pickable,
 * non-collidable, entirely off the floor.
 */
function createSpawnMark(
  scene: Scene,
  trimMaterial: StandardMaterial,
  name: string,
  gz: number,
  hz: number,
  spawn: { x: number; z: number },
): void {
  // The end wall behind this spawn: the wall on the same side of centre.
  const behindCentre = spawn.z >= gz ? 1 : -1;
  const wallCentreZ = gz + behindCentre * hz;
  // Push the panel onto the wall's inner face, into the room.
  const panelZ = wallCentreZ - behindCentre * (WALL_FACE_INSET + MARK_PROUD / 2);

  const panel = MeshBuilder.CreateBox(
    name,
    { width: MARK_WIDTH, height: MARK_HEIGHT, depth: MARK_PROUD },
    scene,
  );
  panel.position = new Vector3(spawn.x, MARK_Y, panelZ);
  panel.material = trimMaterial;
  panel.isPickable = false;
  panel.checkCollisions = false;
}
