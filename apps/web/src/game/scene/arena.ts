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
  material: "ground" | "accent" | "warm";
  /** Visual mesh: same cuboid definition as the collider. */
  collider: ArenaCuboidCollider;
}

/**
 * The local player's character-collider centre at spawn (world space). The
 * Rapier capsule has total height 1.8 m and radius 0.35 m, so with its centre
 * at y = 0.9 the feet rest exactly on the ground top (y = 0) — a collision-
 * safe, non-penetrating start.
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
];
