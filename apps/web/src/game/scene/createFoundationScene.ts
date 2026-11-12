import type { Engine } from "@babylonjs/core/Engines/engine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import {
  ARENA_COLLIDERS,
  type ArenaCollider,
} from "@buildshift/game-config";
import {
  ARENA_PALETTE,
  getArenaMaterialKind,
  setupArenaLighting,
  type ArenaMaterialKind,
} from "./arena";
import { setupArenaSky } from "./arenaSky";
import { setupArenaDecorations } from "./arenaDecorations";
import { setupArenaEnvironment } from "./arena/environment";
import { setupArenaSpawnZones } from "./arena/spawnZones";

/**
 * Creates the foundation scene: lighting plus the clean Box Fight room.
 *
 * Every visible GAMEPLAY object is built from the shared `ARENA_COLLIDERS`
 * table (in `@buildshift/game-config`, also read by the physics layer — and,
 * from Stage 2C1 on, the authoritative server), so the meshes and the
 * colliders can never drift apart: each mesh is a box of `2 * halfExtents`
 * centred at `position`. The scene factory no longer owns any camera — the
 * gameplay camera is created by `ThirdPersonCameraController`, which makes
 * it the scene's active camera.
 *
 * The presentation-only concern (which scene material each collider's visual
 * mesh uses) lives in the client-side `arena.ts` material mapping and never
 * reaches the shared config. The clean room shell, perimeter architecture,
 * and spawn-side wall marks are decorative layers (`arenaDecorations`,
 * `arena/environment`, `arena/spawnZones`) derived from — never duplicating
 * — the shared table.
 */
export function createFoundationScene(engine: Engine): Scene {
  const scene = new Scene(engine);

  // Wire in independent visual modules: room background, lighting, and the
  // clean room shell (pale-blue walls, brass caps, enclosed ceiling).
  setupArenaSky(scene);
  setupArenaLighting(scene);
  setupArenaDecorations(scene);

  // Perimeter architecture (burgundy sections, brass crown + ceiling beams)
  // and the spawn-side wall marks. Purely presentational — all decoration
  // sits on the room perimeter/ceiling, never on the playable floor.
  setupArenaEnvironment(scene);
  setupArenaSpawnZones(scene);

  for (const collider of ARENA_COLLIDERS) {
    buildArenaObject(scene, collider, getArenaMaterialKind(collider.id));
  }

  return scene;
}

function buildArenaObject(
  scene: Scene,
  collider: ArenaCollider,
  kind: ArenaMaterialKind,
): void {
  const material = getMaterial(scene, kind);
  const [px, py, pz] = collider.position;
  const [hx, hy, hz] = collider.halfExtents;

  const mesh = MeshBuilder.CreateBox(
    collider.id,
    { width: hx * 2, height: hy * 2, depth: hz * 2 },
    scene,
  );
  mesh.position = new Vector3(px, py, pz);
  mesh.material = material;
  // Collider meshes are purely presentational — they must never
  // participate in gameplay picking or collision detection.
  mesh.isPickable = false;
  mesh.checkCollisions = false;
}

/** Creates (or reuses) the shared material for an arena material kind. */
function getMaterial(scene: Scene, kind: ArenaMaterialKind): StandardMaterial {
  const existing = scene.getMaterialByName(`${kind}-material`);
  if (existing instanceof StandardMaterial) {
    return existing;
  }

  const material = new StandardMaterial(`${kind}-material`, scene);
  switch (kind) {
    case "ground":
      // The polished room floor: uninterrupted dark plum/navy with a tight,
      // controlled specular sheen (high specular power = broad soft gloss,
      // not a mirror) — no grid, tiles, or markings of any kind.
      material.diffuseColor = ARENA_PALETTE.groundColor;
      material.specularColor = new Color3(0.3, 0.28, 0.33);
      material.specularPower = 64;
      break;
    case "accent":
      material.diffuseColor = ARENA_PALETTE.accentColor;
      material.emissiveColor = ARENA_PALETTE.accentColor.scale(0.15);
      material.specularColor = new Color3(0.1, 0.12, 0.15);
      break;
    case "neutral":
      // Muted warm grey: reads as intentional arena cover, not debug props.
      material.diffuseColor = ARENA_PALETTE.coverColor;
      material.specularColor = new Color3(0.03, 0.04, 0.05);
      break;
    case "warm":
      material.diffuseColor = new Color3(0.92, 0.48, 0.18);
      break;
  }
  return material;
}
