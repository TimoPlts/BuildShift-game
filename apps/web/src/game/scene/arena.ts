/**
 * Client-only presentation for the shared arena.
 *
 * The collision geometry (stable id, world-space `position`, `halfExtents`)
 * and the gameplay spawn live in `@buildshift/game-config`
 * (`ARENA_COLLIDERS`, `PLAYER_SPAWN`) as the single source of truth — the
 * (later) authoritative server reads them from there too. This module owns
 * ONLY the presentation concern that must not leak into the shared config:
 * which scene material each arena collider's visual mesh is tinted with.
 *
 * Do NOT duplicate collider positions or half-extents here. The visual mesh
 * is built from `ARENA_COLLIDERS`; this file just maps `id -> material kind`.
 */
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";

/** The palette of scene materials the arena visual meshes can use. */
export type ArenaMaterialKind = "ground" | "accent" | "warm" | "neutral";

/**
 * The arena color palette — the single source of truth for scene colors.
 *
 * The clean Box Fight room: a cohesive enclosed interior with an
 * uninterrupted dark plum/navy polished floor, subdued pale-blue wall
 * panels, burgundy architectural sections at the perimeter, warm muted
 * brass/gold trim on the ceiling lines and wall caps, and restrained
 * near-white lighting. There is deliberately NO cyan, no floor grid and no
 * bright outdoor-playground palette anywhere in this table — decorative
 * color lives at the room perimeter and ceiling, so the wide centre of the
 * floor stays empty and player-built structures read clearly against it.
 */
export const ARENA_PALETTE = {
  /** Background/clear color — deep enclosed-room navy. */
  skyColor: new Color3(0.05, 0.05, 0.09),
  /** Secondary backdrop tint — slightly lifted navy. */
  horizonColor: new Color3(0.09, 0.09, 0.13),
  /** Diffuse color of the floor slab — uninterrupted dark plum/navy. */
  groundColor: new Color3(0.12, 0.1, 0.15),
  /** Wall panel color — subdued pale blue. */
  wallPanelColor: new Color3(0.55, 0.63, 0.73),
  /** Architectural wall sections (perimeter bands/pilasters) — burgundy. */
  wallSectionColor: new Color3(0.33, 0.1, 0.15),
  /** Ceiling surface — warm muted dark. */
  ceilingColor: new Color3(0.28, 0.24, 0.19),
  /** Perimeter / ceiling trim — warm muted brass. */
  trimColor: new Color3(0.63, 0.5, 0.26),
  /** Accent color — warm muted brass-gold (replaces the old cyan). */
  accentColor: new Color3(0.75, 0.58, 0.3),
  /** Hemisphere ground bounce — soft plum-lifted slate. */
  ambientColor: new Color3(0.33, 0.32, 0.37),
  /** Cover/obstacle color — muted warm grey (baseline collider furniture). */
  coverColor: new Color3(0.42, 0.43, 0.49),
} as const;

/** Presentation mapping for the shared, obstacle-free arena geometry. */
export const ARENA_MATERIAL_BY_ID: Readonly<Record<string, ArenaMaterialKind>> = {
  "foundation-ground": "ground",
};

/**
 * The scene material kind for an arena collider, looked up by its stable id.
 * Every collider in the shared table has a mapping, so this always resolves
 * for the local arena; a missing id is a programming error and throws loudly
 * rather than silently rendering an untinted mesh.
 */
export function getArenaMaterialKind(id: string): ArenaMaterialKind {
  const kind = ARENA_MATERIAL_BY_ID[id];
  if (!kind) {
    throw new Error(
      `No arena material mapping for collider id "${id}". Add it to ARENA_MATERIAL_BY_ID.`,
    );
  }
  return kind;
}

/**
 * Configures the arena scene lighting: one hemisphere light (sky/ground
 * bounce) and one directional light (down-and-angled key light).
 *
 * Replaces any existing lights in the scene so these two are the only
 * light sources. This is a restrained, readable enclosed-room setup — no
 * shadows, tone mapping, bloom, or extra lights — so the cost stays flat
 * and the scene stays cheap to rebuild.
 */
export function setupArenaLighting(scene: Scene): void {
  // Remove any pre-existing lights (snapshot first: disposing a light
  // mutates scene.lights mid-iteration). The two below are the only sources.
  for (const light of [...scene.lights]) {
    light.dispose();
  }

  // Hemisphere light – restrained near-white ambient fill from above,
  // with the palette ambient color as the ground bounce. Kept bright
  // enough that players and player-built structures stay clearly readable
  // against the dark floor and pale walls.
  const hemi = new HemisphericLight(
    "arena-hemisphere",
    new Vector3(0, 1, 0), // light comes from directly above the arena centre
    scene,
  );
  hemi.intensity = 0.9;
  hemi.diffuse = new Color3(0.9, 0.9, 0.93); // restrained near-white room light
  hemi.groundColor = ARENA_PALETTE.ambientColor.clone();

  // Directional light – near-white key light pointing down and angled,
  // giving the room directional depth, readable silhouettes and a soft
  // controlled sheen on the polished floor (no cyan tint anywhere).
  const dir = new DirectionalLight(
    "arena-directional",
    new Vector3(-0.35, -1, -0.25), // down-and-angled key light
    scene,
  );
  dir.intensity = 1.1;
  dir.diffuse = new Color3(1.0, 0.98, 0.95); // bright neutral-warm key light
}
