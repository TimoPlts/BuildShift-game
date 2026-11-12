/**
 * Focused regression: the redesigned 1v1 Box Fight arena is built at the
 * validated build scale (the shared `BUILD_GRID` / `BUILD_BOUNDS` lattice)
 * and keeps its required gameplay colliders and spawn intact.
 *
 * Uses Babylon's NullEngine (headless, no WebGL required).
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import {
  ARENA_COLLIDERS,
  BUILD_BOUNDS,
  BUILD_GRID,
  PLAYER_SPAWN,
} from "@buildshift/game-config";
import { createFoundationScene } from "./createFoundationScene";

function makeScene() {
  const engine = new NullEngine();
  const scene = createFoundationScene(engine);
  return { engine, scene };
}

const GROUND = ARENA_COLLIDERS.find((c) => c.id === "foundation-ground")!;
const [GX, , GZ] = GROUND.position;

/** The build volume's world span on each axis. */
const BUILD_SPAN =
  (BUILD_BOUNDS.maxX - BUILD_BOUNDS.minX + 1) * BUILD_GRID.cellSize;

/** The highest reachable build surface (top of the top build layer). */
const MAX_BUILD_HEIGHT =
  (BUILD_BOUNDS.maxLayer - BUILD_BOUNDS.minLayer + 1) * BUILD_GRID.layerHeight;

describe("1v1 arena at the validated build scale", () => {
  it("shell walls clear every build layer with a visible margin", () => {
    const { engine, scene } = makeScene();

    for (const name of [
      "arena-shell-n",
      "arena-shell-s",
      "arena-shell-e",
      "arena-shell-w",
    ]) {
      const wall = scene.getMeshByName(name);
      expect(wall, `${name} not found`).not.toBeNull();
      const bb = wall!.getBoundingInfo().boundingBox;
      // World-space top of the wall (bounding box is local-space).
      const top = wall!.position.y + bb.maximum.y;
      // Several levels of clearance: above the top build layer + margin.
      expect(top).toBeGreaterThan(MAX_BUILD_HEIGHT + 0.5);
    }

    scene.dispose();
    engine.dispose();
  });

  it("the enclosed ceiling covers the build volume and clears every layer", () => {
    const { engine, scene } = makeScene();

    const ceiling = scene.getMeshByName("arena-ceiling")!;
    const bb = ceiling.getBoundingInfo().boundingBox;
    const size = bb.maximum.subtract(bb.minimum);
    // Spans the full 30 m room footprint — wider than the build volume.
    expect(size.x).toBeGreaterThanOrEqual(BUILD_SPAN);
    expect(size.z).toBeGreaterThanOrEqual(BUILD_SPAN);
    // Underside sits well above the highest legal build surface, leaving a
    // third-person camera margin. Building heights are NOT capped.
    const underside = ceiling.position.y - size.y / 2;
    expect(underside).toBeGreaterThan(MAX_BUILD_HEIGHT + 3);

    scene.dispose();
    engine.dispose();
  });

  it("the floor carries NO grid, plate, lattice or other floor markings", () => {
    const { engine, scene } = makeScene();

    // User requirement: no squares/grid lines on the ground.
    const gridMeshes = scene.meshes.filter((m) =>
      m.name.startsWith("arena-grid-line-"),
    );
    expect(gridMeshes).toHaveLength(0);
    expect(scene.getMeshByName("arena-playfield-plate")).toBeNull();

    scene.dispose();
    engine.dispose();
  });

  it("the mirrored spawn-side wall marks are symmetric about the arena centre", () => {
    const { engine, scene } = makeScene();

    const primary = scene.getMeshByName("arena-spawnzone-mark-primary")!;
    const mirror = scene.getMeshByName("arena-spawnzone-mark-mirror")!;

    // Midpoint of the two marks is the arena centre on X/Z.
    expect((primary.position.x + mirror.position.x) / 2).toBeCloseTo(GX, 5);
    expect((primary.position.z + mirror.position.z) / 2).toBeCloseTo(GZ, 5);

    // The primary mark still sits behind the shared gameplay spawn exactly.
    expect(primary.position.x).toBeCloseTo(PLAYER_SPAWN.x, 5);

    scene.dispose();
    engine.dispose();
  });

  it("keeps every required gameplay collider mesh with its exact geometry", () => {
    const { engine, scene } = makeScene();

    for (const collider of ARENA_COLLIDERS) {
      const mesh = scene.getMeshByName(collider.id);
      expect(mesh, `collider mesh "${collider.id}" not found`).not.toBeNull();

      const [cx, cy, cz] = collider.position;
      expect(mesh!.position.x).toBeCloseTo(cx, 5);
      expect(mesh!.position.y).toBeCloseTo(cy, 5);
      expect(mesh!.position.z).toBeCloseTo(cz, 5);

      const bb = mesh!.getBoundingInfo().boundingBox;
      const size = bb.maximum.subtract(bb.minimum);
      const [hx, hy, hz] = collider.halfExtents;
      expect(size.x).toBeCloseTo(hx * 2, 3);
      expect(size.y).toBeCloseTo(hy * 2, 3);
      expect(size.z).toBeCloseTo(hz * 2, 3);
    }

    scene.dispose();
    engine.dispose();
  });
});
