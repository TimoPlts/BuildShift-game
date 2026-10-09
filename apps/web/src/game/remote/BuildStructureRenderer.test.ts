/**
 * Behavioral NullEngine tests for BuildStructureRenderer:
 *  - authoritative state sync (create, update, remove structures)
 *  - construction animation (scale-in on first appearance)
 *  - half-wall edit transition (smooth scaleY/yOffset lerp)
 *  - durability tint and hit flash
 *  - destruction feedback (fade-out on authoritative removal)
 *  - preview show/hide and pulsing
 *  - resource cleanup on dispose
 */
import { describe, expect, it, afterEach, vi, beforeEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { BuildingState, StructureState, StructureDurabilityState } from "@buildshift/protocol";
import { BuildStructureRenderer } from "./BuildStructureRenderer";

function structure(
  structureId: string,
  buildType: StructureState["buildType"],
  editType: StructureState["editType"] = "",
  grid?: { x: number; y: number; z: number },
): StructureState {
  return {
    structureId,
    buildType,
    grid: grid ?? { x: 0, y: 0, z: 0 },
    rotation: 0,
    ownerId: "owner",
    createdSequence: 0,
    editType,
  };
}

function durability(current: number, max = 200): StructureDurabilityState {
  return { maxDurability: max, currentDurability: current };
}

describe("BuildStructureRenderer", () => {
  let engine: NullEngine;
  let scene: Scene;
  let renderer: BuildStructureRenderer;
  let nowMs: number;

  beforeEach(() => {
    nowMs = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    engine = new NullEngine();
    scene = new Scene(engine);
    renderer = new BuildStructureRenderer(scene);
  });

  afterEach(() => {
    renderer.dispose();
    scene.dispose();
    engine.dispose();
    vi.restoreAllMocks();
  });

  /** Advance time and trigger the render observer. */
  function advance(ms: number): void {
    nowMs += ms;
    scene.onBeforeRenderObservable.notifyObservers(scene);
  }

  // ─── Authoritative state sync ────────────────────────────────────────────

  describe("syncStructures", () => {
    it("renders every replicated build type on first sync", () => {
      const state: BuildingState = {
        structures: {
          wall: structure("wall", "wall"),
          floor: structure("floor", "floor"),
          ramp: structure("ramp", "ramp"),
          cone: structure("cone", "cone"),
        },
      };

      renderer.syncStructures(state);

      for (const id of Object.keys(state.structures)) {
        const mesh = scene.getMeshByName(`structure-${id}`);
        expect(mesh, `${id} should be rendered`).not.toBeNull();
        expect(mesh!.isPickable).toBe(false);
      }
    });

    it("removes visuals for structures absent from authoritative state (after destruction anim)", () => {
      const state: BuildingState = {
        structures: {
          wall: structure("wall", "wall"),
          floor: structure("floor", "floor"),
          ramp: structure("ramp", "ramp"),
          cone: structure("cone", "cone"),
        },
      };

      renderer.syncStructures(state);
      advance(300); // past destruction duration

      // Remove all except wall
      renderer.syncStructures({ structures: { wall: state.structures.wall } });
      advance(300); // wait for destruction animation to complete

      expect(scene.getMeshByName("structure-floor")).toBeNull();
      expect(scene.getMeshByName("structure-ramp")).toBeNull();
      expect(scene.getMeshByName("structure-cone")).toBeNull();
      expect(scene.getMeshByName("structure-wall")).not.toBeNull();
    });

    it("an authoritative round reset (empty state) removes all structures", () => {
      renderer.syncStructures({
        structures: {
          wall: structure("wall", "wall"),
          cone: structure("cone", "cone"),
        },
      });
      advance(300);

      renderer.syncStructures({ structures: {} });
      advance(300);

      expect(scene.getMeshByName("structure-wall")).toBeNull();
      expect(scene.getMeshByName("structure-cone")).toBeNull();
    });

    it("is idempotent: repeated sync with same state does not duplicate meshes", () => {
      const state: BuildingState = {
        structures: { wall: structure("wall", "wall") },
      };

      renderer.syncStructures(state);
      renderer.syncStructures(state);
      renderer.syncStructures(state);

      const meshes = scene.meshes.filter((m) => m.name === "structure-wall");
      expect(meshes.length).toBe(1);
    });

    it("updates structure position when grid changes", () => {
      const wall = structure("wall", "wall", "", { x: 0, y: 0, z: 0 });
      renderer.syncStructures({ structures: { wall } });
      advance(300); // let construction complete

      const moved = structure("wall", "wall", "", { x: 3, y: 0, z: 2 });
      renderer.syncStructures({ structures: { wall: moved } });
      advance(16);

      const mesh = scene.getMeshByName("structure-wall") as Mesh;
      expect(mesh.position.x).toBeCloseTo(6, 4);
      expect(mesh.position.z).toBeCloseTo(4, 4);
    });
  });

  // ─── Construction animation ──────────────────────────────────────────────

  describe("construction animation", () => {
    it("new structures start at scale 0 and grow to full scale", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });

      // At t=0 (creation frame), scale should be near 0
      advance(0);
      const mesh = scene.getMeshByName("structure-wall") as Mesh;
      expect(mesh.scaling.x).toBeLessThan(0.3);

      // Mid-animation: should be growing (easeOutBack overshoots past 1)
      advance(100);
      expect(mesh.scaling.x).toBeGreaterThan(0.5);

      // After construction duration (200ms): full scale
      advance(100);
      expect(mesh.scaling.x).toBeCloseTo(1, 1);
    });

    it("construction does not re-trigger on repeated sync", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(250); // construction complete

      // Sync again with same structure
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(16);

      const mesh = scene.getMeshByName("structure-wall") as Mesh;
      // Should remain at full scale (no re-pop)
      expect(mesh.scaling.x).toBeCloseTo(1, 1);
    });
  });

  // ─── Half-wall edit transition ───────────────────────────────────────────

  describe("half-wall edit transition", () => {
    it("transitions from full to half_top smoothly", () => {
      const wall = structure("wall", "wall");
      renderer.syncStructures({ structures: { wall } });
      advance(300); // construction complete

      const beforeScaleY = (scene.getMeshByName("structure-wall") as Mesh).scaling.y;
      expect(beforeScaleY).toBeCloseTo(1, 1);

      // Apply half_top edit
      renderer.syncStructures({
        structures: { wall: { ...wall, editType: "half_top" } },
      });

      // Mid-transition: should be between 1 and 0.5
      advance(100);
      const midMesh = scene.getMeshByName("structure-wall") as Mesh;
      expect(midMesh.scaling.y).toBeLessThan(1);
      expect(midMesh.scaling.y).toBeGreaterThan(0.5);

      // After transition (200ms): should be at 0.5
      advance(150);
      const endMesh = scene.getMeshByName("structure-wall") as Mesh;
      expect(endMesh.scaling.y).toBeCloseTo(0.5, 1);
    });

    it("half_top shifts position upward", () => {
      const wall = structure("wall", "wall");
      renderer.syncStructures({ structures: { wall } });
      advance(300);

      const beforeY = (scene.getMeshByName("structure-wall") as Mesh).position.y;

      renderer.syncStructures({
        structures: { wall: { ...wall, editType: "half_top" } },
      });
      advance(250);

      const afterY = (scene.getMeshByName("structure-wall") as Mesh).position.y;
      expect(afterY).toBeGreaterThan(beforeY);
    });

    it("half_bottom shifts position downward", () => {
      const wall = structure("wall", "wall");
      renderer.syncStructures({ structures: { wall } });
      advance(300);

      const beforeY = (scene.getMeshByName("structure-wall") as Mesh).position.y;

      renderer.syncStructures({
        structures: { wall: { ...wall, editType: "half_bottom" } },
      });
      advance(250);

      const afterY = (scene.getMeshByName("structure-wall") as Mesh).position.y;
      expect(afterY).toBeLessThan(beforeY);
    });

    it("transitioning back to full wall restores original pose", () => {
      const wall = structure("wall", "wall");
      renderer.syncStructures({ structures: { wall } });
      advance(300);

      // Edit to half_top
      renderer.syncStructures({
        structures: { wall: { ...wall, editType: "half_top" } },
      });
      advance(250);

      // Edit back to full
      renderer.syncStructures({ structures: { wall: { ...wall, editType: "" } } });
      advance(250);

      const mesh = scene.getMeshByName("structure-wall") as Mesh;
      expect(mesh.scaling.y).toBeCloseTo(1, 1);
    });
  });

  // ─── Durability and hit feedback ─────────────────────────────────────────

  describe("build-edit target highlight", () => {
    it("boosts the aimed structure's emissive and removes it on hide", () => {
      const wall = structure("wall", "wall");
      renderer.syncStructures({ structures: { wall } });
      advance(300); // construction complete

      const mesh = scene.getMeshByName("structure-wall") as Mesh;
      const material = mesh.material as StandardMaterial;
      const baseGreen = material.emissiveColor.g;

      renderer.showEditTarget("wall");
      advance(16);
      expect(material.emissiveColor.g).toBeGreaterThan(baseGreen);

      renderer.hideEditTarget();
      advance(16);
      expect(material.emissiveColor.g).toBeCloseTo(baseGreen, 5);
    });

    it("self-cleans the highlight when the structure is authoritatively removed", () => {
      const wall = structure("wall", "wall");
      renderer.syncStructures({ structures: { wall } });
      advance(300);

      renderer.showEditTarget("wall");
      renderer.syncStructures({ structures: {} }); // wall destroyed
      advance(300); // destruction fade completes (250ms)
      // No crash and no residual highlight after the structure is gone.
      expect(scene.getMeshByName("structure-wall")).toBeNull();
    });
  });

  describe("half-wall result preview", () => {
    it("shows the top-half ghost at the correct position for half_top", () => {
      const wall = structure("wall", "wall", "", { x: 1, y: 0, z: -2 });
      renderer.syncStructures({ structures: { wall } });
      advance(300);

      renderer.showEditResultPreview("wall", "half_top", 0);
      advance(16);

      const ghost = scene.getMeshByName("build-edit-result-preview") as Mesh;
      // Wall is 2 layers tall (3m): the top-half ghost centres at y = 1.5 + 0.75 = 2.25.
      expect(ghost.position.y).toBeCloseTo(2.25, 5);
      expect((ghost.material as StandardMaterial).alpha).toBeCloseTo(0.45, 5);
    });

    it("shows the bottom-half ghost for half_bottom", () => {
      const wall = structure("wall", "wall", "", { x: 1, y: 0, z: -2 });
      renderer.syncStructures({ structures: { wall } });
      advance(300);

      renderer.showEditResultPreview("wall", "half_bottom", 0);
      advance(16);

      const ghost = scene.getMeshByName("build-edit-result-preview") as Mesh;
      // The bottom-half ghost centres at y = 1.5 - 0.75 = 0.75.
      expect(ghost.position.y).toBeCloseTo(0.75, 5);
    });

    it("hides the preview when hidden, for non-wall targets, and on structure removal", () => {
      const wall = structure("wall", "wall");
      const floor = structure("floor", "floor");
      renderer.syncStructures({ structures: { wall, floor } });
      advance(300);

      renderer.showEditResultPreview("wall", "half_top", 0);
      expect(scene.getMeshByName("build-edit-result-preview")).not.toBeNull();

      renderer.hideEditResultPreview();
      expect(scene.getMeshByName("build-edit-result-preview")).toBeNull();

      // A non-wall target never gets a result-preview ghost.
      renderer.showEditResultPreview("floor", "half_bottom", 0);
      expect(scene.getMeshByName("build-edit-result-preview")).toBeNull();

      // Self-cleanup: the preview for a destroyed structure is disposed.
      renderer.showEditResultPreview("wall", "half_top", 0);
      renderer.syncStructures({ structures: { floor } });
      expect(scene.getMeshByName("build-edit-result-preview")).toBeNull();
    });
  });

  describe("durability and hit feedback", () => {
    it("tints structure material toward damaged color as durability decreases", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(300);

      const mesh = scene.getMeshByName("structure-wall") as Mesh;
      const mat = mesh.material as StandardMaterial;
      const healthyDiffuse = mat.diffuseColor.clone();

      // Apply 50% damage
      renderer.updateStructureDurability("wall", durability(100, 200));
      advance(16);

      const damagedMat = mesh.material as StandardMaterial;
      // Diffuse should have shifted toward orange-red
      expect(damagedMat.diffuseColor.r).toBeGreaterThan(healthyDiffuse.r);
      expect(damagedMat.diffuseColor.g).toBeLessThan(healthyDiffuse.g);
    });

    it("triggers a hit flash (emissive boost) when durability decreases", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(300);

      const mesh = scene.getMeshByName("structure-wall") as Mesh;
      const mat = mesh.material as StandardMaterial;
      const baseEmissive = mat.emissiveColor.clone();

      // Trigger a hit
      renderer.updateStructureDurability("wall", durability(150, 200));
      advance(50); // mid-flash

      const flashMat = mesh.material as StandardMaterial;
      expect(flashMat.emissiveColor.r).toBeGreaterThan(baseEmissive.r);
      expect(flashMat.emissiveColor.g).toBeGreaterThan(baseEmissive.g);
    });

    it("hit flash expires and emissive returns to base", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(300);

      const mesh = scene.getMeshByName("structure-wall") as Mesh;

      renderer.updateStructureDurability("wall", durability(150, 200));
      advance(200); // past flash duration (150ms)

      const mat = mesh.material as StandardMaterial;
      // Emissive should be back to the damaged base level (no flash boost)
      // The base emissive for 75% durability is a slight lerp from SOLID_EMISSIVE
      expect(mat.emissiveColor.r).toBeLessThan(0.2);
    });

    it("does not trigger flash when durability is unchanged", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(300);

      const mesh = scene.getMeshByName("structure-wall") as Mesh;

      // Same durability value
      renderer.updateStructureDurability("wall", durability(200, 200));
      advance(16);

      // Same again (no change)
      renderer.updateStructureDurability("wall", durability(200, 200));
      advance(16);
      const mat2 = mesh.material as StandardMaterial;

      // No flash: emissive should be at base level
      expect(mat2.emissiveColor.r).toBeLessThan(0.15);
    });

    it("applies a diffuse white-shift during hit flash", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(300);

      const mesh = scene.getMeshByName("structure-wall") as Mesh;
      const mat = mesh.material as StandardMaterial;
      const baseDiffuseR = mat.diffuseColor.r;

      // Set initial durability (no flash on first update)
      renderer.updateStructureDurability("wall", durability(200, 200));
      advance(16);

      // Trigger a hit (decrease from 200 to 150)
      renderer.updateStructureDurability("wall", durability(150, 200));
      advance(50); // mid-flash

      const flashR = (mesh.material as StandardMaterial).diffuseColor.r;
      // Diffuse should be brighter than the durability-tinted base
      expect(flashR).toBeGreaterThan(baseDiffuseR);

      // After flash expires: diffuse returns to base
      advance(200);
      const settledR = (mesh.material as StandardMaterial).diffuseColor.r;
      expect(settledR).toBeLessThan(flashR);
    });

    it("uses a non-linear tint curve (steeper at low durability)", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(300);

      const mesh = scene.getMeshByName("structure-wall") as Mesh;
      const mat = mesh.material as StandardMaterial;
      const healthyR = mat.diffuseColor.r;

      // 50% durability
      renderer.updateStructureDurability("wall", durability(100, 200));
      advance(16);
      const midR = (mesh.material as StandardMaterial).diffuseColor.r;

      // 10% durability
      renderer.updateStructureDurability("wall", durability(20, 200));
      advance(16);
      const lowR = (mesh.material as StandardMaterial).diffuseColor.r;

      // The step from 50%→10% should be larger than 100%→50% (non-linear curve)
      const stepHigh = midR - healthyR;
      const stepLow = lowR - midR;
      expect(stepLow).toBeGreaterThan(stepHigh);
    });

    it("applies a warning pulse to nearly-broken structures (durability <= 25%)", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(300);

      const mesh = scene.getMeshByName("structure-wall") as Mesh;

      // Set durability to 10% (below 25% threshold)
      renderer.updateStructureDurability("wall", durability(20, 200));
      advance(16);

      const mat1 = mesh.material as StandardMaterial;
      const emissiveR1 = mat1.emissiveColor.r;

      // Advance by ~half a pulse cycle (3 Hz → period ≈ 333ms → half ≈ 167ms)
      advance(167);
      const mat2 = mesh.material as StandardMaterial;
      const emissiveR2 = mat2.emissiveColor.r;

      // The emissive should have changed (pulsing)
      const delta = Math.abs(emissiveR1 - emissiveR2);
      expect(delta).toBeGreaterThan(0.01);
    });

    it("does not apply a warning pulse at moderate durability (> 25%)", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(300);

      const mesh = scene.getMeshByName("structure-wall") as Mesh;

      // Set durability to 50% (above 25% threshold)
      renderer.updateStructureDurability("wall", durability(100, 200));
      advance(16);

      const mat1 = mesh.material as StandardMaterial;
      const emissiveR1 = mat1.emissiveColor.r;

      // Advance by half a pulse cycle
      advance(167);
      const mat2 = mesh.material as StandardMaterial;
      const emissiveR2 = mat2.emissiveColor.r;

      // No warning pulse: emissive should be stable (no oscillation)
      const delta = Math.abs(emissiveR1 - emissiveR2);
      expect(delta).toBeLessThan(0.001);
    });
  });

  // ─── Destruction feedback ────────────────────────────────────────────────

  describe("destruction feedback", () => {
    it("plays a fade-out animation when a structure is removed from state", () => {
      renderer.syncStructures({
        structures: { wall: structure("wall", "wall"), cone: structure("cone", "cone") },
      });
      advance(300); // construction complete

      // Remove the cone
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });

      // Immediately after removal: mesh still exists (destruction anim in progress)
      const coneMesh = scene.getMeshByName("structure-cone");
      expect(coneMesh).not.toBeNull();

      // After destruction duration (250ms): mesh is gone
      advance(300);
      expect(scene.getMeshByName("structure-cone")).toBeNull();
    });

    it("destruction mesh scales down during the animation", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(300);

      // Trigger destruction
      renderer.syncStructures({ structures: {} });
      advance(100); // mid-destruction

      const mesh = scene.getMeshByName("structure-wall") as Mesh;
      expect(mesh).toBeDefined();
      expect(mesh.scaling.x).toBeLessThan(1);

      // After completion: gone
      advance(200);
      expect(scene.getMeshByName("structure-wall")).toBeNull();
    });

    it("shows an impact flash emissive spike at the start of destruction", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(300); // construction complete

      const mesh = scene.getMeshByName("structure-wall") as Mesh;
      const mat = mesh.material as StandardMaterial;
      const baseEmissiveR = mat.emissiveColor.r;

      // Trigger destruction
      renderer.syncStructures({ structures: {} });
      advance(16); // first frame of destruction

      const flashEmissiveR = (mesh.material as StandardMaterial).emissiveColor.r;
      // Emissive should spike above the base level (impact flash)
      expect(flashEmissiveR).toBeGreaterThan(baseEmissiveR);

      // After the impact phase passes: emissive returns closer to base
      advance(200);
      // The mesh may be gone by now (250ms total), so check if it exists
      const lateMesh = scene.getMeshByName("structure-wall");
      if (lateMesh) {
        const lateMat = lateMesh.material as StandardMaterial;
        expect(lateMat.emissiveColor.r).toBeLessThan(flashEmissiveR);
      }
    });
  });

  // ─── Preview ─────────────────────────────────────────────────────────────

  describe("preview", () => {
    it("shows a preview mesh at the given grid position", () => {
      renderer.showPreview("wall", { x: 2, y: 0, z: 1 }, 0, true);
      advance(16);

      const preview = scene.getMeshByName("build-preview");
      expect(preview).not.toBeNull();
      expect(preview!.position.x).toBeCloseTo(4, 4);
      expect(preview!.position.z).toBeCloseTo(2, 4);
    });

    it("preview material is green when valid, red when invalid", () => {
      renderer.showPreview("wall", { x: 0, y: 0, z: 0 }, 0, true);
      advance(16);
      const validMat = (scene.getMeshByName("build-preview")!.material) as StandardMaterial;
      expect(validMat.diffuseColor.g).toBeGreaterThan(validMat.diffuseColor.r);

      renderer.showPreview("wall", { x: 1, y: 0, z: 0 }, 0, false);
      advance(16);
      const invalidMat = (scene.getMeshByName("build-preview")!.material) as StandardMaterial;
      expect(invalidMat.diffuseColor.r).toBeGreaterThan(invalidMat.diffuseColor.g);
    });

    it("hidePreview removes the preview mesh", () => {
      renderer.showPreview("wall", { x: 0, y: 0, z: 0 }, 0, true);
      renderer.hidePreview();

      expect(scene.getMeshByName("build-preview")).toBeNull();
    });

    it("preview opacity pulses over time", () => {
      renderer.showPreview("wall", { x: 0, y: 0, z: 0 }, 0, true);
      advance(16);
      const mat = (scene.getMeshByName("build-preview")!.material) as StandardMaterial;
      const alpha1 = mat.alpha;

      advance(100);
      const alpha2 = (scene.getMeshByName("build-preview")!.material as StandardMaterial).alpha;

      // Opacity should have changed (pulsing)
      expect(alpha1).not.toBeCloseTo(alpha2, 3);
    });
  });

  // ─── Cleanup / dispose ───────────────────────────────────────────────────

  describe("dispose", () => {
    it("removes all structure meshes from the scene", () => {
      renderer.syncStructures({
        structures: {
          wall: structure("wall", "wall"),
          cone: structure("cone", "cone"),
        },
      });
      renderer.showPreview("floor", { x: 1, y: 0, z: 1 }, 0, true);

      expect(scene.meshes.length).toBeGreaterThan(0);

      renderer.dispose();

      expect(scene.getMeshByName("structure-wall")).toBeNull();
      expect(scene.getMeshByName("structure-cone")).toBeNull();
      expect(scene.getMeshByName("build-preview")).toBeNull();
    });

    it("dispose is idempotent", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      renderer.dispose();
      expect(() => renderer.dispose()).not.toThrow();
    });

    it("syncStructures after dispose is a no-op", () => {
      renderer.dispose();
      expect(() =>
        renderer.syncStructures({ structures: { wall: structure("wall", "wall") } })
      ).not.toThrow();
      expect(scene.getMeshByName("structure-wall")).toBeNull();
    });

    it("showPreview after dispose is a no-op", () => {
      renderer.dispose();
      expect(() =>
        renderer.showPreview("wall", { x: 0, y: 0, z: 0 }, 0, true)
      ).not.toThrow();
      expect(scene.getMeshByName("build-preview")).toBeNull();
    });

    it("removes the scene render observer on dispose", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      renderer.dispose();

      // Notifying the observable after dispose should not throw
      expect(() => scene.onBeforeRenderObservable.notifyObservers(scene)).not.toThrow();
    });
  });

  // ─── Resource management ─────────────────────────────────────────────────

  describe("resource management", () => {
    it("does not leak meshes on repeated create/destroy cycles", () => {
      for (let i = 0; i < 10; i++) {
        const id = `wall-${i}`;
        renderer.syncStructures({ structures: { [id]: structure(id, "wall") } });
        advance(300); // construction + past any animation
        renderer.syncStructures({ structures: {} });
        advance(300); // destruction animation completes
      }

      // After all cycles, no structure meshes should remain
      const remaining = scene.meshes.filter((m) => m.name.startsWith("structure-"));
      expect(remaining.length).toBe(0);
    });

    it("materials are disposed along with meshes", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(300);

      const matName = "structure-material-wall";
      expect(scene.materials.some((m) => m.name === matName)).toBe(true);

      renderer.syncStructures({ structures: {} });
      advance(300);

      expect(scene.materials.some((m) => m.name === matName && !(m as any).disposables?.length)).toBe(false);
    });
  });

  // ─── No-change fast path (performance pass) ─────────────────────────────────

  describe("no-change fast path", () => {
    it("still transitions the edit pose after repeated identical syncs", () => {
      const wall = structure("wall", "wall");
      renderer.syncStructures({ structures: { wall } });
      advance(300); // construction complete
      renderer.syncStructures({ structures: { wall } }); // fast path x2
      renderer.syncStructures({ structures: { wall } });

      const half = structure("wall", "wall", "half_top");
      renderer.syncStructures({ structures: { wall: half } });
      advance(50); // mid transition

      const mesh = scene.getMeshByName("structure-wall") as Mesh;
      // Mid-transition the Y scale is between full (1) and half (0.5).
      expect(mesh.scaling.y).toBeLessThan(1);
      expect(mesh.scaling.y).toBeGreaterThan(0.5);
    });

    it("still moves the mesh after repeated identical syncs", () => {
      const wall = structure("wall", "wall", "", { x: 0, y: 0, z: 0 });
      renderer.syncStructures({ structures: { wall } });
      advance(300);
      renderer.syncStructures({ structures: { wall } });
      renderer.syncStructures({ structures: { wall } });

      const moved = structure("wall", "wall", "", { x: 1, y: 0, z: 0 });
      renderer.syncStructures({ structures: { wall: moved } });
      advance(16);

      const mesh = scene.getMeshByName("structure-wall") as Mesh;
      expect(mesh.position.x).toBeCloseTo(2, 4);
    });

    it("still plays destruction after repeated identical syncs", () => {
      const wall = structure("wall", "wall");
      renderer.syncStructures({ structures: { wall } });
      advance(300);
      renderer.syncStructures({ structures: { wall } });

      renderer.syncStructures({ structures: {} });
      advance(300); // destruction animation completes

      expect(scene.getMeshByName("structure-wall")).toBeNull();
    });

    it("clears the edit target highlight when the structure is removed after identical syncs", () => {
      const wall = structure("wall", "wall");
      renderer.syncStructures({ structures: { wall } });
      advance(300);
      renderer.syncStructures({ structures: { wall } });
      renderer.showEditTarget("wall");
      advance(16); // the tick applies the edit-target emissive boost

      const mesh = scene.getMeshByName("structure-wall") as Mesh;
      const mat = mesh.material as StandardMaterial;
      const boosted = mat.emissiveColor.r;
      expect(boosted).toBeGreaterThan(0.08);

      renderer.syncStructures({ structures: {} });
      advance(300);

      // Mesh gone; re-creating the structure must not carry the stale target.
      renderer.syncStructures({ structures: { wall } });
      advance(300);
      const freshMat = (scene.getMeshByName("structure-wall") as Mesh)
        .material as StandardMaterial;
      expect(freshMat.emissiveColor.r).toBeLessThan(boosted);
    });

    it("repeated identical durability updates leave the material stable", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(300);

      renderer.updateStructureDurability("wall", durability(150, 200));
      advance(16);

      const mat = (scene.getMeshByName("structure-wall") as Mesh)
        .material as StandardMaterial;
      const r0 = mat.diffuseColor.r;
      const g0 = mat.diffuseColor.g;
      const e0 = mat.emissiveColor.r;

      // The per-frame driver re-applies the same mirrored state many times.
      for (let i = 0; i < 10; i++) {
        renderer.updateStructureDurability("wall", durability(150, 200));
        advance(16);
      }

      expect(mat.diffuseColor.r).toBe(r0);
      expect(mat.diffuseColor.g).toBe(g0);
      expect(mat.emissiveColor.r).toBe(e0);
    });

    it("still flashes when durability decreases after identical repeats", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(300);

      renderer.updateStructureDurability("wall", durability(150, 200));
      advance(16);
      const before = (scene.getMeshByName("structure-wall") as Mesh)
        .material as StandardMaterial;
      const baseEmissiveR = before.emissiveColor.r;

      // Identical re-apply, then a real hit.
      renderer.updateStructureDurability("wall", durability(150, 200));
      renderer.updateStructureDurability("wall", durability(100, 200));
      advance(16); // mid-flash

      const after = (scene.getMeshByName("structure-wall") as Mesh)
        .material as StandardMaterial;
      expect(after.emissiveColor.r).toBeGreaterThan(baseEmissiveR);
    });
  });

  // ─── Many-structures performance ─────────────────────────────────────────

  describe("many-structures performance", () => {
    const N = 50;

    function makeState(): BuildingState {
      const structures: Record<string, StructureState> = {};
      for (let i = 0; i < N; i++) {
        structures[`s-${i}`] = structure(`s-${i}`, "wall", "", {
          x: i % 10,
          y: 0,
          z: Math.floor(i / 10),
        });
      }
      return { structures };
    }

    it("creates exactly N meshes and does not duplicate on repeated sync", () => {
      const state = makeState();
      renderer.syncStructures(state);
      advance(300); // construction complete

      const count = () =>
        scene.meshes.filter((m) => m.name.startsWith("structure-s-")).length;
      expect(count()).toBe(N);

      renderer.syncStructures(state);
      renderer.syncStructures(state);
      expect(count()).toBe(N);
    });

    it("static structures have stable materials across many frames", () => {
      renderer.syncStructures(makeState());
      advance(300); // construction complete

      // Capture baseline for a spread of structures
      const samples: Array<{ name: string; r: number; g: number; e: number }> = [];
      for (const i of [0, 10, 25, 49]) {
        const mat = (scene.getMeshByName(`structure-s-${i}`) as Mesh)
          .material as StandardMaterial;
        samples.push({
          name: `structure-s-${i}`,
          r: mat.diffuseColor.r,
          g: mat.diffuseColor.g,
          e: mat.emissiveColor.r,
        });
      }

      // Advance 30 frames (~half second at 60 fps)
      for (let f = 0; f < 30; f++) advance(16);

      // Materials must be bit-stable (no drift from skipped ticks)
      for (const s of samples) {
        const mat = (scene.getMeshByName(s.name) as Mesh)
          .material as StandardMaterial;
        expect(mat.diffuseColor.r).toBe(s.r);
        expect(mat.diffuseColor.g).toBe(s.g);
        expect(mat.emissiveColor.r).toBe(s.e);
      }
    });

    it("edit-target switch updates emissive for both old and new targets", () => {
      const a = structure("a", "wall", "", { x: 0, y: 0, z: 0 });
      const b = structure("b", "wall", "", { x: 1, y: 0, z: 0 });
      renderer.syncStructures({ structures: { a, b } });
      advance(300);

      const matA = () =>
        (scene.getMeshByName("structure-a") as Mesh).material as StandardMaterial;
      const matB = () =>
        (scene.getMeshByName("structure-b") as Mesh).material as StandardMaterial;

      advance(16); // let tick settle with no edit target
      const baseE = matA().emissiveColor.r;

      // Target A → A's emissive rises, B unchanged
      renderer.showEditTarget("a");
      advance(16);
      expect(matA().emissiveColor.r).toBeGreaterThan(baseE);
      expect(matB().emissiveColor.r).toBe(baseE);

      // Switch to B → B rises, A returns to baseline
      renderer.showEditTarget("b");
      advance(16);
      expect(matB().emissiveColor.r).toBeGreaterThan(baseE);
      expect(matA().emissiveColor.r).toBeCloseTo(baseE, 5);

      // Clear → B returns to baseline
      renderer.hideEditTarget();
      advance(16);
      expect(matB().emissiveColor.r).toBeCloseTo(baseE, 5);
    });

    it("durability change on a static structure updates the material on next tick", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(300); // construction complete → static

      const mat = () =>
        (scene.getMeshByName("structure-wall") as Mesh).material as StandardMaterial;
      const healthyR = mat().diffuseColor.r;

      // Decrease durability (triggers hit flash + tint)
      renderer.updateStructureDurability("wall", durability(100, 200));
      advance(200); // past hit-flash duration (180 ms)

      // Diffuse must have shifted toward damaged color
      expect(mat().diffuseColor.r).toBeGreaterThan(healthyR);
    });
  });

  // ─── Shared color constant stability ─────────────────────────────────────────

  describe("shared color constant stability", () => {
    it("per-frame in-place material updates never corrupt the shared SOLID constants", () => {
      renderer.syncStructures({
        structures: {
          wall: structure("wall", "wall"),
          cone: structure("cone", "cone"),
        },
      });
      advance(300);

      const wallMat = () =>
        (scene.getMeshByName("structure-wall") as Mesh).material as StandardMaterial;
      const coneMat = (scene.getMeshByName("structure-cone") as Mesh)
        .material as StandardMaterial;

      // Baseline = the shared-constant values as seen on fresh materials.
      const originalWallDiffuse = wallMat().diffuseColor.clone();
      const originalWallEmissive = wallMat().emissiveColor.clone();
      const originalConeDiffuse = coneMat.diffuseColor.clone();

      // Damage the wall: the tick now mutates this material's colors in place
      // every frame.
      renderer.updateStructureDurability("wall", durability(100, 200));
      advance(50);
      advance(50);

      // The wall's material must actually differ from its solid base — the
      // test is only meaningful if the in-place mutation path really ran.
      expect(wallMat().diffuseColor.r).toBeGreaterThan(originalWallDiffuse.r);

      // A structure created AFTER the mutations must still start from the
      // pristine shared constants: in-place updates must not have corrupted
      // SOLID_COLORS / SOLID_EMISSIVE.
      renderer.syncStructures({
        structures: {
          wall: structure("wall", "wall"),
          cone: structure("cone", "cone"),
          fresh: structure("fresh", "wall"),
        },
      });
      advance(300);
      const freshMat = (scene.getMeshByName("structure-fresh") as Mesh)
        .material as StandardMaterial;

      expect(freshMat.diffuseColor.r).toBe(originalWallDiffuse.r);
      expect(freshMat.diffuseColor.g).toBe(originalWallDiffuse.g);
      expect(freshMat.diffuseColor.b).toBe(originalWallDiffuse.b);
      expect(freshMat.emissiveColor.r).toBe(originalWallEmissive.r);
      expect(freshMat.emissiveColor.g).toBe(originalWallEmissive.g);
      expect(freshMat.emissiveColor.b).toBe(originalWallEmissive.b);

      // Cross-structure isolation: the untouched cone keeps its baseline.
      expect(coneMat.diffuseColor.r).toBe(originalConeDiffuse.r);
      expect(coneMat.diffuseColor.g).toBe(originalConeDiffuse.g);
      expect(coneMat.diffuseColor.b).toBe(originalConeDiffuse.b);
    });
  });
});
