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
 * The spawn sits in the open baseline area south-east of centre (z = +6):
 * nothing in the arena obstacles comes within reach of it, so the character
 * spawns on flat, unobstructed ground.
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
 * The static arena colliders (Stage 1D + Stage 1E physics playground). The
 * client renders these (plus its own material mapping) and the physics world
 * (and later the server) build colliders from them.
 */
export const ARENA_COLLIDERS: ArenaCollider[] = [
  {
    id: "foundation-ground",
    // A 30 x 30 m slab, 0.5 m thick, sunk so its top surface is flush at y = 0.
    position: [0, -0.25, 0],
    halfExtents: [15, 0.25, 15],
  },
  {
    id: "center-box",
    position: [0, 1.25, 0],
    halfExtents: [1.25, 1.25, 1.25],
  },
  {
    id: "reference-platform",
    position: [-5, 0.25, 4],
    halfExtents: [3.5, 0.25, 2],
  },
  {
    id: "reference-tower",
    position: [5, 2.5, -3],
    halfExtents: [0.75, 2.5, 0.75],
  },
  // --- Stage 1E physics-playground obstacles -----------------------------
  // A clean 3 m-wide corridor running north (walls at x = ±2, z from -1 to -9)
  // for wall-slide / corridor-movement testing. Open at both ends; the south
  // end stays clear of the spawn and the center box (inner edge at z = -1 vs.
  // the box's -1.25, so testers can enter from the open area).
  {
    id: "slide-corridor-wall-west",
    position: [-2, 1.5, -5],
    halfExtents: [0.25, 1.5, 4],
  },
  {
    id: "slide-corridor-wall-east",
    position: [2, 1.5, -5],
    halfExtents: [0.25, 1.5, 4],
  },
  // A low block on the west side: 1 m tall, so the character (feet-to-jump-
  // apex ~1.6 m above the ground) clears it while walking in — a quick
  // jump-over / landing validation target.
  {
    id: "low-block",
    position: [-8, 0.5, 0],
    halfExtents: [1.5, 0.5, 1.5],
  },
  // A raised platform on the east side: 2 m tall (top at y = 2), a deliberate
  // jump target. With jumpSpeed 9 and gravity -25 the apex is ~1.6 m above
  // the ground, so it cannot be reached in one hop — testers must use the
  // reference platform (top y = 1) or the low block as a step, which makes
  // it a useful platform-to-platform jump check.
  {
    id: "jump-platform",
    position: [9, 1, -1],
    halfExtents: [2, 1, 2],
  },
];
