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
 * All scene-level color decisions (sky, ground, accent, ambient lighting)
 * are defined here so the palette is testable and consistent.
 */
export const ARENA_PALETTE = {
  /** Background sky color for the scene. */
  skyColor: new Color3(0.08, 0.1, 0.16),
  /** Diffuse color of the ground plane material. */
  groundColor: new Color3(0.18, 0.23, 0.3),
  /** Accent color for key arena features (center box, towers). */
  accentColor: new Color3(0.12, 0.55, 0.78),
  /** Ambient / hemisphere light ground-color bounce. */
  ambientColor: new Color3(0.08, 0.1, 0.14),
} as const;

/**
 * Presentation mapping: arena collider id -> scene material kind. Every
 * collider in the shared `ARENA_COLLIDERS` table has exactly one entry here,
 * so the browser can tint its visual mesh without that knowledge ever needing
 * to reach the shared config (or the server).
 */
export const ARENA_MATERIAL_BY_ID: Readonly<Record<string, ArenaMaterialKind>> =
  {
    "foundation-ground": "ground",
    "center-box": "accent",
    "reference-platform": "warm",
    "reference-tower": "accent",
    "slide-corridor-wall-west": "neutral",
    "slide-corridor-wall-east": "neutral",
    "low-block": "neutral",
    "jump-platform": "warm",
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
 * bounce) and one directional light (down-and-slightly-angled key light).
 *
 * Replaces any existing lights in the scene so these two are the only
 * light sources. Colors are sourced from {@link ARENA_PALETTE}.
 */
export function setupArenaLighting(scene: Scene): void {
  // Remove any pre-existing lights so the two below are the only sources.
  for (const light of [...scene.lights]) {
    light.dispose();
  }

  // Hemisphere light – soft ambient fill from above.
  const hemi = new HemisphericLight(
    "arena-hemisphere",
    new Vector3(0, 1, 0), // light comes from directly above the arena centre
    scene,
  );
  hemi.intensity = 0.6;
  hemi.diffuse = ARENA_PALETTE.skyColor.clone();
  hemi.groundColor = ARENA_PALETTE.groundColor.clone();

  // Directional light – key light pointing down and slightly angled.
  const dir = new DirectionalLight(
    "arena-directional",
    new Vector3(-0.3, -1, -0.2), // down-and-slightly-angled
    scene,
  );
  dir.intensity = 0.8;
  dir.diffuse = ARENA_PALETTE.ambientColor.clone();
}
