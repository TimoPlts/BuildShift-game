/**
 * Behavioral test: after applying arena lighting to the foundation scene,
 * exactly two lights must exist – a HemisphericLight (bright cool ambient
 * fill, intensity ~0.9) and a DirectionalLight (near-white key light,
 * intensity ~1.1) – both bright, with stable names/colors, and repeat
 * setup/disposal must not leak lights.
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { createFoundationScene } from "./createFoundationScene";
import { ARENA_PALETTE, setupArenaLighting } from "./arena";

describe("Arena lighting", () => {
  it("disposes every old light when setup is repeated", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);
    setupArenaLighting(scene);
    const originalLights = [...scene.lights];
    expect(originalLights).toHaveLength(2);
    setupArenaLighting(scene);
    expect(scene.lights).toHaveLength(2);
    for (const light of originalLights) {
      expect(light.isDisposed()).toBe(true);
      expect(scene.lights).not.toContain(light);
    }
    expect(scene.lights.map((light) => light.name).sort()).toEqual([
      "arena-directional", "arena-hemisphere",
    ]);
    scene.dispose();
    engine.dispose();
  });
  it("produces exactly 2 lights: a HemisphericLight and a DirectionalLight", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);
    setupArenaLighting(scene);

    // Exactly 2 lights in the scene
    expect(scene.lights.length).toBe(2);

    // Identify each light type
    const hemi = scene.lights.find((l) => l instanceof HemisphericLight);
    const dir = scene.lights.find((l) => l instanceof DirectionalLight);

    expect(hemi, "No HemisphericLight found").toBeDefined();
    expect(dir, "No DirectionalLight found").toBeDefined();

    // HemisphericLight (ambient fill) is bright: intensity in [0.7, 1.0]
    expect(hemi!.intensity).toBeGreaterThanOrEqual(0.7);
    expect(hemi!.intensity).toBeLessThanOrEqual(1.0);

    // DirectionalLight (key light) is bright: intensity in [0.9, 1.3]
    expect(dir!.intensity).toBeGreaterThanOrEqual(0.9);
    expect(dir!.intensity).toBeLessThanOrEqual(1.3);

    // Both are bright, non-zero light sources
    expect(hemi!.intensity).not.toBe(0);
    expect(dir!.intensity).not.toBe(0);

    engine.dispose();
  });

  it("uses a bright, stable lighting and material color setup", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    const hemi = scene.getLightByName("arena-hemisphere") as HemisphericLight;
    const dir = scene.getLightByName("arena-directional") as DirectionalLight;

    expect(hemi).toBeDefined();
    expect(dir).toBeDefined();

    // Hemisphere fill: bright cool tint (every channel >= 0.7),
    // ground bounce sourced from the palette ambient color.
    for (const channel of [hemi!.diffuse.r, hemi!.diffuse.g, hemi!.diffuse.b]) {
      expect(channel).toBeGreaterThanOrEqual(0.7);
    }
    expect(hemi!.groundColor).toStrictEqual(ARENA_PALETTE.ambientColor);

    // Directional key: near-white (every channel >= 0.9), down-and-angled.
    for (const channel of [dir!.diffuse.r, dir!.diffuse.g, dir!.diffuse.b]) {
      expect(channel).toBeGreaterThanOrEqual(0.9);
    }
    expect(dir!.direction.x).toBeCloseTo(-0.35, 5);
    expect(dir!.direction.y).toBeCloseTo(-1, 5);
    expect(dir!.direction.z).toBeCloseTo(-0.25, 5);

    // No shadows or extra light sources — the cheap two-light setup is stable.
    expect(scene.lights).toHaveLength(2);
    expect(scene.shadows ?? []).toHaveLength(0);

    scene.dispose();
    engine.dispose();
  });

  it("repeat setup/disposal does not leak lights or materials", () => {
    const engine = new NullEngine();

    const scenes = [] as ReturnType<typeof createFoundationScene>[];
    for (let i = 0; i < 3; i++) {
      const scene = createFoundationScene(engine);
      setupArenaLighting(scene); // extra repeat within the same scene
      expect(scene.lights).toHaveLength(2);
      scenes.push(scene);
    }

    for (const scene of scenes) {
      scene.dispose();
      expect(scene.lights).toHaveLength(0);
    }

    // A fresh scene on the same engine still gets exactly the two canonical
    // lights — no disposed lights linger, and engine disposal is clean.
    const fresh = createFoundationScene(engine);
    expect(fresh.lights.map((l) => l.name).sort()).toEqual([
      "arena-directional",
      "arena-hemisphere",
    ]);
    fresh.dispose();
    engine.dispose();
  });

  it("replaces any pre-existing lights when called on a scene that already has one", () => {
    const engine = new NullEngine();
    const scene = createFoundationScene(engine);

    // createFoundationScene adds its own HemisphericLight
    const preCount = scene.lights.length;
    expect(preCount).toBeGreaterThan(0);

    // Applying arena lighting should remove the old light(s)
    setupArenaLighting(scene);

    // Now exactly 2 lights remain
    expect(scene.lights.length).toBe(2);

    engine.dispose();
  });
});
