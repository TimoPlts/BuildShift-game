/**
 * Behavioral test: CombatFeedback component creates distinct muzzle flash
 * variants per weapon type, expires and cleans up effects, and disposes
 * cleanly.
 *
 * Uses Babylon's NullEngine (headless, no WebGL required).
 */
import { describe, expect, it, afterEach, vi, beforeEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene, Mesh } from "@babylonjs/core";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { CombatFeedback } from "./CombatFeedback";

function makeScene(engine: NullEngine): Scene {
  const scene = new Scene(engine);
  const camera = new UniversalCamera("cam", new Vector3(0, 1, -3), scene);
  camera.setTarget(new Vector3(0, 1, 0));
  scene.activeCamera = camera;
  return scene;
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

  it("assault_rifle muzzle flash creates a non-billboarded mesh at position", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    const pos = new Vector3(1, 1.5, 0);
    feedback.triggerMuzzleFlash("assault_rifle", pos);

    const mesh = scene.getMeshByName("combat-feedback-muzzle") as Mesh | null;
    expect(mesh, "muzzle flash mesh not found").not.toBeNull();
    expect(mesh!.billboardMode).toBe(0); // BILLBOARDMODE_OFF (sphere)
    expect(mesh!.position.x).toBeCloseTo(1, 5);
    expect(mesh!.position.y).toBeCloseTo(1.5, 5);
    expect(mesh!.getTotalVertices()).toBeGreaterThan(0);
  });

  it("shotgun muzzle flash creates a billboarded disc at position", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    const pos = new Vector3(2, 1.5, 0);
    feedback.triggerMuzzleFlash("shotgun", pos);

    const mesh = scene.getMeshByName("combat-feedback-muzzle") as Mesh | null;
    expect(mesh, "muzzle flash mesh not found").not.toBeNull();
    expect(mesh!.billboardMode).toBe(7); // BILLBOARDMODE_ALL
    expect(mesh!.position.x).toBeCloseTo(2, 5);
    expect(mesh!.getTotalVertices()).toBeGreaterThan(0);
  });

  it("assault_rifle and shotgun have visibly different shape (billboard)", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    feedback.triggerMuzzleFlash("assault_rifle", new Vector3(0, 0, 0));
    feedback.triggerMuzzleFlash("shotgun", new Vector3(5, 0, 0));

    const meshes = scene.meshes.filter(
      (m): m is Mesh => m.name === "combat-feedback-muzzle"
    );
    expect(meshes.length).toBe(2);

    const sphere = meshes.find((m) => m.position.x === 0)!;
    const disc = meshes.find((m) => m.position.x === 5)!;

    expect(sphere.billboardMode).toBe(0); // sphere: no billboard
    expect(disc.billboardMode).toBe(7);   // disc: billboard all
  });

  it("hit marker creates a billboarded disc in front of camera", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    feedback.triggerHitMarker();

    const mesh = scene.getMeshByName("combat-feedback-hitmarker") as Mesh | null;
    expect(mesh, "hit marker mesh not found").not.toBeNull();
    expect(mesh!.billboardMode).toBe(7);
    // Camera at (0,1,-3) looking at (0,1,0): forward is (0,0,1)
    // Position should be (0,1,-1.5)
    expect(mesh!.position.x).toBeCloseTo(0, 1);
    expect(mesh!.position.z).toBeCloseTo(-1.5, 1);
  });

  it("muzzle flash expires and is removed from scene", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    feedback.triggerMuzzleFlash("assault_rifle", new Vector3(1, 1, 0));
    expect(scene.getMeshByName("combat-feedback-muzzle")).not.toBeNull();

    // 30ms — not yet expired (duration = 60ms)
    advance(30);
    expect(scene.getMeshByName("combat-feedback-muzzle")).not.toBeNull();

    // Another 30ms — total 60ms, should be expired
    advance(30);
    expect(scene.getMeshByName("combat-feedback-muzzle")).toBeNull();
  });

  it("shotgun muzzle flash has longer duration than assault_rifle", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    // Create both
    feedback.triggerMuzzleFlash("assault_rifle", new Vector3(0, 0, 0));
    feedback.triggerMuzzleFlash("shotgun", new Vector3(5, 0, 0));

    // After 90ms: AR (60ms) should be gone, shotgun (120ms) should still be
    advance(90);

    const remaining = scene.meshes.filter(
      (m): m is Mesh => m.name === "combat-feedback-muzzle"
    );
    expect(remaining.length).toBe(1);
    // The remaining one is the shotgun at x=5
    expect(remaining[0].position.x).toBeCloseTo(5, 5);

    // After another 30ms (total 120ms): shotgun should also expire
    advance(30);
    const remaining2 = scene.meshes.filter(
      (m): m is Mesh => m.name === "combat-feedback-muzzle"
    );
    expect(remaining2.length).toBe(0);
  });

  it("hit marker expires after 200ms", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    feedback.triggerHitMarker();
    expect(scene.getMeshByName("combat-feedback-hitmarker")).not.toBeNull();

    advance(100);
    expect(scene.getMeshByName("combat-feedback-hitmarker")).not.toBeNull();

    advance(100);
    expect(scene.getMeshByName("combat-feedback-hitmarker")).toBeNull();
  });

  it("dispose removes all meshes and the scene observer", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    feedback.triggerMuzzleFlash("assault_rifle", new Vector3(0, 0, 0));
    feedback.triggerHitMarker();

    expect(scene.getMeshByName("combat-feedback-muzzle")).not.toBeNull();
    expect(scene.getMeshByName("combat-feedback-hitmarker")).not.toBeNull();

    feedback.dispose();

    expect(scene.getMeshByName("combat-feedback-muzzle")).toBeNull();
    expect(scene.getMeshByName("combat-feedback-hitmarker")).toBeNull();

    // Observer removed: notify should be a no-op without error
    expect(() => scene.onBeforeRenderObservable.notifyObservers(scene)).not.toThrow();
  });

  it("dispose is idempotent", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    feedback.triggerMuzzleFlash("shotgun", new Vector3(3, 0, 0));
    feedback.dispose();
    expect(() => feedback.dispose()).not.toThrow();
  });

  it("triggering after dispose is a no-op", () => {
    engine = new NullEngine();
    scene = makeScene(engine);
    feedback = new CombatFeedback(scene);

    feedback.dispose();
    expect(() => feedback.triggerMuzzleFlash("assault_rifle", new Vector3(0, 0, 0))).not.toThrow();
    expect(() => feedback.triggerHitMarker()).not.toThrow();
    expect(scene.getMeshByName("combat-feedback-muzzle")).toBeNull();
    expect(scene.getMeshByName("combat-feedback-hitmarker")).toBeNull();
  });
});
