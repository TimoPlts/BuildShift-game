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
const [HX, , HZ] = GROUND.halfExtents;

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

  it("the play-field plate spans the build volume on both axes", () => {
    const { engine, scene } = makeScene();

    const plate = scene.getMeshByName("arena-playfield-plate")!;
    const bb = plate.getBoundingInfo().boundingBox;
    const size = bb.maximum.subtract(bb.minimum);
    expect(size.x).toBeCloseTo(BUILD_SPAN, 3);
    expect(size.z).toBeCloseTo(BUILD_SPAN, 3);
    // Compact: the plate is inset from the 30 m ground boundary.
    expect(size.x).toBeLessThan(HX * 2);
    expect(size.z).toBeLessThan(HZ * 2);

    scene.dispose();
    engine.dispose();
  });

  it("floor grid lines sit exactly on build-cell boundaries inside the shell", () => {
    const { engine, scene } = makeScene();

    const { cellSize } = BUILD_GRID;
    const gridMeshes = scene.meshes.filter((m) =>
      m.name.startsWith("arena-grid-line-"),
    );
    expect(gridMeshes.length).toBeGreaterThan(0);

    for (const mesh of gridMeshes) {
      // The line is centred on a cell boundary in its varying axis.
      const onBoundary = (p: number): boolean =>
        Math.abs(p - Math.round(p / cellSize) * cellSize) < 1e-9;
      const isXLine = mesh.name.startsWith("arena-grid-line-x-");
      const boundaryPos = isXLine ? mesh.position.z : mesh.position.x;
      expect(
        onBoundary(boundaryPos),
        `${mesh.name} not on a cell boundary`,
      ).toBe(true);
      // Strictly inside the arena shell on every axis.
      expect(Math.abs(mesh.position.x)).toBeLessThan(HX);
      expect(Math.abs(mesh.position.z)).toBeLessThan(HZ);
    }

    scene.dispose();
    engine.dispose();
  });

  it("the mirrored spawn pads are symmetric about the arena centre", () => {
    const { engine, scene } = makeScene();

    const primary = scene.getMeshByName("arena-spawn-pad")!;
    const mirror = scene.getMeshByName("arena-spawn-pad-mirror")!;

    // Midpoint of the two pads is the arena centre on X/Z.
    expect((primary.position.x + mirror.position.x) / 2).toBeCloseTo(GX, 5);
    expect((primary.position.z + mirror.position.z) / 2).toBeCloseTo(GZ, 5);

    // The primary pad still marks the shared gameplay spawn exactly.
    expect(primary.position.x).toBeCloseTo(PLAYER_SPAWN.x, 5);
    expect(primary.position.z).toBeCloseTo(PLAYER_SPAWN.z, 5);

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
