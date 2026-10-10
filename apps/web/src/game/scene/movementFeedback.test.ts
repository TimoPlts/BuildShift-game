/**
 * Behavioral NullEngine lifecycle tests for MovementFeedback:
 *  - jump launch: small takeoff dust posed on the ground level + upward
 *    camera nudge;
 *  - landing: dust burst at the ground point, scaled by fall speed, plus a
 *    downward camera dip;
 *  - bounded/reused pool (repeated jump/land spam never grows meshes or
 *    materials; all effects self-expire);
 *  - reset clears dust and the camera offset (round reset / rematch);
 *  - idempotent disposal releases every mesh, material, and scene observer;
 *  - every API is a safe no-op after dispose.
 */
import { describe, expect, it, afterEach, vi, beforeEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene, Mesh } from "@babylonjs/core";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MovementFeedback } from "./MovementFeedback";
import { DEFAULT_MOVEMENT_DUST_CONFIG, MOVEMENT_DUST_NAME_PREFIX } from "./movement/movementDust";

function makeScene(engine: NullEngine): Scene {
  const scene = new Scene(engine);
  const camera = new UniversalCamera("cam", new Vector3(0, 1.4, 12), scene);
  camera.setTarget(new Vector3(0, 1.4, 6));
  scene.activeCamera = camera;
  return scene;
}

function dustMeshCount(scene: Scene): number {
  return scene.meshes.filter((m) => m.name.startsWith(MOVEMENT_DUST_NAME_PREFIX)).length;
}

function dustMaterialCount(scene: Scene): number {
  return scene.materials.filter((m) => m.name.startsWith(MOVEMENT_DUST_NAME_PREFIX)).length;
}

function liveDust(scene: Scene): Mesh[] {
  return scene.meshes.filter(
    (m): m is Mesh => m.name.startsWith(MOVEMENT_DUST_NAME_PREFIX) && m.isEnabled(),
  );
}

function alphaOf(mesh: Mesh): number {
  return (mesh.material as StandardMaterial | null)?.alpha ?? -1;
}

/**
 * A realistic jump/land arc for the shared tuning (jumpVelocity 8,
 * gravity -20, dt 1/30): rest -> launch -> rise -> fall -> land. The
 * landing sample's velocityY is 0 (the shared vertical step zeroes it); the
 * fall speed is carried by the last airborne sample.
 */
function jumpLandSamples(fallSpeed = 2.0) {
  return [
    { x: 1, y: 0, z: 4, grounded: true, velocityY: 0 },
    { x: 1, y: 0.24, z: 4, grounded: false, velocityY: 7.33 },
    { x: 1, y: 0.46, z: 4, grounded: false, velocityY: 6.0 },
    { x: 1, y: 0.36, z: 4, grounded: false, velocityY: -fallSpeed },
    { x: 1, y: 0, z: 4, grounded: true, velocityY: 0 },
  ] as const;
}

describe("MovementFeedback", () => {
  let engine: NullEngine;
  let scene: Scene;
  let feedback: MovementFeedback;
  let nowMs: number;

  beforeEach(() => {
    nowMs = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
  });

  afterEach(() => {
    feedback?.dispose();
    engine?.dispose();
    vi.restoreAllMocks();
  });

  function advance(ms: number): void {
    nowMs += ms;
    scene.onBeforeRenderObservable.notifyObservers(scene);
  }

  it("starts clean: no live dust and a neutral camera offset", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new MovementFeedback(scene);

    expect(liveDust(scene).length).toBe(0);
    expect(dustMeshCount(scene)).toBe(DEFAULT_MOVEMENT_DUST_CONFIG.slotCount);
    expect(feedback.updateCameraMotion(1 / 30)).toBe(0);
  });

  it("jump launch spawns a small takeoff burst on the ground level and nudges the camera up", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new MovementFeedback(scene);

    feedback.step({ x: 1, y: 0, z: 4, grounded: true, velocityY: 0 });
    expect(liveDust(scene).length).toBe(0);

    feedback.step({ x: 1, y: 0.24, z: 4, grounded: false, velocityY: 7.33 });

    const burst = liveDust(scene);
    expect(burst.length).toBe(1);
    // Posed at the ground level (the launch sample's Y is already airborne),
    // within the fixed spread radius of the player's ground point.
    expect(Math.abs(burst[0].position.x - 1)).toBeLessThan(0.25);
    expect(Math.abs(burst[0].position.z - 4)).toBeLessThan(0.25);
    expect(burst[0].position.y).toBeCloseTo(DEFAULT_MOVEMENT_DUST_CONFIG.groundEpsilon, 5);
    // Restrained: a small, sub-1-scale disc.
    expect(burst[0].scaling.x).toBeLessThan(1);

    // Camera: a small upward nudge (positive = up), decaying only when the
    // render frame asks for it.
    expect(feedback.updateCameraMotion(0)).toBeCloseTo(0.08, 6);
  });

  it("landing spawns a fall-speed-scaled burst at the ground point and dips the camera down", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new MovementFeedback(scene);

    for (const sample of jumpLandSamples(15.0)) {
      feedback.step({ ...sample });
    }

    const bursts = liveDust(scene);
    expect(bursts.length).toBe(2); // takeoff + landing
    // The landing burst is the most recent slot, at the landing ground point
    // (within the fixed spread radius).
    const landingBurst = bursts[1];
    expect(Math.abs(landingBurst.position.x - 1)).toBeLessThan(0.25);
    expect(Math.abs(landingBurst.position.z - 4)).toBeLessThan(0.25);
    expect(landingBurst.position.y).toBeCloseTo(DEFAULT_MOVEMENT_DUST_CONFIG.groundEpsilon, 5);

    // Full-intensity landing (fall 15 m/s >= 12): peak alpha and the longest
    // duration (300 + 150 ms).
    expect(alphaOf(landingBurst)).toBeCloseTo(
      DEFAULT_MOVEMENT_DUST_CONFIG.baseAlpha + DEFAULT_MOVEMENT_DUST_CONFIG.intensityAlpha,
      5,
    );
    // At 400 ms the fast-fall burst (450 ms) is still fading ...
    advance(400);
    expect(landingBurst.isEnabled()).toBe(true);
    // ... while a slow-fall burst (300 + 150 * 0.3 = 345 ms) would be gone.
    expect(liveDust(scene).length).toBe(1); // takeoff (345 ms) already expired
    expect(alphaOf(landingBurst)).toBeGreaterThan(0);

    advance(100); // 500 ms total
    expect(liveDust(scene).length).toBe(0);
  });

  it("a slow landing produces a smaller, shorter burst than a hard landing", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new MovementFeedback(scene);

    for (const sample of jumpLandSamples(2.0)) {
      feedback.step({ ...sample });
    }
    const slowBurst = liveDust(scene)[1];
    const slowAlpha = alphaOf(slowBurst);
    advance(400);
    expect(liveDust(scene).length).toBe(0); // both bursts expired by 400 ms

    // Second, harder landing in the same component.
    for (const sample of jumpLandSamples(15.0)) {
      feedback.step({ ...sample });
    }
    const hardBurst = liveDust(scene)[1];
    expect(alphaOf(hardBurst)).toBeGreaterThan(slowAlpha);
  });

  it("repeated jump/land cycles reuse the fixed pool without growth", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new MovementFeedback(scene);

    const meshCount = dustMeshCount(scene);
    const materialCount = dustMaterialCount(scene);

    for (let cycle = 0; cycle < 15; cycle += 1) {
      for (const sample of jumpLandSamples(6.0)) {
        feedback.step({ ...sample, x: cycle % 3 });
      }
      advance(100); // faster than the bursts expire -> several live at once
    }

    // Pool is fixed-size: no growth despite 30 activations.
    expect(dustMeshCount(scene)).toBe(meshCount);
    expect(dustMaterialCount(scene)).toBe(materialCount);
    // ... and the live count is bounded by the pool.
    expect(liveDust(scene).length).toBeLessThanOrEqual(DEFAULT_MOVEMENT_DUST_CONFIG.slotCount);

    // After the longest burst duration, everything has expired on its own.
    advance(600);
    expect(liveDust(scene).length).toBe(0);
  });

  it("the camera offset eases back to exactly zero across render frames", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new MovementFeedback(scene);

    for (const sample of jumpLandSamples(15.0)) {
      feedback.step({ ...sample });
    }
    expect(feedback.updateCameraMotion(0)).not.toBe(0);

    for (let i = 0; i < 60; i += 1) {
      feedback.updateCameraMotion(1 / 30);
    }
    expect(feedback.updateCameraMotion(0)).toBe(0);
  });

  it("reset clears live dust and the camera offset (round reset / rematch)", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new MovementFeedback(scene);

    for (const sample of jumpLandSamples(15.0)) {
      feedback.step({ ...sample });
    }
    expect(liveDust(scene).length).toBeGreaterThan(0);
    expect(feedback.updateCameraMotion(0)).not.toBe(0);

    feedback.reset();

    expect(liveDust(scene).length).toBe(0);
    expect(feedback.updateCameraMotion(0)).toBe(0);
    // Pools survive the reset: the same component can re-fire.
    feedback.step({ x: 0, y: 0, z: 0, grounded: true, velocityY: 0 });
    feedback.step({ x: 0, y: 0.24, z: 0, grounded: false, velocityY: 7.33 });
    expect(liveDust(scene).length).toBe(1);
  });

  it("dispose releases all owned meshes, materials, and the scene observer", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new MovementFeedback(scene);

    for (const sample of jumpLandSamples(15.0)) {
      feedback.step({ ...sample });
    }
    expect(dustMeshCount(scene)).toBeGreaterThan(0);

    feedback.dispose();

    expect(dustMeshCount(scene)).toBe(0);
    expect(dustMaterialCount(scene)).toBe(0);
    // The render observer is gone: notifying is a no-op without error.
    expect(() => scene.onBeforeRenderObservable.notifyObservers(scene)).not.toThrow();
  });

  it("dispose is idempotent and every API is a no-op afterwards", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new MovementFeedback(scene);

    feedback.step({ x: 0, y: 0, z: 0, grounded: true, velocityY: 0 });
    feedback.dispose();
    expect(() => feedback.dispose()).not.toThrow();

    expect(() =>
      feedback.step({ x: 0, y: 0.24, z: 0, grounded: false, velocityY: 7.33 }),
    ).not.toThrow();
    expect(feedback.updateCameraMotion(1 / 30)).toBe(0);
    expect(() => feedback.reset()).not.toThrow();

    expect(dustMeshCount(scene)).toBe(0);
    advance(100);
    expect(liveDust(scene).length).toBe(0);
  });
});
