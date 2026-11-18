/**
 * Focused regression coverage for the clean Box Fight arena presentation.
 *
 * Proves:
 *   1. The canonical ARENA_COLLIDERS and PLAYER_SPAWN configuration is
 *      byte-for-byte unchanged after scene creation.
 *   2. Every collider presentation mesh is non-pickable and non-collidable,
 *      ensuring it cannot intercept gameplay picking or physics queries.
 *   3. Every decorative/presentation-only mesh (room shell, caps, ceiling,
 *      perimeter architecture, spawn wall marks, sky dome) is non-pickable
 *      and non-collidable.
 *   4. All removed clutter (floor grid, plate, spawn pads/bars/rings/
 *      strips, outdoor backdrop pylons/monoliths/banners/inlays/rings)
 *      stays gone.
 *
 * Uses Babylon's NullEngine (headless, no WebGL required).
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { createFoundationScene } from "./createFoundationScene";
import {
  ARENA_COLLIDERS,
  BUILD_BOUNDS,
  BUILD_GRID,
  PLAYER_SPAWN,
} from "@buildshift/game-config";

/** World-space size of a mesh (CreateBox bakes dimensions into vertices). */
function worldSize(mesh: AbstractMesh) {
  return mesh.getBoundingInfo().boundingBox.extendSizeWorld.scale(2);
}

/** Canonical snapshot of the collider table (id, position, halfExtents). */
const CANONICAL_COLLIDERS = ARENA_COLLIDERS.map((c) => ({
  id: c.id,
  position: [...c.position],
  halfExtents: [...c.halfExtents],
}));

/** Canonical snapshot of the player spawn. */
const CANONICAL_SPAWN = { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y, z: PLAYER_SPAWN.z };

const GROUND = ARENA_COLLIDERS.find((c) => c.id === "foundation-ground")!;

/** Pilaster ids for one wall's pair of perimeter pilasters. */
const PILASTER_NAMES = ["n", "s", "e", "w"].flatMap((side) => [
  `arena-env-pilaster-${side}-0`,
  `arena-env-pilaster-${side}-1`,
]);

/**
 * Names of all presentation-only (non-gameplay) meshes created by
 * `createFoundationScene` and its sub-modules. These must never
 * participate in picking or collision.
 */
const PRESENTATION_MESH_NAMES = [
  // Room background dome
  "arena-skybox",
  // Room shell (pale-blue walls + brass caps) + enclosed ceiling
  "arena-shell-n",
  "arena-shell-s",
  "arena-shell-e",
  "arena-shell-w",
  "arena-shell-cap-n",
  "arena-shell-cap-s",
  "arena-shell-cap-e",
  "arena-shell-cap-w",
  "arena-ceiling",
  // Perimeter architecture (burgundy bands + pilasters, brass crown + beams)
  "arena-env-band-n",
  "arena-env-band-s",
  "arena-env-band-e",
  "arena-env-band-w",
  ...PILASTER_NAMES,
  "arena-env-crown-n",
  "arena-env-crown-s",
  "arena-env-crown-e",
  "arena-env-crown-w",
  "arena-env-beam-0",
  "arena-env-beam-1",
  "arena-env-beam-2",
  "arena-env-beam-3",
  // Spawn-side wall marks
  "arena-spawnzone-mark-primary",
  "arena-spawnzone-mark-mirror",
];

/** Everything that used to clutter the outdoor playground — must be gone. */
const REMOVED_CLUTTER_NAMES = [
  // Old playground furniture / posts / borders
  "arena-post-ne",
  "arena-post-nw",
  "arena-post-se",
  "arena-post-sw",
  "arena-border-n",
  "arena-border-s",
  "arena-border-e",
  "arena-border-w",
  "arena-center-ring",
  // Floor plate, grid, spawn clutter
  "arena-playfield-plate",
  "arena-spawn-pad",
  "arena-spawn-pad-mirror",
  "arena-spawn-bar",
  "arena-spawn-bar-mirror",
  "arena-spawnzone-ring-primary",
  "arena-spawnzone-ring-mirror",
  "arena-spawnzone-strip-primary",
  "arena-spawnzone-strip-mirror",
  // Outdoor backdrop / boundary clutter
  "arena-env-pylon-n",
  "arena-env-pylon-s",
  "arena-env-pylon-e",
  "arena-env-pylon-w",
  "arena-env-pylon-cap-n",
  "arena-env-monolith-0",
  "arena-env-monolith-7",
  "arena-env-inlay-n",
  "arena-env-inlay-s",
  "arena-env-inlay-e",
  "arena-env-inlay-w",
  "arena-env-center-ring-n",
  "arena-env-center-ring-s",
  "arena-env-center-ring-e",
  "arena-env-center-ring-w",
  "arena-env-banner-n",
  "arena-env-banner-s",
  "arena-env-banner-e",
  "arena-env-banner-w",
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

  it("scene creation neither adds nor removes shared colliders", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);
    // Compare against the import-time snapshot rather than a hardcoded
    // count, so the invariant holds across collider-table changes made in
    // the shared config by other tasks.
    expect(ARENA_COLLIDERS).toHaveLength(CANONICAL_COLLIDERS.length);
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

  it("keeps all playground/backdrop/floor clutter removed", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    for (const name of REMOVED_CLUTTER_NAMES) {
      expect(
        scene.getMeshByName(name),
        `clutter mesh "${name}" should no longer exist`,
      ).toBeNull();
    }

    // No floor grid lines by name prefix either.
    expect(
      scene.meshes.filter((m) => m.name.startsWith("arena-grid-line-")),
    ).toHaveLength(0);

    scene.dispose();
    engine.dispose();
  });
});

describe("arena presentation — decorations derive from canonical config", () => {
  const [gx, , gz] = GROUND.position;
  const [hx, , hz] = GROUND.halfExtents;

  const buildLayerSpan =
    (BUILD_BOUNDS.maxLayer - BUILD_BOUNDS.minLayer + 1) * BUILD_GRID.layerHeight;

  it("shell walls sit on the ground's half-extents and clear the build layers", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    const north = scene.getMeshByName("arena-shell-n")!;
    const south = scene.getMeshByName("arena-shell-s")!;
    const east = scene.getMeshByName("arena-shell-e")!;
    const west = scene.getMeshByName("arena-shell-w")!;

    expect(north.position.z).toBeCloseTo(gz - hz);
    expect(south.position.z).toBeCloseTo(gz + hz);
    expect(east.position.x).toBeCloseTo(gx + hx);
    expect(west.position.x).toBeCloseTo(gx - hx);

    // The shell must clear every build layer derived from BUILD_BOUNDS.
    for (const wall of [north, south, east, west]) {
      expect(worldSize(wall).y).toBeGreaterThanOrEqual(buildLayerSpan);
    }

    scene.dispose();
    engine.dispose();
  });

  it("ceiling encloses the room above the build layers with camera margin", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    const ceiling = scene.getMeshByName("arena-ceiling")!;
    const size = worldSize(ceiling);
    expect(size.x).toBeCloseTo(hx * 2);
    expect(size.z).toBeCloseTo(hz * 2);
    const underside = ceiling.position.y - size.y / 2;
    expect(underside).toBeGreaterThan(buildLayerSpan);

    scene.dispose();
    engine.dispose();
  });

  it("all perimeter decoration stays off the playable floor inside the build volume", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    // Build volume half-span; anything decorative at floor level inside it
    // would be clutter on the playable ground.
    const buildHalf =
      ((BUILD_BOUNDS.maxX - BUILD_BOUNDS.minX + 1) * BUILD_GRID.cellSize) / 2;

    for (const mesh of scene.meshes) {
      if (!mesh.name.startsWith("arena-")) continue;
      if (mesh.name === "arena-skybox" || mesh.name === "foundation-ground") {
        continue;
      }
      const bb = mesh.getBoundingInfo().boundingBox;
      const minY = bb.minimum.y + mesh.position.y;
      const maxY = bb.maximum.y + mesh.position.y;
      const minAbsX = Math.max(0, Math.abs(mesh.position.x) - (bb.maximum.x - bb.minimum.x) / 2);
      const minAbsZ = Math.max(0, Math.abs(mesh.position.z) - (bb.maximum.z - bb.minimum.z) / 2);
      const insideBuildColumns = minAbsX < buildHalf && minAbsZ < buildHalf;
      // A mesh may only dip into low space outside the build columns, or it
      // must sit fully above every legal build height.
      if (minY < buildLayerSpan) {
        expect(
          insideBuildColumns,
          `${mesh.name} intrudes into the buildable floor`,
        ).toBe(false);
      }
      void maxY;
    }

    scene.dispose();
    engine.dispose();
  });

  it("decorative presentation disposes cleanly with no leftover meshes", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    const meshCountBefore = scene.meshes.length;
    expect(meshCountBefore).toBeGreaterThan(0);

    expect(() => scene.dispose()).not.toThrow();
    expect(scene.meshes.length).toBe(0);
    expect(scene.materials.length).toBe(0);

    expect(() => engine.dispose()).not.toThrow();
  });
});
