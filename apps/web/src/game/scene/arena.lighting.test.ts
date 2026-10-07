/**
 * Behavioral test: after applying arena lighting to the foundation scene,
 * exactly two lights must exist – a HemisphericLight (intensity 0.5–0.7)
 * and a DirectionalLight (intensity 0.7–0.9) – both with non-zero intensity.
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { createFoundationScene } from "./createFoundationScene";
import { setupArenaLighting } from "./arena";

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

    // HemisphericLight intensity in [0.5, 0.7]
    expect(hemi!.intensity).toBeGreaterThanOrEqual(0.5);
    expect(hemi!.intensity).toBeLessThanOrEqual(0.7);

    // DirectionalLight intensity in [0.7, 0.9]
    expect(dir!.intensity).toBeGreaterThanOrEqual(0.7);
    expect(dir!.intensity).toBeLessThanOrEqual(0.9);

    // Both have non-zero intensity
    expect(hemi!.intensity).not.toBe(0);
    expect(dir!.intensity).not.toBe(0);

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
