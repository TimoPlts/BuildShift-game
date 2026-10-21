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
 * All scene-level color decisions (sky, horizon haze, ground, play-field
 * plate, accent, ambient lighting, perimeter walls, cover pieces) are
 * defined here so the palette is testable and consistent across the
 * bright, cool-blue BuildShift Box Fight presentation.
 *
 * The palette is deliberately bright and readable (stylized day, not dark
 * cinematic): every tier steps in lightness so ground, plate, grid, walls,
 * and cover stay visually distinct, while the accent cyan and the player/
 * build geometry remain strongly contrasted against the background.
 */
export const ARENA_PALETTE = {
  /** Background sky color — bright stylized azure day sky. */
  skyColor: new Color3(0.45, 0.66, 0.88),
  /** Atmospheric horizon haze (scene fog color) — pale steel-blue. */
  horizonColor: new Color3(0.6, 0.76, 0.91),
  /** Diffuse color of the ground slab — readable slate-blue plinth. */
  groundColor: new Color3(0.32, 0.42, 0.55),
  /** Raised play-field plate above the ground — slightly lighter slate. */
  playFieldColor: new Color3(0.4, 0.51, 0.65),
  /**
   * Floor build-grid line color — one step lighter than the play-field
   * plate so the build lattice reads on the floor.
   */
  gridColor: new Color3(0.53, 0.64, 0.77),
  /** Accent color — bright cyan for key arena features. */
  accentColor: new Color3(0.15, 0.85, 1.0),
  /** Ambient / hemisphere light ground-color bounce — soft sky-lifted slate. */
  ambientColor: new Color3(0.45, 0.55, 0.66),
  /** Perimeter wall color — mid blue-grey. */
  wallColor: new Color3(0.36, 0.46, 0.6),
  /** Wall cap / trim color — brighter steel blue. */
  trimColor: new Color3(0.55, 0.75, 0.95),
  /** Cover/obstacle color — light blue-grey for intentional cover. */
  coverColor: new Color3(0.48, 0.56, 0.68),
} as const;

/**
 * Presentation mapping: arena collider id -> scene material kind. Every
 * collider in the shared `ARENA_COLLIDERS` table has exactly one entry here,
 * so the browser can tint its visual mesh without that knowledge ever needing
 * to reach the shared config (or the server).
 *
 * The Box Fight arena uses three visual tiers:
 *  - "ground" for the floor slab
 *  - "accent" for the central feature box (bright cyan)
 *  - "neutral" for all cover/obstacle pieces (muted blue-grey)
 */
export const ARENA_MATERIAL_BY_ID: Readonly<Record<string, ArenaMaterialKind>> =
  {
    "foundation-ground": "ground",
    "center-box": "accent",
    // Cover pieces read as intentional arena furniture, not debug blocks.
    "reference-platform": "neutral",
    "reference-tower": "neutral",
    "slide-corridor-wall-west": "neutral",
    "slide-corridor-wall-east": "neutral",
    "low-block": "neutral",
    "jump-platform": "neutral",
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
 * light sources. This is intentionally a bright, readable stylized
 * day-time setup — no shadows, tone mapping, bloom, or extra lights — so
 * the cost stays flat and the scene stays cheap to rebuild.
 */
export function setupArenaLighting(scene: Scene): void {
  // Remove any pre-existing lights (snapshot first: disposing a light
  // mutates scene.lights mid-iteration). The two below are the only sources.
  for (const light of [...scene.lights]) {
    light.dispose();
  }

  // Hemisphere light – bright cool ambient fill from above, with the
  // palette ambient color as the ground bounce.
  const hemi = new HemisphericLight(
    "arena-hemisphere",
    new Vector3(0, 1, 0), // light comes from directly above the arena centre
    scene,
  );
  hemi.intensity = 0.9;
  hemi.diffuse = new Color3(0.85, 0.92, 1.0); // bright cool-white sky tint
  hemi.groundColor = ARENA_PALETTE.ambientColor.clone();

  // Directional light – near-white key light pointing down and angled,
  // giving the arena directional depth and readable low-poly silhouettes.
  const dir = new DirectionalLight(
    "arena-directional",
    new Vector3(-0.35, -1, -0.25), // down-and-angled key light
    scene,
  );
  dir.intensity = 1.1;
  dir.diffuse = new Color3(1.0, 0.98, 0.95); // bright neutral-warm key light
}
