/**
 * Box-fight pre-round preparation configuration (authoritative, shared).
 *
 * Every round begins with a fixed-length BUILD PREPARATION phase (the server
 * represents it with the reused `MatchPhase.COUNTDOWN` lifecycle value).
 * During preparation each player is confined to ONE build-grid row at their
 * end of the arena — the outermost X row of {@link BUILD_BOUNDS} — where they
 * may move, jump, crouch, build, and edit. When preparation ends the temporary
 * barriers vanish simultaneously for both players, pre-built structures
 * survive, and the full arena opens for the fight.
 *
 * The zones are DERIVED from the canonical build geometry
 * ({@link BUILD_BOUNDS} + {@link BUILD_GRID}) and the authoritative playable
 * arena bounds — never from hardcoded visual geometry — so client and server
 * can never drift.
 *
 * This module is data + pure helpers only: no engine imports, no
 * presentation. It contains NO timed-round logic: rounds end on elimination
 * only (plus the explicit disconnect-forfeit exception).
 */
import { BUILD_BOUNDS, BUILD_GRID } from "./building.js";
import { PLAYABLE_ARENA_BOUNDS } from "./arena.js";
import { VERTICAL_MOVEMENT } from "./movement.js";

/**
 * The authoritative preparation-phase tuning.
 *
 * `durationSeconds` is the SINGLE source of truth for how long each player
 * gets to build before the arena opens. The 8 s value is the agreed
 * assumption from the reference gameplay.
 */
export const BOX_FIGHT_PREPARATION = {
  /** Preparation duration in seconds before every fight. */
  durationSeconds: 8,
} as const;

/**
 * Which end of the arena a player prepares at, keyed by the X axis:
 *  - `"negative"` — the `BUILD_BOUNDS.minX` row (world −X end);
 *  - `"positive"` — the `BUILD_BOUNDS.maxX` row ( world +X end).
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
 * The preparation zone for `side`, derived from the canonical build geometry:
 * the outermost build-grid X row (`BUILD_BOUNDS.minX` / `.maxX`), spanning
 * one full {@link BUILD_GRID.cellSize} cell in world X, with the FULL
 * playable-arena Z range allowed. The spawn is the row centre on the ground.
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
 * convention as {@link clampToPlayableArena} (a pose already inside is
 * returned unchanged).
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
 * Whether a placement anchor grid cell lies in the preparation row of `side`:
 * the anchor's grid X must equal the row's {@link PreparationZone.gridX}.
 * Any in-bounds Z and layer are allowed within the row (footprints are one
 * cell wide in X, so the anchor check fully confines the placement).
 * Unknown side strings deny.
 */
export function isGridAllowedDuringPreparation(
  grid: { x: number; y: number; z: number },
  side: PreparationSide | "",
): boolean {
  if (side !== "negative" && side !== "positive") return false;
  return grid.x === getPreparationZone(side).gridX;
}
