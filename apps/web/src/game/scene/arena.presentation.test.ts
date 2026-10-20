/**
 * Focused regression coverage for the Box Fight arena presentation.
 *
 * Proves:
 *   1. The canonical ARENA_COLLIDERS and PLAYER_SPAWN configuration is
 *      byte-for-byte unchanged after scene creation.
 *   2. Every collider presentation mesh is non-pickable and non-collidable,
 *      ensuring it cannot intercept gameplay picking or physics queries.
 *   3. Every decorative/presentation-only mesh (shell, caps, floor grid,
 *      spawn markers, skybox) is non-pickable and non-collidable.
 *
 * Uses Babylon's NullEngine (headless, no WebGL required).
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { createFoundationScene } from "./createFoundationScene";
import {
  ARENA_COLLIDERS,
  BUILD_BOUNDS,
  BUILD_GRID,
  PLAYER_SPAWN,
} from "@buildshift/game-config";

/** Canonical snapshot of the collider table (id, position, halfExtents). */
const CANONICAL_COLLIDERS = ARENA_COLLIDERS.map((c) => ({
  id: c.id,
  position: [...c.position],
  halfExtents: [...c.halfExtents],
}));

/** Canonical snapshot of the player spawn. */
const CANONICAL_SPAWN = { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y, z: PLAYER_SPAWN.z };

/**
 * The floor grid line names expected for one axis, derived the same way
 * `setupArenaDecorations` does: cell boundaries `i*cellSize` for
 * `i = min..max+1`, clipped to the arena interior.
 */
function expectedGridLineNames(
  axis: "x" | "z",
  min: number,
  max: number,
  halfExtent: number,
): string[] {
  const names: string[] = [];
  for (let i = min; i <= max + 1; i += 1) {
    if (Math.abs(i * BUILD_GRID.cellSize) < halfExtent) {
      names.push(`arena-grid-line-${axis}-${names.length}`);
    }
  }
  return names;
}

const GROUND = ARENA_COLLIDERS.find((c) => c.id === "foundation-ground")!;

/**
 * Names of all presentation-only (non-gameplay) meshes created by
 * `createFoundationScene` and its sub-modules. These must never
 * participate in picking or collision.
 */
const PRESENTATION_MESH_NAMES = [
  // Sky
  "arena-skybox",
  // Play-field plate (build-area boundary)
  "arena-playfield-plate",
  // Indestructible shell
  "arena-shell-n",
  "arena-shell-s",
  "arena-shell-e",
  "arena-shell-w",
  // Accent shell caps
  "arena-shell-cap-n",
  "arena-shell-cap-s",
  "arena-shell-cap-e",
  "arena-shell-cap-w",
  // Floor build grid
  ...expectedGridLineNames("x", BUILD_BOUNDS.minX, BUILD_BOUNDS.maxX, GROUND.halfExtents[0]),
  ...expectedGridLineNames("z", BUILD_BOUNDS.minZ, BUILD_BOUNDS.maxZ, GROUND.halfExtents[2]),
  // Mirrored 1v1 spawn markers
  "arena-spawn-pad",
  "arena-spawn-bar",
  "arena-spawn-pad-mirror",
  "arena-spawn-bar-mirror",
];

describe("arena presentation — canonical config invariants", () => {
  it("ARENA_COLLIDERS is unchanged after scene creation", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    expect(ARENA_COLLIDERS).toHaveLength(CANONICAL_COLLIDERS.length);
    for (let i = 0; i < CANONICAL_COLLIDERS.length; i++) {
      const c = ARENA_COLLIDERS[i];
      expect(c.id).toBe(CANONICAL_COLLIDERS[i].id);
      expect(c.position).toEqual(CANONICAL_COLLIDERS[i].position);
      expect(c.halfExtents).toEqual(CANONICAL_COLLIDERS[i].halfExtents);
    }

    scene.dispose();
    engine.dispose();
  });

  it("PLAYER_SPAWN is unchanged after scene creation", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    expect(PLAYER_SPAWN.x).toBe(CANONICAL_SPAWN.x);
    expect(PLAYER_SPAWN.y).toBe(CANONICAL_SPAWN.y);
    expect(PLAYER_SPAWN.z).toBe(CANONICAL_SPAWN.z);

    scene.dispose();
    engine.dispose();
  });

  it("collider count is exactly 8", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);
    // Creating the scene must not add or remove colliders.
    expect(ARENA_COLLIDERS).toHaveLength(8);
    scene.dispose();
    engine.dispose();
  });
});

describe("arena presentation — collider meshes are non-pickable/non-collidable", () => {
  it("every collider presentation mesh has isPickable=false", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    for (const collider of ARENA_COLLIDERS) {
      const mesh = scene.getMeshByName(collider.id);
      expect(
        mesh,
        `collider mesh "${collider.id}" not found`,
      ).not.toBeNull();
      expect(
        mesh!.isPickable,
        `collider mesh "${collider.id}" must be non-pickable`,
      ).toBe(false);
    }

    scene.dispose();
    engine.dispose();
  });

  it("every collider presentation mesh has checkCollisions=false", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    for (const collider of ARENA_COLLIDERS) {
      const mesh = scene.getMeshByName(collider.id);
      expect(
        mesh,
        `collider mesh "${collider.id}" not found`,
      ).not.toBeNull();
      expect(
        mesh!.checkCollisions,
        `collider mesh "${collider.id}" must be non-collidable`,
      ).toBe(false);
    }

    scene.dispose();
    engine.dispose();
  });
});

describe("arena presentation — decorative meshes are non-pickable/non-collidable", () => {
  it("every presentation-only mesh exists with isPickable=false", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    for (const name of PRESENTATION_MESH_NAMES) {
      const mesh = scene.getMeshByName(name);
      expect(
        mesh,
        `presentation mesh "${name}" not found in scene`,
      ).not.toBeNull();
      expect(
        mesh!.isPickable,
        `presentation mesh "${name}" must be non-pickable`,
      ).toBe(false);
    }

    scene.dispose();
    engine.dispose();
  });

  it("every presentation-only mesh has checkCollisions=false", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    for (const name of PRESENTATION_MESH_NAMES) {
      const mesh = scene.getMeshByName(name);
      expect(
        mesh,
        `presentation mesh "${name}" not found in scene`,
      ).not.toBeNull();
      expect(
        mesh!.checkCollisions,
        `presentation mesh "${name}" must be non-collidable`,
      ).toBe(false);
    }

    scene.dispose();
    engine.dispose();
  });

  it("removes the old clutter pieces (posts, border strips, center ring)", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    for (const name of [
      "arena-post-ne",
      "arena-post-nw",
      "arena-post-se",
      "arena-post-sw",
      "arena-border-n",
      "arena-border-s",
      "arena-border-e",
      "arena-border-w",
      "arena-center-ring",
    ]) {
      expect(
        scene.getMeshByName(name),
        `clutter mesh "${name}" should no longer exist`,
      ).toBeNull();
    }

    scene.dispose();
    engine.dispose();
  });
});
