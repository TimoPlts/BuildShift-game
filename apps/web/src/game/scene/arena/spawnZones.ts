/**
 * Arena spawn-zone visual treatment (Batch 2D A, arena environment V2).
 *
 * Enhances the V1 spawn pads/bars with per-side zone treatment that reads
 * from across the arena:
 *  - A flat accent ring (`arena-spawnzone-ring-{primary,mirror}`) framing
 *    each spawn pad.
 * - A glowing lane strip (`arena-spawnzone-strip-{primary,mirror}`) running
 *    from just past the start-line bar out to the boundary inlay, marking
 *    each side's entry lane.
 *
 * Purely presentational: non-pickable, non-collidable. Spawn positions are
 * DERIVED from the shared `PLAYER_SPAWN` (primary) and its mirror across
 * the arena ground centre (same convention as the V1 decorations) — never
 * duplicated or modified.
 *
 * Performance: 4 static meshes reusing the shared accent-glow material
 * (created on demand, identical to the V1 version). No per-frame work.
 */
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { ARENA_COLLIDERS, PLAYER_SPAWN } from "@buildshift/game-config";
import { ensureAccentGlowMaterial } from "./environment";

/** Stable id of the ground collider from which we derive the arena centre. */
const GROUND_ID = "foundation-ground";

/** Top of the V1 play-field plate (matches `PLATE_HEIGHT` in arenaDecorations). */
const PLATE_TOP = 0.02;

/** Diameter (metres) of the spawn-zone ring — just outside the V1 pad. */
const RING_DIAMETER = 3.4;
/** Tube thickness (metres) of the spawn-zone ring. */
const RING_TUBE = 0.12;

/** Width (metres) of the lane strip. */
const STRIP_WIDTH = 1.0;
/** Thickness (metres) of the lane strip. */
const STRIP_HEIGHT = 0.03;
/**
 * Lane-strip extents (measured from the arena centre along the spawn axis):
 * the near edge starts just inside the V1 start-line bar (which sits 1.6 m
 * behind the pad, so 1.4 m past the pad keeps a small gap) and the far edge
 * stops short of the boundary inlay so the two treatments do not merge.
 */
const STRIP_NEAR_PAST_PAD = 1.4;
const STRIP_FAR_INSET = 0.4;

/**
 * Adds the spawn-zone treatment for both 1v1 spawn sides to the scene.
 * The mirror side is the shared `PLAYER_SPAWN` reflected across the arena
 * ground centre — the same mirror convention the V1 decorations use.
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

  const accentGlow = ensureAccentGlowMaterial(scene);

  createSpawnZone(
    scene,
    accentGlow,
    "arena-spawnzone-ring-primary",
    "arena-spawnzone-strip-primary",
    { x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z },
    gz,
    hz,
  );

  createSpawnZone(
    scene,
    accentGlow,
    "arena-spawnzone-ring-mirror",
    "arena-spawnzone-strip-mirror",
    { x: gx * 2 - PLAYER_SPAWN.x, z: gz * 2 - PLAYER_SPAWN.z },
    gz,
    hz,
  );
}

/**
 * Creates the ring and lane strip for one spawn side. The strip runs
 * outward from the pad (past the V1 start-line bar) to just inside the
 * shell wall on that side.
 */
function createSpawnZone(
  scene: Scene,
  accentGlow: StandardMaterial,
  ringName: string,
  stripName: string,
  spawn: { x: number; z: number },
  gz: number,
  hz: number,
): void {
  // Flat accent ring framing the spawn pad.
  const ring = MeshBuilder.CreateTorus(
    ringName,
    { diameter: RING_DIAMETER, thickness: RING_TUBE, tessellation: 24 },
    scene,
  );
  ring.position = new Vector3(spawn.x, PLATE_TOP + RING_TUBE / 2, spawn.z);
  ring.material = accentGlow;
  ring.isPickable = false;
  ring.checkCollisions = false;

  // Lane strip from just past the start-line bar toward the boundary.
  const awayFromCentre = spawn.z >= gz ? 1 : -1;
  const near = Math.abs(spawn.z - gz) + STRIP_NEAR_PAST_PAD;
  const far = hz - STRIP_FAR_INSET;
  const stripLength = far - near;
  const stripCentre = gz + awayFromCentre * (near + stripLength / 2);
  const strip = MeshBuilder.CreateBox(
    stripName,
    { width: STRIP_WIDTH, height: STRIP_HEIGHT, depth: stripLength },
    scene,
  );
  strip.position = new Vector3(spawn.x, PLATE_TOP + STRIP_HEIGHT / 2, stripCentre);
  strip.material = accentGlow;
  strip.isPickable = false;
  strip.checkCollisions = false;
}
