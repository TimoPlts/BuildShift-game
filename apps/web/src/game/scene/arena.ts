/**
 * Single source of truth for the Stage 1D arena.
 *
 * Every arena object declares BOTH its visual dimensions (used by
 * `createFoundationScene`) and its physics collider dimensions (used by
 * `PhysicsWorld`). Keeping the two in one place means collision and geometry
 * cannot drift apart by copying magic numbers across files. This is a plain
 * data table, not a level-loading system (per Stage 1D scope).
 *
 * All colliders are axis-aligned cuboids. Positions are world-space centres
 * and `halfExtents` are the collider's half sizes, so a collider's world
 * footprint is `centre ± halfExtents` on each axis.
 */
export interface ArenaCuboidCollider {
  position: [number, number, number];
  halfExtents: [number, number, number];
}

export interface ArenaObject {
  id: string;
  /** Which scene material to tint the visual mesh with. */
  material: "ground" | "accent" | "warm" | "neutral";
  /** Visual mesh: same cuboid definition as the collider. */
  collider: ArenaCuboidCollider;
}

/**
 * The local player's character-collider centre at spawn (world space). The
 * Rapier capsule has total height 1.8 m and radius 0.35 m, so with its centre
 * at y = 0.9 the feet rest exactly on the ground top (y = 0) — a collision-
 * safe, non-penetrating start.
 *
 * The spawn sits in the open baseline area south-east of centre (z = +6):
 * nothing new in the Stage 1E obstacles comes within reach of it, so the
 * character spawns on flat, unobstructed ground.
 */
export const PLAYER_SPAWN = { x: 0, y: 0.9, z: 6 } as const;

export const ARENA: ArenaObject[] = [
  {
    id: "foundation-ground",
    material: "ground",
    // A 30 x 30 m slab, 0.5 m thick, sunk so its top surface is flush at y = 0.
    collider: { position: [0, -0.25, 0], halfExtents: [15, 0.25, 15] },
  },
  {
    id: "center-box",
    material: "accent",
    collider: { position: [0, 1.25, 0], halfExtents: [1.25, 1.25, 1.25] },
  },
  {
    id: "reference-platform",
    material: "warm",
    collider: { position: [-5, 0.25, 4], halfExtents: [3.5, 0.25, 2] },
  },
  {
    id: "reference-tower",
    material: "accent",
    collider: { position: [5, 2.5, -3], halfExtents: [0.75, 2.5, 0.75] },
  },
  // --- Stage 1E physics-playground obstacles -----------------------------
  // A clean 3 m-wide corridor running north (walls at x = ±2, z from -1 to -9)
  // for wall-slide / corridor-movement testing. Open at both ends; the south
  // end stays clear of the spawn and the center box (inner edge at z = -1 vs.
  // the box's -1.25, so testers can enter from the open area).
  {
    id: "slide-corridor-wall-west",
    material: "neutral",
    collider: { position: [-2, 1.5, -5], halfExtents: [0.25, 1.5, 4] },
  },
  {
    id: "slide-corridor-wall-east",
    material: "neutral",
    collider: { position: [2, 1.5, -5], halfExtents: [0.25, 1.5, 4] },
  },
  // A low block on the west side: 1 m tall, so the character (feet-to-jump-
  // apex ~1.6 m above the ground) clears it while walking in — a quick
  // jump-over / landing validation target.
  {
    id: "low-block",
    material: "neutral",
    collider: { position: [-8, 0.5, 0], halfExtents: [1.5, 0.5, 1.5] },
  },
  // A raised platform on the east side: 2 m tall (top at y = 2), a deliberate
  // jump target. With jumpSpeed 9 and gravity -25 the apex is ~1.6 m above
  // the ground, so it cannot be reached in one hop — testers must use the
  // reference platform (top y = 1) or the low block as a step, which makes
  // it a useful platform-to-platform jump check.
  {
    id: "jump-platform",
    material: "warm",
    collider: { position: [9, 1, -1], halfExtents: [2, 1, 2] },
  },
];
