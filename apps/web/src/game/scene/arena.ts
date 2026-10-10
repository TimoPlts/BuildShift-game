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
 * dark/blue BuildShift Box Fight presentation.
 */
export const ARENA_PALETTE = {
  /** Background sky color — deep blue-black night arena. */
  skyColor: new Color3(0.02, 0.045, 0.1),
  /** Atmospheric horizon haze (scene fog color) — soft steel-blue. */
  horizonColor: new Color3(0.045, 0.09, 0.18),
  /** Diffuse color of the ground slab — dark slate-blue plinth. */
  groundColor: new Color3(0.1, 0.14, 0.21),
  /** Raised play-field plate above the ground — slightly lighter slate. */
  playFieldColor: new Color3(0.13, 0.18, 0.27),
  /** Accent color — bright cyan for key arena features. */
  accentColor: new Color3(0.2, 0.78, 1.0),
  /** Ambient / hemisphere light ground-color bounce — deep blue. */
  ambientColor: new Color3(0.06, 0.08, 0.14),
  /** Perimeter wall color — dark navy. */
  wallColor: new Color3(0.11, 0.16, 0.25),
  /** Wall cap / trim color — brighter steel blue. */
  trimColor: new Color3(0.3, 0.6, 0.85),
  /** Cover/obstacle color — medium blue-grey for intentional cover. */
  coverColor: new Color3(0.2, 0.27, 0.38),
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
 * light sources. Colors are sourced from {@link ARENA_PALETTE}.
 */
export function setupArenaLighting(scene: Scene): void {
  // Remove any pre-existing lights so the two below are the only sources.
  for (const light of [...scene.lights]) {
    light.dispose();
  }

  // Hemisphere light – soft ambient fill from above (cool blue bounce).
  const hemi = new HemisphericLight(
    "arena-hemisphere",
    new Vector3(0, 1, 0), // light comes from directly above the arena centre
    scene,
  );
  hemi.intensity = 0.6;
  hemi.diffuse = ARENA_PALETTE.skyColor.clone().scale(3); // brightened sky tint
  hemi.groundColor = ARENA_PALETTE.groundColor.clone().scale(1.5);

  // Directional light – key light pointing down and angled, giving the
  // arena directional depth and readable low-poly silhouettes.
  const dir = new DirectionalLight(
    "arena-directional",
    new Vector3(-0.35, -1, -0.25), // down-and-angled key light
    scene,
  );
  dir.intensity = 0.8;
  dir.diffuse = ARENA_PALETTE.ambientColor.clone().scale(3); // cool blue key light
}
