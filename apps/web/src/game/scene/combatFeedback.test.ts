/**
 * Behavioral NullEngine tests for CombatFeedback:
 *  - per-weapon distinction (flash scale/tint/duration, tracer width/duration)
 *  - tracer lifecycle (posed from origin along the aim direction, then expires)
 *  - build impact lifecycle (world-anchored, separate from the hit marker)
 *  - hit marker lifecycle (camera-space, unchanged 200ms behavior)
 *  - repeated-fire bounds (pools are fixed-size; no mesh/material growth)
 *  - idempotent disposal and no-op behavior after dispose
 */
import { describe, expect, it, afterEach, vi, beforeEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene, Mesh } from "@babylonjs/core";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CombatFeedback } from "./CombatFeedback";

const NAME_PREFIX = "combat-feedback-";

function makeScene(engine: NullEngine): Scene {
  const scene = new Scene(engine);
  const camera = new UniversalCamera("cam", new Vector3(0, 1, -3), scene);
  camera.setTarget(new Vector3(0, 1, 0));
  scene.activeCamera = camera;
  return scene;
}

/** All owned (named) feedback meshes currently visible in the scene. */
function liveFeedbackMeshes(scene: Scene, prefix?: string): Mesh[] {
  return scene.meshes.filter(
    (m): m is Mesh =>
      m.name.startsWith(NAME_PREFIX) && (!prefix || m.name.startsWith(prefix)) && m.isEnabled()
  );
}

function feedbackMeshCount(scene: Scene): number {
  return scene.meshes.filter((m) => m.name.startsWith(NAME_PREFIX)).length;
}

function feedbackMaterialCount(scene: Scene): number {
  return scene.materials.filter((m) => m.name.startsWith(NAME_PREFIX)).length;
}

function alphaOf(mesh: Mesh): number {
  return (mesh.material as StandardMaterial | null)?.alpha ?? -1;
}

describe("CombatFeedback", () => {
  let engine: NullEngine;
  let scene: Scene;
  let feedback: CombatFeedback;
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

  it("playShot spawns a muzzle flash at origin and a tracer oriented along the aim direction", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    const origin = new Vector3(1, 1.5, 0);
    const aim = new Vector3(0, 0, 1);
    feedback.playShot("assault_rifle", origin, aim);

    const flashes = liveFeedbackMeshes(scene, "combat-feedback-muzzle");
    expect(flashes.length).toBe(1);
    expect(flashes[0].position.x).toBeCloseTo(origin.x, 4);
    expect(flashes[0].position.y).toBeCloseTo(origin.y, 4);
    expect(flashes[0].position.z).toBeCloseTo(origin.z, 4);
    expect(alphaOf(flashes[0])).toBeCloseTo(1, 5);

    const tracers = liveFeedbackMeshes(scene, "combat-feedback-tracer");
    expect(tracers.length).toBe(1);
    // Streak runs from origin along the aim direction: local +Y maps to aim.
    const localYWorld = tracers[0].getDirection(new Vector3(0, 1, 0)).normalize();
    expect(localYWorld.x).toBeCloseTo(aim.x, 4);
    expect(localYWorld.y).toBeCloseTo(aim.y, 4);
    expect(localYWorld.z).toBeCloseTo(aim.z, 4);
    // Stretched along its axis, centered past the origin.
    expect(tracers[0].scaling.y).toBeGreaterThan(tracers[0].scaling.x * 5);
    expect(tracers[0].position.z).toBeGreaterThan(origin.z);
  });

  it("playShot skips the tracer when the aim direction is degenerate but keeps the flash", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    feedback.playShot("shotgun", new Vector3(2, 0, 0), new Vector3(0, 0, 0));

    expect(liveFeedbackMeshes(scene, "combat-feedback-muzzle").length).toBe(1);
    expect(liveFeedbackMeshes(scene, "combat-feedback-tracer").length).toBe(0);
  });

  it("assault rifle and shotgun differ in muzzle flash, tracer, and weight", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    const aim = new Vector3(0, 0, 1);
    feedback.playShot("assault_rifle", new Vector3(0, 0, 0), aim);
    feedback.playShot("shotgun", new Vector3(5, 0, 0), aim);

    const rifleFlash = liveFeedbackMeshes(scene, "combat-feedback-muzzle").find((m) => m.position.x === 0)!;
    const shotgunFlash = liveFeedbackMeshes(scene, "combat-feedback-muzzle").find((m) => m.position.x === 5)!;
    const rifleTracer = liveFeedbackMeshes(scene, "combat-feedback-tracer").find((m) => m.position.x < 3)!;
    const shotgunTracer = liveFeedbackMeshes(scene, "combat-feedback-tracer").find((m) => m.position.x >= 3)!;

    // Shotgun reads heavier: larger, warmer flash and a broader tracer.
    expect(shotgunFlash.scaling.x).toBeGreaterThan(rifleFlash.scaling.x);
    const rifleTint = (rifleFlash.material as StandardMaterial).emissiveColor;
    const shotgunTint = (shotgunFlash.material as StandardMaterial).emissiveColor;
    expect(shotgunTint.b).toBeLessThan(rifleTint.b); // warmer (less blue)
    expect(shotgunTracer.scaling.x).toBeGreaterThan(rifleTracer.scaling.x); // wider streak

    // After 70ms the rifle effects are gone; the heavier shotgun ones linger.
    advance(70);
    expect(rifleFlash.isEnabled()).toBe(false);
    expect(rifleTracer.isEnabled()).toBe(false);
    expect(shotgunFlash.isEnabled()).toBe(true);
    expect(shotgunTracer.isEnabled()).toBe(true);

    // After another 59ms (129ms total) the flash is gone and the tracer is
    // still fading (its duration is 130ms).
    advance(59);
    expect(shotgunFlash.isEnabled()).toBe(false);
    expect(shotgunTracer.isEnabled()).toBe(true);

    // At 130ms total, the tracer expires exactly at its duration.
    advance(1);
    expect(liveFeedbackMeshes(scene, "combat-feedback-tracer").length).toBe(0);
  });

  it("tracer fades out and expires within its duration", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    feedback.playShot("assault_rifle", new Vector3(0, 0, 0), new Vector3(0, 0, 1));

    const tracers = liveFeedbackMeshes(scene, "combat-feedback-tracer");
    expect(tracers.length).toBe(1);

    advance(30);
    expect(tracers[0].isEnabled()).toBe(true);
    expect(alphaOf(tracers[0])).toBeGreaterThan(0.4);

    advance(40); // 70ms total = rifle tracer duration
    expect(tracers[0].isEnabled()).toBe(false);
    expect(alphaOf(tracers[0])).toBe(0);
  });

  it("hit marker appears in front of the camera and expires after 200ms", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    feedback.triggerHitMarker();

    const marker = liveFeedbackMeshes(scene, "combat-feedback-hitmarker");
    expect(marker.length).toBe(1);
    // Camera at (0,1,-3) looking at (0,1,0): forward is (0,0,1), so the
    // marker sits at (0,1,-1.5).
    expect(marker[0].position.x).toBeCloseTo(0, 1);
    expect(marker[0].position.z).toBeCloseTo(-1.5, 1);

    advance(100);
    expect(liveFeedbackMeshes(scene, "combat-feedback-hitmarker").length).toBe(1);

    advance(100);
    expect(liveFeedbackMeshes(scene, "combat-feedback-hitmarker").length).toBe(0);
  });

  it("build impact is world-anchored, separate from the hit marker, and expires", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    const spot = new Vector3(3, 2, 4);
    feedback.playBuildImpact(spot);

    const impact = liveFeedbackMeshes(scene, "combat-feedback-buildimpact");
    expect(impact.length).toBe(1);
    expect(impact[0].position.x).toBeCloseTo(spot.x, 4);
    expect(impact[0].position.y).toBeCloseTo(spot.y, 4);
    expect(impact[0].position.z).toBeCloseTo(spot.z, 4);
    // The hit marker is a distinct effect and was not created.
    expect(liveFeedbackMeshes(scene, "combat-feedback-hitmarker").length).toBe(0);

    advance(80);
    expect(liveFeedbackMeshes(scene, "combat-feedback-buildimpact").length).toBe(1);

    advance(70); // 150ms total
    expect(liveFeedbackMeshes(scene, "combat-feedback-buildimpact").length).toBe(0);
  });

  it("repeated firing does not grow meshes or materials and everything expires", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    const meshCount = feedbackMeshCount(scene);
    const materialCount = feedbackMaterialCount(scene);
    expect(meshCount).toBeGreaterThan(0);

    // 50 rapid rifle shots (30ms apart, faster than the effects expire).
    for (let i = 0; i < 50; i++) {
      feedback.playShot("assault_rifle", new Vector3(i % 7, 0, 0), new Vector3(0, 0, 1));
      feedback.playBuildImpact(new Vector3(i % 5, 1, 0));
      advance(30);
    }

    // Pool is fixed-size: no growth despite 50+100 activations.
    expect(feedbackMeshCount(scene)).toBe(meshCount);
    expect(feedbackMaterialCount(scene)).toBe(materialCount);

    // After the longest effect duration, nothing is still visible.
    advance(200);
    expect(liveFeedbackMeshes(scene).length).toBe(0);
  });

  it("rapid fire beyond the pool size reuses slots instead of growing", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    const meshCount = feedbackMeshCount(scene);

    // 7 shotgun shots 20ms apart; the shotgun tracer (130ms) means several
    // are live simultaneously, exceeding the tracer pool size of 6.
    for (let i = 0; i < 7; i++) {
      feedback.playShot("shotgun", new Vector3(0, 0, i * 0.01), new Vector3(0, 0, 1));
      advance(20);
    }

    expect(feedbackMeshCount(scene)).toBe(meshCount);
    // Still bounded by the pool: at most the pool size of live tracers.
    expect(liveFeedbackMeshes(scene, "combat-feedback-tracer").length).toBeLessThanOrEqual(6);

    advance(200);
    expect(liveFeedbackMeshes(scene, "combat-feedback-tracer").length).toBe(0);
  });

  it("reset deactivates live effects without disposing them", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    feedback.playShot("shotgun", new Vector3(0, 0, 0), new Vector3(0, 0, 1));
    feedback.triggerHitMarker();
    feedback.playBuildImpact(new Vector3(1, 1, 1));
    // playShot creates two effects (muzzle flash + tracer).
    expect(liveFeedbackMeshes(scene).length).toBe(4);

    const meshCount = feedbackMeshCount(scene);
    feedback.reset();

    expect(liveFeedbackMeshes(scene).length).toBe(0);
    // Effects are deactivated, not disposed: the same pools can re-fire.
    expect(feedbackMeshCount(scene)).toBe(meshCount);
    feedback.playShot("assault_rifle", new Vector3(0, 0, 0), new Vector3(0, 0, 1));
    expect(liveFeedbackMeshes(scene, "combat-feedback-muzzle").length).toBe(1);
  });

  it("dispose releases all owned meshes, materials, and the scene observer", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    feedback.playShot("assault_rifle", new Vector3(0, 0, 0), new Vector3(0, 0, 1));
    feedback.triggerHitMarker();
    feedback.playBuildImpact(new Vector3(1, 1, 1));
    expect(feedbackMeshCount(scene)).toBeGreaterThan(0);

    feedback.dispose();

    expect(feedbackMeshCount(scene)).toBe(0);
    expect(feedbackMaterialCount(scene)).toBe(0);
    // The render observer is gone: notifying is a no-op without error.
    expect(() => scene.onBeforeRenderObservable.notifyObservers(scene)).not.toThrow();
  });

  it("dispose is idempotent", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    feedback.playShot("shotgun", new Vector3(3, 0, 0), new Vector3(0, 0, 1));
    feedback.dispose();
    expect(() => feedback.dispose()).not.toThrow();
    expect(feedbackMeshCount(scene)).toBe(0);
  });

  it("triggering after dispose is a no-op", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    feedback.dispose();

    expect(() =>
      feedback.playShot("assault_rifle", new Vector3(0, 0, 0), new Vector3(0, 0, 1))
    ).not.toThrow();
    expect(() => feedback.triggerMuzzleFlash("shotgun", new Vector3(0, 0, 0))).not.toThrow();
    expect(() => feedback.triggerHitMarker()).not.toThrow();
    expect(() => feedback.playBuildImpact(new Vector3(0, 0, 0))).not.toThrow();

    expect(feedbackMeshCount(scene)).toBe(0);
    advance(100);
    expect(liveFeedbackMeshes(scene).length).toBe(0);
  });
});
