/**
 * Shared arena collision geometry + local player spawn.
 *
 * This is the single source of truth for the static arena colliders and the
 * gameplay spawn. It is *data only* — no engine imports, no presentation
 * (materials / colors / meshes). The client keeps a small presentation
 * mapping (arena id -> material kind) in `apps/web`; the collision geometry
 * lives only here so the (later) authoritative server can rebuild the exact
 * same static colliders.
 *
 * All colliders are axis-aligned cuboids. Positions are world-space centres
 * and `halfExtents` are the collider's half sizes, so a collider's world
 * footprint is `centre ± halfExtents` on each axis.
 */

/** A single static axis-aligned cuboid collider. */
export interface ArenaCollider {
  /** Stable identifier for the collider. */
  id: string;
  /** World-space centre of the cuboid (x, y, z). */
  position: [number, number, number];
  /** Half size of the cuboid on each axis (x, y, z). */
  halfExtents: [number, number, number];
}

/**
 * The local player's character-collider centre at spawn (world space). This is
 * the *capsule-centre* position, not the feet: with the capsule at
 * y = 0.9 and total height 1.8, the feet rest exactly on the ground top
 * (y = 0) — a collision-safe, non-penetrating start.
 *
 * The spawn sits in the open area south of centre (z = +6) on the flat
 * foundation ground: the play area contains no static obstacles, so the
 * character spawns on flat, unobstructed ground.
 */
export const PLAYER_SPAWN = {
  /** Capsule-centre x (world space). */
  x: 0,
  /** Capsule-centre y (world space). Feet rest on y = 0. */
  y: 0.9,
  /** Capsule-centre z (world space). */
  z: 6,
} as const;

/**
 * The static arena colliders. The play area is a clean, empty flat box-fight
 * arena: the only static collider is the foundation slab itself. The former
 * Stage 1D / Stage 1E playground obstacles (center-box, reference-platform,
 * reference-tower, slide-corridor-wall-west/east, low-block, jump-platform)
 * were removed from the shared table, so client and authoritative server
 * agree the playable area is obstacle-free.
 *
 * The client renders these (plus its own material mapping) and the physics
 * world (and the server) build colliders from this one table.
 */
export const ARENA_COLLIDERS: ArenaCollider[] = [
  {
    id: "foundation-ground",
    // A 30 x 30 m slab, 0.5 m thick, sunk so its top surface is flush at y = 0.
    position: [0, -0.25, 0],
    halfExtents: [15, 0.25, 15],
  },
];

// ─── Authoritative playable bounds ─────────────────────────────────────────

const FOUNDATION = ARENA_COLLIDERS.find((c) => c.id === "foundation-ground")!;

/**
 * The authoritative Box Fight playable area in the X/Z plane: the footprint
 * of the foundation slab players stand on. The server confines every player
 * to it, and client prediction applies the identical rule, so they agree.
 * Decorative arena props are NOT authoritative collision; only this boundary
 * shell is.
 */
export const PLAYABLE_ARENA_BOUNDS = {
  minX: FOUNDATION.position[0] - FOUNDATION.halfExtents[0],
  maxX: FOUNDATION.position[0] + FOUNDATION.halfExtents[0],
  minZ: FOUNDATION.position[2] - FOUNDATION.halfExtents[2],
  maxZ: FOUNDATION.position[2] + FOUNDATION.halfExtents[2],
} as const;

/**
 * Confine a player's capsule (centre `x`/`z`, horizontal `radius`) to the
 * playable area: the whole capsule stays over the foundation slab.
 */
export function clampToPlayableArena<T extends { x: number; z: number }>(pose: T, radius: number): T {
  const x = Math.min(PLAYABLE_ARENA_BOUNDS.maxX - radius, Math.max(PLAYABLE_ARENA_BOUNDS.minX + radius, pose.x));
  const z = Math.min(PLAYABLE_ARENA_BOUNDS.maxZ - radius, Math.max(PLAYABLE_ARENA_BOUNDS.minZ + radius, pose.z));
  return x === pose.x && z === pose.z ? pose : { ...pose, x, z };
}
