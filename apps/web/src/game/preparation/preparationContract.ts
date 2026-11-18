/**
 * preparationContract — the client's single seam to the shared box-fight
 * PREPARATION helpers agreed in the server worker's CONTRACT.md (§3).
 *
 * The AUTHORITATIVE definition lives (or will live once integrated) in
 * `@buildshift/game-config` → `boxFightPreparation.ts`, exported from the
 * package index. This module reproduces that contract EXACTLY — same names,
 * same signatures, same derivations — using only shared constants that are
 * already exported from `@buildshift/game-config` on this baseline
 * (`BUILD_BOUNDS`, `BUILD_GRID`, `PLAYABLE_ARENA_BOUNDS`,
 * `VERTICAL_MOVEMENT`). No client-only geometry values are invented: the
 * zones are derived from the canonical build geometry exactly as the server
 * derives them, so client prediction and the authoritative clamp can never
 * drift.
 *
 * DEPENDENCY (reported, not guessed): once the shared module lands in this
 * package, this file's body becomes a pure re-export:
 *
 *   export {
 *     BOX_FIGHT_PREPARATION,
 *     getPreparationZone,
 *     clampToPreparationZone,
 *     isGridAllowedDuringPreparation,
 *   } from "@buildshift/game-config";
 *   export type { PreparationSide, PreparationZone } from "@buildshift/game-config";
 *
 * Until then every consumer in apps/web imports these helpers from THIS
 * module, so the swap touches only this file.
 *
 * Gameplay summary (CONTRACT.md §1): each round opens with an 8 s build
 * preparation (`MatchPhase.COUNTDOWN`); each player is confined to ONE
 * outermost build-grid X row and may move / jump / crouch / build / edit
 * there. When preparation ends both barriers vanish simultaneously and
 * prepared structures survive. Rounds end on elimination only.
 */
import {
  BUILD_BOUNDS,
  BUILD_GRID,
  PLAYABLE_ARENA_BOUNDS,
  VERTICAL_MOVEMENT,
} from "@buildshift/game-config";

/**
 * The authoritative preparation-phase tuning (CONTRACT.md §3):
 * `durationSeconds` is the single source of truth for the prep countdown
 * length (the agreed 8 s assumption from the reference gameplay).
 */
export const BOX_FIGHT_PREPARATION = {
  /** Preparation duration in seconds before every fight. */
  durationSeconds: 8,
} as const;

/**
 * Which end of the arena a player prepares at, keyed by the X axis:
 *  - `"negative"` — the `BUILD_BOUNDS.minX` row (world −X end);
 *  - `"positive"` — the `BUILD_BOUNDS.maxX` row (world +X end).
 */
export type PreparationSide = "negative" | "positive";

/**
 * One player's preparation zone: a single build-cell-wide strip covering the
 * full playable arena Z at one outermost build-grid X row.
 */
export interface PreparationZone {
  /** World-space minimum X of the allowed strip. */
  minX: number;
  /** World-space maximum X of the allowed strip. */
  maxX: number;
  /** World-space minimum Z of the allowed strip (full playable arena). */
  minZ: number;
  /** World-space maximum Z of the allowed strip (full playable arena). */
  maxZ: number;
  /** The single allowed build-grid X column index for placements. */
  gridX: number;
  /** Row-centre spawn (feet convention: y = ground, z = arena centre). */
  spawn: { x: number; y: number; z: number };
}

/**
 * The preparation zone for `side`, derived from the canonical build geometry
 * (never from hardcoded visual geometry): the outermost build-grid X row,
 * one full {@link BUILD_GRID.cellSize} wide in world X, with the FULL
 * playable-arena Z range. The spawn is the row centre on the ground.
 */
export function getPreparationZone(side: PreparationSide): PreparationZone {
  const gridX = side === "negative" ? BUILD_BOUNDS.minX : BUILD_BOUNDS.maxX;
  const centreX = gridX * BUILD_GRID.cellSize;
  const half = BUILD_GRID.cellSize / 2;
  return {
    minX: centreX - half,
    maxX: centreX + half,
    minZ: PLAYABLE_ARENA_BOUNDS.minZ,
    maxZ: PLAYABLE_ARENA_BOUNDS.maxZ,
    gridX,
    spawn: { x: centreX, y: VERTICAL_MOVEMENT.groundY, z: 0 },
  };
}

/**
 * Confine a player's horizontal pose (feet/capsule-axis `x`/`z`, horizontal
 * collider `radius`) to the preparation strip of `side`: the whole capsule
 * stays inside the row strip (and inside the arena Z). Same copy-on-clamp
 * convention as `clampToPlayableArena` (a pose already inside is returned
 * unchanged).
 */
export function clampToPreparationZone<T extends { x: number; z: number }>(
  pose: T,
  radius: number,
  side: PreparationSide,
): T {
  const zone = getPreparationZone(side);
  const x = Math.min(zone.maxX - radius, Math.max(zone.minX + radius, pose.x));
  const z = Math.min(zone.maxZ - radius, Math.max(zone.minZ + radius, pose.z));
  return x === pose.x && z === pose.z ? pose : { ...pose, x, z };
}

/**
 * Whether a placement anchor grid cell lies in the preparation row of
 * `side`: the anchor's grid X must equal the row's
 * {@link PreparationZone.gridX}. Any in-bounds Z and layer are allowed
 * within the row (footprints are one cell wide in X, so the anchor check
 * fully confines the placement). Unknown / empty side strings deny.
 */
export function isGridAllowedDuringPreparation(
  grid: { x: number; y: number; z: number },
  side: PreparationSide | "",
): boolean {
  if (side !== "negative" && side !== "positive") return false;
  return grid.x === getPreparationZone(side).gridX;
}
