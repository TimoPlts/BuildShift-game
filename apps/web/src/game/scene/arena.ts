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

/** The palette of scene materials the arena visual meshes can use. */
export type ArenaMaterialKind = "ground" | "accent" | "warm" | "neutral";

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
