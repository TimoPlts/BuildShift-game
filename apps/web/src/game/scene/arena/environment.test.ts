/**
 * Focused tests for the arena environment V2 module
 * (`arena/environment.ts`) — lifecycle, geometry invariants, material reuse
 * and disposal. Headless via Babylon's NullEngine.
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { setupArenaEnvironment } from "./environment";
import {
  ARENA_COLLIDERS,
  BUILD_BOUNDS,
  BUILD_GRID,
} from "@buildshift/game-config";

const GROUND_ID = "foundation-ground";

/** Every mesh this module is expected to create, by stable name prefix. */
const ENV_PREFIX = "arena-env-";

function groundHalfExtents(): { hx: number; hz: number } {
  const ground = ARENA_COLLIDERS.find((c) => c.id === GROUND_ID)!;
  return { hx: ground.halfExtents[0], hz: ground.halfExtents[2] };
}

/** Expected pylon height: same clearance rule as the V1 shell + margin. */
function expectedPylonHeight(): number {
  const shellHeight =
    (BUILD_BOUNDS.maxLayer - BUILD_BOUNDS.minLayer + 1) *
      BUILD_GRID.layerHeight +
      1.0;
  return shellHeight + 1.5;
}

function makeScene(): { engine: NullEngine; scene: Scene } {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  return { engine, scene };
}

function envMeshes(scene: Scene) {
  return scene.meshes.filter((m) => m.name.startsWith(ENV_PREFIX));
}

/**
 * World-space X/Z extents of a root-level mesh, derived from its position
 * plus the local geometry size (NullEngine does not refresh world bounding
 * boxes without a render tick, so position + local size is the stable route).
 */
function worldXZ(mesh: AbstractMesh) {
  const bb = mesh.getBoundingInfo().boundingBox;
  const size = bb.maximum.subtract(bb.minimum);
  return {
    minX: mesh.position.x - size.x / 2,
    maxX: mesh.position.x + size.x / 2,
    minZ: mesh.position.z - size.z / 2,
    maxZ: mesh.position.z + size.z / 2,
  };
}

describe("setupArenaEnvironment — lifecycle", () => {
  it("creates the bounded set of environment meshes", () => {
    const { engine, scene } = makeScene();
    setupArenaEnvironment(scene);

    const meshes = envMeshes(scene);
    // 4 pylons + 4 caps + 4 inlays + 4 center ring + 8 monoliths + 4 banners
    expect(meshes.length).toBe(28);

    for (const suffix of [
      "pylon-n", "pylon-s", "pylon-e", "pylon-w",
      "pylon-cap-n", "pylon-cap-s", "pylon-cap-e", "pylon-cap-w",
      "inlay-n", "inlay-s", "inlay-e", "inlay-w",
      "center-ring-n", "center-ring-s", "center-ring-e", "center-ring-w",
      "banner-n", "banner-s", "banner-e", "banner-w",
    ]) {
      expect(
        scene.getMeshByName(`arena-env-${suffix}`),
        `missing mesh arena-env-${suffix}`,
      ).not.toBeNull();
    }
    for (let i = 0; i < 8; i += 1) {
      expect(
        scene.getMeshByName(`arena-env-monolith-${i}`),
        `missing mesh arena-env-monolith-${i}`,
      ).not.toBeNull();
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

  it("reuses materials (pylon, backdrop, shared accent glow) — bounded count", () => {
    const { engine, scene } = makeScene();
    setupArenaEnvironment(scene);

    // Only 3 materials exist in a bare scene after this module runs.
    expect(scene.materials.length).toBe(3);

    const pyloins = ["n", "s", "e", "w"].map((id) =>
      scene.getMeshByName(`arena-env-pylon-${id}`)!,
    );
    const pylonMats = new Set(pyloins.map((m) => m.material));
    expect(pylonMats.size).toBe(1);

    const monoliths = envMeshes(scene).filter((m) =>
      m.name.startsWith("arena-env-monolith-"),
    );
    const monoMats = new Set(monoliths.map((m) => m.material));
    expect(monoMats.size).toBe(1);

    // Caps, inlays, ring and banners all share the accent-glow material.
    const accent = scene.getMaterialByName("arena-accent-glow-material");
    for (const name of [
      "arena-env-pylon-cap-n",
      "arena-env-inlay-e",
      "arena-env-center-ring-s",
      "arena-env-banner-w",
    ]) {
      expect(
        scene.getMeshByName(name)!.material,
        `${name} should reuse accent glow`,
      ).toBe(accent);
    }

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
  it("pyloins sit at the four wall ends and clear the shell height", () => {
    const { engine, scene } = makeScene();
    setupArenaEnvironment(scene);

    const { hx, hz } = groundHalfExtents();
    const pylonHeight = expectedPylonHeight();

    const expected: { id: string; x: number; z: number }[] = [
      { id: "n", x: 0, z: -hz },
      { id: "s", x: 0, z: hz },
      { id: "e", x: hx, z: 0 },
      { id: "w", x: -hx, z: 0 },
    ];
    for (const { id, x, z } of expected) {
      const pylon = scene.getMeshByName(`arena-env-pylon-${id}`)!;
      expect(pylon.position.x, `${id} x`).toBeCloseTo(x, 5);
      expect(pylon.position.z, `${id} z`).toBeCloseTo(z, 5);
      expect(pylon.position.y, `${id} y`).toBeCloseTo(pylonHeight / 2, 5);
      const size = pylon.getBoundingInfo().boundingBox.maximum
        .subtract(pylon.getBoundingInfo().boundingBox.minimum);
      expect(size.y, `${id} height`).toBeCloseTo(pylonHeight, 3);
    }

    scene.dispose();
    engine.dispose();
  });

  it("boundary inlays stay strictly inside the playable bounds", () => {
    const { engine, scene } = makeScene();
    setupArenaEnvironment(scene);

    const { hx, hz } = groundHalfExtents();
    for (const id of ["n", "s", "e", "w"]) {
      const bb = scene
        .getMeshByName(`arena-env-inlay-${id}`)!
        .getBoundingInfo()
        .boundingBox;
      const max = bb.maximum;
      const min = bb.minimum;
      expect(Math.max(Math.abs(min.x), Math.abs(max.x)), `${id} |x|`)
        .toBeLessThanOrEqual(hx);
      expect(Math.max(Math.abs(min.z), Math.abs(max.z)), `${id} |z|`)
        .toBeLessThanOrEqual(hz);
    }

    scene.dispose();
    engine.dispose();
  });

  it("center ring frames the center-box footprint without covering it", () => {
    const { engine, scene } = makeScene();
    setupArenaEnvironment(scene);

    const centerBox = ARENA_COLLIDERS.find((c) => c.id === "center-box")!;
    const half = centerBox.halfExtents[0];

    for (const id of ["n", "s", "e", "w"]) {
      const mesh = scene.getMeshByName(`arena-env-center-ring-${id}`)!;
      const wz = worldXZ(mesh);
      // The ring band must be OUTSIDE the center-box footprint on both
      // sides along its long axis (no overlap with the box's visual mesh).
      if (id === "n" || id === "s") {
        const edge = Math.min(Math.abs(wz.minZ), Math.abs(wz.maxZ));
        expect(edge, `${id} ring |z|`).toBeGreaterThan(half);
        expect(Math.abs(mesh.position.x)).toBeCloseTo(0, 5);
      } else {
        const edge = Math.min(Math.abs(wz.minX), Math.abs(wz.maxX));
        expect(edge, `${id} ring |x|`).toBeGreaterThan(half);
        expect(Math.abs(mesh.position.z)).toBeCloseTo(0, 5);
      }
    }

    scene.dispose();
    engine.dispose();
  });

  it("backdrop monoliths stay outside the playable bounds", () => {
    const { engine, scene } = makeScene();
    setupArenaEnvironment(scene);

    const { hx, hz } = groundHalfExtents();
    for (let i = 0; i < 8; i += 1) {
      const mono = scene.getMeshByName(`arena-env-monolith-${i}`)!;
      const bb = mono.getBoundingInfo().boundingBox;
      // Nearest corner of the monolith to the centre must clear the slab.
      const minDistX = Math.abs(mono.position.x) - (bb.maximum.x - bb.minimum.x) / 2;
      const minDistZ = Math.abs(mono.position.z) - (bb.maximum.z - bb.minimum.z) / 2;
      expect(
        Math.max(minDistX, minDistZ),
        `monolith-${i} closest approach to centre`,
      ).toBeGreaterThan(Math.max(hx, hz));
    }

    scene.dispose();
    engine.dispose();
  });

  it("banners are offset inward from their pylons toward the arena centre", () => {
    const { engine, scene } = makeScene();
    setupArenaEnvironment(scene);

    for (const id of ["n", "s", "e", "w"]) {
      const pylon = scene.getMeshByName(`arena-env-pylon-${id}`)!;
      const banner = scene.getMeshByName(`arena-env-banner-${id}`)!;
      // The banner centre must be strictly closer to the arena centre (0,0)
      // along at least one axis than its pylon.
      const pylonDist = Math.hypot(pylon.position.x, pylon.position.z);
      const bannerDist = Math.hypot(banner.position.x, banner.position.z);
      expect(bannerDist, `${id} banner distance`).toBeLessThan(pylonDist);
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
