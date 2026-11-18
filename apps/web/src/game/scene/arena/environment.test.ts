/**
 * Focused tests for the arena perimeter-architecture module
 * (`arena/environment.ts`) — lifecycle, geometry invariants, material reuse
 * and disposal in the clean Box Fight room. Headless via Babylon's
 * NullEngine.
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { setupArenaEnvironment } from "./environment";
import { ceilingHeight, shellWallHeight } from "../arenaDecorations";
import {
  ARENA_COLLIDERS,
  BUILD_BOUNDS,
  BUILD_GRID,
} from "@buildshift/game-config";

const GROUND_ID = "foundation-ground";

/** Every mesh this module creates lives under this stable name prefix. */
const ENV_PREFIX = "arena-env-";

function groundFrame(): { gx: number; gz: number; hx: number; hz: number } {
  const ground = ARENA_COLLIDERS.find((c) => c.id === GROUND_ID)!;
  return {
    gx: ground.position[0],
    gz: ground.position[2],
    hx: ground.halfExtents[0],
    hz: ground.halfExtents[2],
  };
}

/** Half-span of the buildable volume — decoration must stay outside it at
 *  any height below the top build layer. */
function buildHalfSpan(): number {
  return (
    ((BUILD_BOUNDS.maxX - BUILD_BOUNDS.minX + 1) * BUILD_GRID.cellSize) / 2
  );
}

function makeScene(): { engine: NullEngine; scene: Scene } {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  return { engine, scene };
}

function envMeshes(scene: Scene) {
  return scene.meshes.filter((m) => m.name.startsWith(ENV_PREFIX));
}

/** Lowest world-space Y of a root-level mesh (NullEngine does not refresh
 *  world bounding boxes without a render tick). */
function lowestY(mesh: AbstractMesh): number {
  const bb = mesh.getBoundingInfo().boundingBox;
  return mesh.position.y + bb.minimum.y;
}

/** Size (local geometry extents) of a root-level mesh. */
function sizeOf(mesh: AbstractMesh) {
  const bb = mesh.getBoundingInfo().boundingBox;
  return bb.maximum.subtract(bb.minimum);
}

describe("setupArenaEnvironment — lifecycle", () => {
  it("creates the bounded set of perimeter meshes (4 bands + 8 pilasters + 4 crowns + 4 beams)", () => {
    const { engine, scene } = makeScene();
    setupArenaEnvironment(scene);

    const meshes = envMeshes(scene);
    expect(meshes.length).toBe(20);

    for (const suffix of [
      "band-n", "band-s", "band-e", "band-w",
      "crown-n", "crown-s", "crown-e", "crown-w",
    ]) {
      expect(
        scene.getMeshByName(`arena-env-${suffix}`),
        `missing mesh arena-env-${suffix}`,
      ).not.toBeNull();
    }
    for (const side of ["n", "s", "e", "w"]) {
      for (const i of [0, 1]) {
        expect(
          scene.getMeshByName(`arena-env-pilaster-${side}-${i}`),
          `missing mesh arena-env-pilaster-${side}-${i}`,
        ).not.toBeNull();
      }
    }
    for (let i = 0; i < 4; i += 1) {
      expect(
        scene.getMeshByName(`arena-env-beam-${i}`),
        `missing mesh arena-env-beam-${i}`,
      ).not.toBeNull();
    }

    scene.dispose();
    engine.dispose();
  });

  it("removes the old outdoor backdrop clutter (pylons, monoliths, inlays, rings, banners)", () => {
    const { engine, scene } = makeScene();
    setupArenaEnvironment(scene);

    for (const suffix of [
      "pylon-n", "pylon-s", "pylon-e", "pylon-w",
      "pylon-cap-n", "inlay-n", "inlay-e",
      "center-ring-n", "center-ring-w",
      "banner-n", "banner-s", "banner-e", "banner-w",
      "monolith-0", "monolith-7",
    ]) {
      expect(
        scene.getMeshByName(`arena-env-${suffix}`),
        `obsolete clutter arena-env-${suffix} should not exist`,
      ).toBeNull();
    }

    scene.dispose();
    engine.dispose();
  });

  it("every environment mesh is non-pickable and non-collidable", () => {
    const { engine, scene } = makeScene();
    setupArenaEnvironment(scene);

    const meshes = envMeshes(scene);
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      expect(mesh.isPickable, `${mesh.name} isPickable`).toBe(false);
      expect(mesh.checkCollisions, `${mesh.name} checkCollisions`).toBe(false);
    }

    scene.dispose();
    engine.dispose();
  });

  it("reuses shared materials (section + trim only) — bounded count", () => {
    const { engine, scene } = makeScene();
    setupArenaEnvironment(scene);

    // Only 2 materials exist in a bare scene after this module runs.
    expect(scene.materials.length).toBe(2);

    const section = scene.getMaterialByName("arena-section-material");
    const trim = scene.getMaterialByName("arena-trim-material");
    expect(section).not.toBeNull();
    expect(trim).not.toBeNull();

    for (const name of [
      "arena-env-band-n",
      "arena-env-pilaster-e-1",
    ]) {
      expect(scene.getMeshByName(name)!.material, name).toBe(section);
    }
    for (const name of ["arena-env-crown-s", "arena-env-beam-2"]) {
      expect(scene.getMeshByName(name)!.material, name).toBe(trim);
    }

    scene.dispose();
    engine.dispose();
  });

  it("does not double-create materials when decorations already ran", () => {
    const { engine, scene } = makeScene();
    // Simulate the shell having run first by re-invoking the environment
    // module twice — the shared ensure-materials must be idempotent.
    setupArenaEnvironment(scene);
    setupArenaEnvironment(scene);
    expect(scene.materials.filter((m) => m.name === "arena-trim-material")).toHaveLength(1);
    expect(scene.materials.filter((m) => m.name === "arena-section-material")).toHaveLength(1);

    scene.dispose();
    engine.dispose();
  });

  it("scene and engine dispose cleanly", () => {
    const { engine, scene } = makeScene();
    setupArenaEnvironment(scene);

    expect(() => scene.dispose()).not.toThrow();
    expect(() => engine.dispose()).not.toThrow();
  });
});

describe("setupArenaEnvironment — geometry invariants", () => {
  it("bands and pilasters are flush on the walls' inner faces, full-perimeter only", () => {
    const { engine, scene } = makeScene();
    setupArenaEnvironment(scene);

    const { hx, hz } = groundFrame();
    const wallHeight = shellWallHeight();

    // Band centres sit just inside each wall's inner face (wall centre ±
    // half thickness, minus half the band's proud thickness).
    const bandN = scene.getMeshByName("arena-env-band-n")!;
    expect(bandN.position.z).toBeCloseTo(-hz + 0.15 + 0.05, 3);
    const bandS = scene.getMeshByName("arena-env-band-s")!;
    expect(bandS.position.z).toBeCloseTo(hz - 0.15 - 0.05, 3);
    const bandE = scene.getMeshByName("arena-env-band-e")!;
    expect(bandE.position.x).toBeCloseTo(hx - 0.15 - 0.05, 3);
    const pilasterW = scene.getMeshByName("arena-env-pilaster-w-0")!;
    expect(pilasterW.position.x).toBeGreaterThan(-hx + 0.15);

    // Pilasters span the full wall height.
    const pilaster = scene.getMeshByName("arena-env-pilaster-n-0")!;
    const size = sizeOf(pilaster);
    expect(size.y).toBeCloseTo(wallHeight, 3);

    scene.dispose();
    engine.dispose();
  });

  it("no decoration touches the playable floor inside the build volume", () => {
    const { engine, scene } = makeScene();
    setupArenaEnvironment(scene);

    const buildHalf = buildHalfSpan();
    for (const mesh of envMeshes(scene)) {
      const bb = mesh.getBoundingInfo().boundingBox;
      const size = bb.maximum.subtract(bb.minimum);
      const minAbsX = Math.max(0, Math.abs(mesh.position.x) - size.x / 2);
      const minAbsZ = Math.max(0, Math.abs(mesh.position.z) - size.z / 2);
      // "Lower volumes" = everything up to the top legal build surface.
      // (Wall tops now meet the ceiling underside, so the wall height is no
      // longer the meaningful threshold — ceiling-hugging pieces like the
      // beams sit just below it but must still pass.)
      const buildTop =
        (BUILD_BOUNDS.maxLayer - BUILD_BOUNDS.minLayer + 1) *
        BUILD_GRID.layerHeight;
      if (lowestY(mesh) < buildTop) {
        // Anything that reaches down into the room's lower volumes must be
        // fully outside the buildable columns (i.e. at the perimeter).
        const insideColumns = minAbsX < buildHalf && minAbsZ < buildHalf;
        expect(insideColumns, `${mesh.name} intrudes on the build volume`).toBe(
          false,
        );
      }
    }

    scene.dispose();
    engine.dispose();
  });

  it("crowns and beams hug the ceiling above every legal build", () => {
    const { engine, scene } = makeScene();
    setupArenaEnvironment(scene);

    const maxBuild =
      (BUILD_BOUNDS.maxLayer - BUILD_BOUNDS.minLayer + 1) *
      BUILD_GRID.layerHeight;
    const ceilingY = ceilingHeight();

    for (const name of [
      "arena-env-crown-n",
      "arena-env-crown-e",
      "arena-env-beam-0",
      "arena-env-beam-3",
    ]) {
      const mesh = scene.getMeshByName(name)!;
      const size = sizeOf(mesh);
      expect(lowestY(mesh), `${name} lowest point`).toBeGreaterThan(maxBuild);
      expect(mesh.position.y + size.y / 2).toBeLessThanOrEqual(ceilingY + 1e-6);
    }

    scene.dispose();
    engine.dispose();
  });

  it("does not mutate the shared collider table", () => {
    const before = ARENA_COLLIDERS.map((c) => ({
      id: c.id,
      position: [...c.position],
      halfExtents: [...c.halfExtents],
    }));
    const { engine, scene } = makeScene();
    setupArenaEnvironment(scene);
    scene.dispose();
    engine.dispose();

    expect(ARENA_COLLIDERS.length).toBe(before.length);
    for (let i = 0; i < before.length; i += 1) {
      expect(ARENA_COLLIDERS[i].position).toEqual(before[i].position);
      expect(ARENA_COLLIDERS[i].halfExtents).toEqual(before[i].halfExtents);
    }
  });
});
