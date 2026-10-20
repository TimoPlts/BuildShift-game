import { describe, expect, it } from "vitest";
import { ARENA_COLLIDERS, PLAYABLE_ARENA_BOUNDS, clampToPlayableArena } from "./arena.js";
import { BUILD_BOUNDS, BUILD_GRID } from "./building.js";

describe("authoritative playable arena bounds", () => {
  it("is the foundation slab footprint", () => {
    const ground = ARENA_COLLIDERS.find((c) => c.id === "foundation-ground")!;
    expect(PLAYABLE_ARENA_BOUNDS).toEqual({
      minX: ground.position[0] - ground.halfExtents[0],
      maxX: ground.position[0] + ground.halfExtents[0],
      minZ: ground.position[2] - ground.halfExtents[2],
      maxZ: ground.position[2] + ground.halfExtents[2],
    });
  });

  it("keeps the whole capsule over the slab and leaves inside positions untouched", () => {
    const inside = { x: 3, y: 1, z: -4 };
    expect(clampToPlayableArena(inside, 0.35)).toBe(inside);
    expect(clampToPlayableArena({ x: 185, y: 0, z: 0 }, 0.35)).toEqual({ x: PLAYABLE_ARENA_BOUNDS.maxX - 0.35, y: 0, z: 0 });
    expect(clampToPlayableArena({ x: -40, y: 2, z: -99 }, 0.35)).toEqual({ x: PLAYABLE_ARENA_BOUNDS.minX + 0.35, y: 2, z: PLAYABLE_ARENA_BOUNDS.minZ + 0.35 });
  });

  it("contains the whole build volume, so every valid build cell is reachable", () => {
    const cs = BUILD_GRID.cellSize;
    expect(BUILD_BOUNDS.minX * cs - cs / 2).toBeGreaterThanOrEqual(PLAYABLE_ARENA_BOUNDS.minX);
    expect(BUILD_BOUNDS.maxX * cs + cs / 2).toBeLessThanOrEqual(PLAYABLE_ARENA_BOUNDS.maxX);
    expect(BUILD_BOUNDS.minZ * cs - cs / 2).toBeGreaterThanOrEqual(PLAYABLE_ARENA_BOUNDS.minZ);
    expect(BUILD_BOUNDS.maxZ * cs + cs / 2).toBeLessThanOrEqual(PLAYABLE_ARENA_BOUNDS.maxZ);
  });
});
