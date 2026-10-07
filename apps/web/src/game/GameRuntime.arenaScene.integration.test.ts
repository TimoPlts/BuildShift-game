import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ARENA_COLLIDERS, PLAYER_SPAWN } from "@buildshift/game-config";
import { ARENA_PALETTE } from "./scene/arena";
import { createFoundationScene } from "./scene/createFoundationScene";

// Exercise the real scene factory, not a parallel/mock scene. Source checks
// below guard the production entry path; they are not a browser smoke test.
describe("production runtime arena visuals", () => {
  let engine: NullEngine | undefined;
  afterEach(() => engine?.dispose());

  it("uses this factory through App -> GameCanvas -> GameRuntime", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const canvas = readFileSync(new URL("./GameCanvas.tsx", import.meta.url), "utf8");
    const runtime = readFileSync(new URL("./GameRuntime.ts", import.meta.url), "utf8");
    expect(app).toMatch(/import\s*\{[^}]*GameCanvas[^}]*\}\s*from\s*["']\.\/game\/GameCanvas["']/);
    expect(app).toContain("<GameCanvas");
    expect(canvas).toContain("GameRuntime.create(canvas)");
    expect(runtime).toMatch(/import\s*\{\s*createFoundationScene\s*\}\s*from\s*["']\.\/scene\/createFoundationScene["']/);
    expect(runtime).toMatch(/const\s+scene\s*=\s*createFoundationScene\(engine\)/);
  });

  it("creates all visuals with their intended materials, lighting and safety flags", () => {
    engine = new NullEngine();
    const scene = createFoundationScene(engine);
    expect(scene.lights).toHaveLength(2);
    const hemi = scene.getLightByName("arena-hemisphere");
    const directional = scene.getLightByName("arena-directional");
    expect(hemi).toBeInstanceOf(HemisphericLight);
    expect(directional).toBeInstanceOf(DirectionalLight);
    expect(hemi!.intensity).toBeCloseTo(0.6);
    expect(directional!.intensity).toBeCloseTo(0.8);
    expect(scene.clearColor.asArray()).toEqual([...ARENA_PALETTE.skyColor.asArray(), 1]);
    for (const [name, color] of [
      ["ground-material", ARENA_PALETTE.groundColor],
      ["accent-material", ARENA_PALETTE.accentColor],
    ] as const) {
      const material = scene.getMaterialByName(name);
      expect(material).toBeInstanceOf(StandardMaterial);
      expect((material as StandardMaterial).diffuseColor.asArray()).toEqual(color.asArray());
    }
    for (const name of ["arena-skybox", "arena-wall-n", "arena-wall-s", "arena-wall-e", "arena-wall-w", "arena-center-ring"]) {
      const mesh = scene.getMeshByName(name);
      expect(mesh, name).not.toBeNull();
      expect(mesh!.isPickable).toBe(false);
      expect(mesh!.checkCollisions).toBe(false);
    }
    const meshes = [...scene.meshes];
    const lights = [...scene.lights];
    scene.dispose();
    expect(scene.isDisposed).toBe(true);
    expect(meshes.every(mesh => mesh.isDisposed())).toBe(true);
    expect(lights.every(light => light.isDisposed())).toBe(true);
  });

  it("preserves all shared collider geometry and spawn configuration", () => {
    const before = JSON.stringify({ colliders: ARENA_COLLIDERS, spawn: PLAYER_SPAWN });
    engine = new NullEngine();
    const scene = createFoundationScene(engine);
    for (const collider of ARENA_COLLIDERS) {
      const matching = scene.meshes.filter(mesh => mesh.name === collider.id);
      expect(matching, collider.id).toHaveLength(1);
      const mesh = matching[0]!;
      expect(mesh.position.asArray()).toEqual([...collider.position]);
      const bounds = mesh.getBoundingInfo().boundingBox;
      const dimensions = bounds.maximum.subtract(bounds.minimum).asArray();
      collider.halfExtents.forEach((extent, axis) => {
        expect(dimensions[axis]).toBeCloseTo(extent * 2, 5);
      });
    }
    expect(JSON.stringify({ colliders: ARENA_COLLIDERS, spawn: PLAYER_SPAWN })).toBe(before);
  });
});
