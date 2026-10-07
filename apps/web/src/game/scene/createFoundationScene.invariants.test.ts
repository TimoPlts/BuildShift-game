/**
 * Invariant tests: the foundation scene factory must preserve gameplay
 * geometry (collider positions and dimensions) and must not mutate the
 * shared ARENA_COLLIDERS / PLAYER_SPAWN constants.
 *
 * These tests are designed to pass on both the current production factory
 * and any future visually-upgraded factory — they assert only on gameplay
 * geometry invariants, NOT on:
 *   - total mesh count (decorative meshes are allowed later)
 *   - lighting / material colors (intentionally changing)
 *
 * Uses Babylon's NullEngine (headless, no WebGL required).
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { createFoundationScene } from "./createFoundationScene";
import { ARENA_COLLIDERS, PLAYER_SPAWN } from "@buildshift/game-config";

/** Deep snapshot of the shared collider table and spawn for mutation checks. */
function snapshotColliders(): typeof ARENA_COLLIDERS {
  return ARENA_COLLIDERS.map((c) => ({
    id: c.id,
    position: [...c.position],
    halfExtents: [...c.halfExtents],
  }));
}

function snapshotSpawn(): { x: number; y: number; z: number } {
  return { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y, z: PLAYER_SPAWN.z };
}

describe("createFoundationScene — gameplay geometry invariants", () => {
  it("each canonical collider-id mesh has the shared centre position", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    for (const collider of ARENA_COLLIDERS) {
      const mesh = scene.getMeshByName(collider.id);
      expect(
        mesh,
        `mesh for collider "${collider.id}" not found in scene`,
      ).not.toBeNull();

      const [cx, cy, cz] = collider.position;
      expect(mesh!.position.x, `${collider.id}: x`).toBeCloseTo(cx, 5);
      expect(mesh!.position.y, `${collider.id}: y`).toBeCloseTo(cy, 5);
      expect(mesh!.position.z, `${collider.id}: z`).toBeCloseTo(cz, 5);
    }

    scene.dispose();
    engine.dispose();
  });

  it("each canonical collider-id mesh has 2*halfExtents dimensions", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    for (const collider of ARENA_COLLIDERS) {
      const mesh = scene.getMeshByName(collider.id);
      expect(
        mesh,
        `mesh for collider "${collider.id}" not found in scene`,
      ).not.toBeNull();

      const bb = mesh!.getBoundingInfo().boundingBox;
      const size = bb.maximum.subtract(bb.minimum);
      const [hx, hy, hz] = collider.halfExtents;

      expect(size.x, `${collider.id}: width`).toBeCloseTo(hx * 2, 3);
      expect(size.y, `${collider.id}: height`).toBeCloseTo(hy * 2, 3);
      expect(size.z, `${collider.id}: depth`).toBeCloseTo(hz * 2, 3);
    }

    scene.dispose();
    engine.dispose();
  });

  it("factory invocation does not mutate ARENA_COLLIDERS", () => {
    const before = snapshotColliders();

    const engine = new NullEngine();
    const scene = createFoundationScene(engine);
    // Also invoke a second time to ensure idempotency.
    const scene2 = createFoundationScene(engine);

    const after = snapshotColliders();

    // Each collider entry must be identical in id, position, halfExtents.
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      expect(after[i].id, `collider[${i}].id`).toBe(before[i].id);
      expect(after[i].position, `collider[${i}].position`).toEqual(
        before[i].position,
      );
      expect(after[i].halfExtents, `collider[${i}].halfExtents`).toEqual(
        before[i].halfExtents,
      );
    }

    scene.dispose();
    scene2.dispose();
    engine.dispose();
  });

  it("factory invocation does not mutate PLAYER_SPAWN", () => {
    const before = snapshotSpawn();

    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    const after = snapshotSpawn();

    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);

    scene.dispose();
    engine.dispose();
  });

  it("scene and engine dispose cleanly", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    // Disposal must not throw.
    expect(() => {
      scene.dispose();
    }).not.toThrow();
    expect(() => {
      engine.dispose();
    }).not.toThrow();
  });

  it("PLAYER_SPAWN is not inside any collider volume (boundary check)", () => {
    // The spawn point must be outside the interior of every collider,
    // ensuring the player does not spawn inside solid geometry.
    const spawn = { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y, z: PLAYER_SPAWN.z };

    for (const collider of ARENA_COLLIDERS) {
      const [cx, cy, cz] = collider.position;
      const [hx, hy, hz] = collider.halfExtents;

      const insideX = Math.abs(spawn.x - cx) < hx;
      const insideY = Math.abs(spawn.y - cy) < hy;
      const insideZ = Math.abs(spawn.z - cz) < hz;

      // All three must NOT be simultaneously true (strict interior).
      const strictlyInside = insideX && insideY && insideZ;
      expect(
        strictlyInside,
        `PLAYER_SPAWN is strictly inside collider "${collider.id}"`,
      ).toBe(false);
    }
  });
});
