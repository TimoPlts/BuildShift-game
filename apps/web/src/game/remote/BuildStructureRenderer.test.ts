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
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { BuildingState, StructureState, StructureDurabilityState, GridRotation } from "@buildshift/protocol";
import { BUILD_GRID, CONE_PEAK_HEIGHT, structureBounds, structureCuboids } from "@buildshift/game-config";
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
      expect(mesh.position.x).toBeCloseTo(15.36, 4);
      expect(mesh.position.z).toBeCloseTo(10.24, 4);
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

  // ─── Construction build-up (transparent start) ─────────────────────────

  describe("construction build-up (transparent start)", () => {
    it("new structures start semi-transparent and build up to solid", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });

      // At creation: lightweight, semi-transparent shell
      advance(0);
      const mat = (scene.getMeshByName("structure-wall") as Mesh)
        .material as StandardMaterial;
      expect(mat.alpha).toBeCloseTo(0.35, 2);

      // Mid build-up: partially solidified
      advance(100);
      const midAlpha = (scene.getMeshByName("structure-wall") as Mesh)
        .material as StandardMaterial;
      expect(midAlpha.alpha).toBeGreaterThan(0.5);
      expect(midAlpha.alpha).toBeLessThan(1);

      // After the construction duration: fully solid
      advance(100);
      const endMat = (scene.getMeshByName("structure-wall") as Mesh)
        .material as StandardMaterial;
      expect(endMat.alpha).toBeCloseTo(1, 5);
    });

    it("keeps the durability tint readable while the build-up is still transparent", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      // Heavy damage while the build-up is still in progress.
      renderer.updateStructureDurability("wall", durability(40, 200));
      advance(50); // mid build-up

      const mesh = scene.getMeshByName("structure-wall") as Mesh;
      const mat = mesh.material as StandardMaterial;
      // Still mid build-up…
      expect(mat.alpha).toBeGreaterThan(0.3);
      expect(mat.alpha).toBeLessThan(1);
      // …but the damage tint is applied to the diffuse color and remains
      // readable (wall base diffuse r ≈ 0.42; heavy damage pulls it toward
      // the damaged red ≈ 0.92).
      expect(mat.diffuseColor.r).toBeGreaterThan(0.6);
      expect(mat.diffuseColor.r).toBeGreaterThan(mat.diffuseColor.b);

      // After the build-up settles, the tint is unchanged.
      advance(200);
      const settled = (scene.getMeshByName("structure-wall") as Mesh)
        .material as StandardMaterial;
      expect(settled.alpha).toBeCloseTo(1, 5);
      expect(settled.diffuseColor.r).toBeGreaterThan(0.6);
    });

    it("keeps the hit flash emissive visible while the build-up is still transparent", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      // Establish the durability baseline (no flash on the first report).
      renderer.updateStructureDurability("wall", durability(200, 200));
      advance(60); // mid build-up
      const mesh = scene.getMeshByName("structure-wall") as Mesh;
      const baseEmissiveR = (mesh.material as StandardMaterial).emissiveColor.r;

      renderer.updateStructureDurability("wall", durability(120, 200)); // a hit
      advance(16);

      const mat = (scene.getMeshByName("structure-wall") as Mesh)
        .material as StandardMaterial;
      expect(mat.alpha).toBeLessThan(1); // still mid build-up
      expect(mat.emissiveColor.r).toBeGreaterThan(baseEmissiveR); // flash visible
      const flashEmissiveR = mat.emissiveColor.r; // snapshot (material is written in place)

      // Flash decays and the build-up completes to solid.
      advance(300);
      const settled = (scene.getMeshByName("structure-wall") as Mesh)
        .material as StandardMaterial;
      expect(settled.alpha).toBeCloseTo(1, 5);
      expect(settled.emissiveColor.r).toBeLessThan(flashEmissiveR);
    });
  });

  // ─── Construction lifecycle cleanup ─────────────────────────────────

  describe("construction lifecycle cleanup", () => {
    it("removal during the build-up fades from the current transparency (no opacity pop)", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(100); // mid build-up
      const midAlpha = (scene.getMeshByName("structure-wall") as Mesh)
        .material as StandardMaterial;
      expect(midAlpha.alpha).toBeLessThan(1);

      // Authoritatively removed mid build-up.
      renderer.syncStructures({ structures: {} });
      advance(16);

      // The destruction fade starts from the current (partial) transparency,
      // not from opaque.
      const mesh = scene.getMeshByName("structure-wall");
      expect(mesh).not.toBeNull();
      const fadeAlpha = (mesh!.material as StandardMaterial).alpha;
      expect(fadeAlpha).toBeLessThan(1);
      expect(fadeAlpha).toBeLessThanOrEqual(midAlpha.alpha + 0.01);

      // Cleanup completes: mesh disposed.
      advance(300);
      expect(scene.getMeshByName("structure-wall")).toBeNull();
    });

    it("an authoritative reset (empty state) during the build-up disposes all construction resources", () => {
      renderer.syncStructures({
        structures: {
          wall: structure("wall", "wall"),
          cone: structure("cone", "cone"),
        },
      });
      advance(50); // mid build-up for both
      renderer.syncStructures({ structures: {} });
      advance(300); // destruction fades complete

      expect(scene.meshes.filter((m) => m.name.startsWith("structure-")).length).toBe(0);
      expect(
        scene.materials.filter((m) => m.name.startsWith("structure-material-")).length,
      ).toBe(0);
    });

    it("dispose during the build-up cleans up meshes and materials", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(50); // mid build-up
      renderer.dispose();

      expect(scene.meshes.filter((m) => m.name.startsWith("structure-")).length).toBe(0);
      expect(
        scene.materials.filter((m) => m.name.startsWith("structure-material-")).length,
      ).toBe(0);
      // Ticking after dispose must not throw or resurrect resources.
      expect(() => scene.onBeforeRenderObservable.notifyObservers(scene)).not.toThrow();
      expect(scene.meshes.filter((m) => m.name.startsWith("structure-")).length).toBe(0);
    });

    it("does not leak meshes across interrupted build-up create/destroy cycles", () => {
      for (let i = 0; i < 6; i++) {
        const id = `wall-${i}`;
        renderer.syncStructures({ structures: { [id]: structure(id, "wall") } });
        advance(60); // interrupt mid build-up
        renderer.syncStructures({ structures: {} });
        advance(300); // destruction fade completes
      }
      expect(
        scene.meshes.filter((m) => m.name.startsWith("structure-")).length,
      ).toBe(0);
    });
  });

  // ─── Visual presentation ─────────────────────────────────────────────────

  describe("visual presentation", () => {
    /** Union of the world-space bounding boxes of one structure's visual parts. */
    function visualBounds(structureId: string): { min: Vector3; max: Vector3 } {
      const root = scene.getMeshByName(`structure-${structureId}`)!;
      let min: Vector3 | null = null;
      let max: Vector3 | null = null;
      for (const part of root.getChildMeshes(false)) {
        part.computeWorldMatrix(true);
        const bb = part.getBoundingInfo().boundingBox;
        const pmin = new Vector3(bb.minimumWorld.x, bb.minimumWorld.y, bb.minimumWorld.z);
        const pmax = new Vector3(bb.maximumWorld.x, bb.maximumWorld.y, bb.maximumWorld.z);
        if (!min || !max) {
          min = pmin;
          max = pmax;
        } else {
          min = Vector3.Minimize(min, pmin);
          max = Vector3.Maximize(max, pmax);
        }
      }
      return { min: min!, max: max! };
    }

    const CS = BUILD_GRID.cellSize;
    const LH = BUILD_GRID.layerHeight;

    /** Full world-space size of a mesh's bounding box. */
    const boxSize = (bb: { minimumWorld: Vector3; maximumWorld: Vector3 }) =>
      bb.maximumWorld.subtract(bb.minimumWorld);

    it("aligns every build type with its canonical footprint", () => {
      const grid = { x: 1, y: 0, z: -2 };
      for (const buildType of ["wall", "floor", "ramp", "cone"] as const) {
        const rotations: GridRotation[] = buildType === "floor" || buildType === "cone" ? [0] : [0, 1, 2, 3];
        for (const rotation of rotations) {
          renderer.syncStructures({
            structures: { piece: { ...structure("piece", buildType), rotation, grid } },
          });
          advance(300);
          const expected = structureBounds({ buildType, grid, rotation });
          const { min, max } = visualBounds("piece");
          expect(min.x).toBeCloseTo(expected.min[0]!, 3);
          expect(min.y).toBeCloseTo(expected.min[1]!, 3);
          expect(min.z).toBeCloseTo(expected.min[2]!, 3);
          expect(max.x).toBeCloseTo(expected.max[0]!, 3);
          expect(max.y).toBeCloseTo(expected.max[1]!, 3);
          expect(max.z).toBeCloseTo(expected.max[2]!, 3);
          renderer.syncStructures({ structures: {} });
          advance(300); // dispose before the next case
        }
      }
    });

    it("renders walls as a thin framed construction: posts, rails, mullion, panels, braces", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(300);
      const root = scene.getMeshByName("structure-wall") as Mesh;
      const parts = root.getChildMeshes(false) as Mesh[];
      // 2 posts + 2 rails + 1 mullion + 2 inset panels + 2 diagonal braces.
      expect(parts).toHaveLength(9);
      // Rotation 0: the wall runs along X, so its thickness is the Z extent.
      const thicknesses = parts.map((part) => {
        part.computeWorldMatrix(true);
        return boxSize(part.getBoundingInfo().boundingBox).z;
      });
      // Five frame members plus the two braces at the canonical panel
      // thickness (cs*0.15 full); two panels recessed to half that.
      const frame = thicknesses.filter((t) => Math.abs(t - CS * 0.15) < 1e-3);
      const insets = thicknesses.filter((t) => Math.abs(t - CS * 0.075) < 1e-3);
      expect(frame).toHaveLength(7);
      expect(insets).toHaveLength(2);
      // Visually thin in at least one axis — no chunky cube.
      for (const part of parts) {
        part.computeWorldMatrix(true);
        const size = boxSize(part.getBoundingInfo().boundingBox);
        expect(Math.min(size.x, size.y, size.z)).toBeLessThan(CS / 2);
      }
      // The rotated braces stay strictly inside the canonical envelope.
      const expected = structureBounds({ buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0 });
      const { min, max } = visualBounds("wall");
      expect(min.x).toBeCloseTo(expected.min[0]!, 3);
      expect(min.y).toBeCloseTo(expected.min[1]!, 3);
      expect(min.z).toBeCloseTo(expected.min[2]!, 3);
      expect(max.x).toBeCloseTo(expected.max[0]!, 3);
      expect(max.y).toBeCloseTo(expected.max[1]!, 3);
      expect(max.z).toBeCloseTo(expected.max[2]!, 3);
    });

    it("renders floors as a thin framed platform with a readable edge and underside", () => {
      renderer.syncStructures({ structures: { floor: structure("floor", "floor") } });
      advance(300);
      const root = scene.getMeshByName("structure-floor") as Mesh;
      const parts = root.getChildMeshes(false) as Mesh[];
      // 4 edge trims + 1 top deck + 1 underside base plate + 2 cross beams.
      expect(parts).toHaveLength(8);
      const heights = parts.map((part) => {
        part.computeWorldMatrix(true);
        return boxSize(part.getBoundingInfo().boundingBox).y;
      }).sort((a, b) => a - b);
      // The top deck sits slightly below the full-height edge trims (the
      // platform edge reads clearly), and the underside is framed (base
      // plate on beams) rather than a solid slab.
      const expected = [0.04, 0.04, 0.07, 0.07, 0.15, 0.15, 0.15, 0.15];
      expect(heights).toHaveLength(8);
      for (let i = 0; i < expected.length; i++) {
        expect(heights[i]!).toBeCloseTo(expected[i]!, 4);
      }
      const { min, max } = visualBounds("floor");
      expect(max.y - min.y).toBeCloseTo(0.15, 3);
      // A recessed underside: members that start below the deck bottom
      // (0.11) and never reach the top surface — the interior is hollow
      // framing, not a solid slab (base plate + two cross beams).
      const undersides = parts.filter((part) => {
        part.computeWorldMatrix(true);
        const bb = part.getBoundingInfo().boundingBox;
        return bb.minimumWorld.y < 0.045 && bb.maximumWorld.y < 0.12;
      });
      expect(undersides).toHaveLength(3);
    });

    it("renders ramps as one continuous plate aligned with the canonical 1x1 footprint", () => {
      const grid = { x: 0, y: 0, z: 0 };
      for (const rotation of [0, 1, 2, 3] as GridRotation[]) {
        renderer.syncStructures({
          structures: { ramp: { ...structure("ramp", "ramp"), rotation, grid } },
        });
        advance(300);
        const root = scene.getMeshByName("structure-ramp") as Mesh;
        const parts = root.getChildMeshes(false) as Mesh[];
        // One plate, not the 16 canonical collision step boxes.
        expect(parts).toHaveLength(1);
        parts[0]!.computeWorldMatrix(true);
        const size = boxSize(parts[0]!.getBoundingInfo().boundingBox);
        expect(size.x).toBeCloseTo(CS, 3);
        expect(size.y).toBeCloseTo(LH, 3);
        expect(size.z).toBeCloseTo(CS, 3);
        renderer.syncStructures({ structures: {} });
        advance(300);
      }
    });

    it("keeps ramp edit variants aligned with their canonical run, width and turn", () => {
      const grid = { x: 0, y: 0, z: 0 };
      const syncRamp = (variant: string) => {
        renderer.syncStructures({
          structures: { ramp: { ...structure("ramp", "ramp", "", grid), editGrid: { kind: "ramp", variant: variant as never } } },
        });
        advance(300);
        const part = (scene.getMeshByName("structure-ramp") as Mesh).getChildMeshes(false)[0] as Mesh;
        part.computeWorldMatrix(true);
        return part;
      };
      const worldY = (part: Mesh, y: number) =>
        ((part.parent as Mesh | null)?.position.y ?? 0) + part.position.y + y;
      const extremumVertex = (part: Mesh, highest: boolean) => {
        const positions = part.getVerticesData("position") as number[];
        const vertexCount = positions.length / 3;
        let best = 0;
        for (let v = 1; v < vertexCount; v++) {
          const y = worldY(part, positions[v * 3 + 1]!);
          const bestY = worldY(part, positions[best * 3 + 1]!);
          if (highest ? y > bestY : y < bestY) best = v;
        }
        return { x: positions[best * 3]!, y: worldY(part, positions[best * 3 + 1]!), z: positions[best * 3 + 2]! };
      };
      const topVertex = (part: Mesh) => extremumVertex(part, true);
      const bottomVertex = (part: Mesh) => extremumVertex(part, false);

      // full: rises from −X to +X at rotation 0.
      let part = syncRamp("full");
      let top = topVertex(part);
      expect(top.y).toBeCloseTo(LH, 3);
      expect(top.x).toBeCloseTo(CS / 2, 3);

      // flipped: the high end moves to −X.
      part = syncRamp("flipped");
      top = topVertex(part);
      expect(top.x).toBeCloseTo(-CS / 2, 3);

      // half_left / half_right: half the canonical WIDTH, on the climber's
      // left/right side (facing up a rotation-0 ramp, left is +Z).
      part = syncRamp("half_left");
      expect(boxSize(part.getBoundingInfo().boundingBox).z).toBeCloseTo(CS / 2, 3);
      expect(part.getBoundingInfo().boundingBox.centerWorld.z).toBeCloseTo(CS / 4, 3);
      part = syncRamp("half_right");
      expect(part.getBoundingInfo().boundingBox.centerWorld.z).toBeCloseTo(-CS / 4, 3);

      // turn_right: the strip shears from the tile centre to the +Z edge.
      part = syncRamp("turn_right");
      const bb = part.getBoundingInfo().boundingBox;
      expect(bb.minimumWorld.z).toBeCloseTo(-CS / 4, 3);
      expect(bb.maximumWorld.z).toBeCloseTo(CS / 2, 3);
      const bottom = bottomVertex(part);
      expect(bottom.y).toBeCloseTo(0, 3);
      expect(bottom.x).toBeCloseTo(-CS / 2, 3);

      renderer.syncStructures({ structures: {} });
      advance(300);
    });

    it("renders edited walls from the canonical tile grid (openings match)", () => {
      const wall = structure("wall", "wall");
      renderer.syncStructures({ structures: { wall } });
      advance(300);
      expect(scene.meshes.filter((m) => m.name.startsWith("visual-wall-"))).toHaveLength(9);

      const tiles = [true, true, true, true, false, true, true, true, true]; // centre removed
      renderer.syncStructures({ structures: { wall: { ...wall, editGrid: { kind: "wall", tiles } } } });
      const parts = (scene.getMeshByName("structure-wall") as Mesh).getChildMeshes(false) as Mesh[];
      // One inset panel per retained tile — no frame.
      expect(parts).toHaveLength(8);

      // No visual geometry may cover the removed tile's canonical centre.
      const hole = { x: 0, y: LH / 2, z: -CS / 2 };
      for (const part of parts) {
        part.computeWorldMatrix(true);
        const bb = part.getBoundingInfo().boundingBox;
        const covers =
          bb.minimumWorld.x <= hole.x + 0.01 && bb.maximumWorld.x >= hole.x - 0.01 &&
          bb.minimumWorld.y <= hole.y + 0.01 && bb.maximumWorld.y >= hole.y - 0.01 &&
          bb.minimumWorld.z <= hole.z + 0.01 && bb.maximumWorld.z >= hole.z - 0.01;
        expect(covers, "a panel must not cover the removed tile").toBe(false);
      }

      // Restoring the full grid brings back the framed treatment.
      renderer.syncStructures({
        structures: { wall: { ...wall, editGrid: { kind: "wall", tiles: Array(9).fill(true) } } },
      });
      expect(scene.meshes.filter((m) => m.name.startsWith("visual-wall-"))).toHaveLength(9);
    });

    it("keeps a stable structure root across edit/reset round-trips without leaking visuals", () => {
      const wall = structure("wall", "wall");
      const floor = structure("floor", "floor");
      renderer.syncStructures({ structures: { wall, floor } });
      advance(300);

      const wallRoot = scene.getMeshByName("structure-wall")!;
      const floorRoot = scene.getMeshByName("structure-floor")!;
      expect(wallRoot.name).toBe("structure-wall");
      expect(floorRoot.name).toBe("structure-floor");

      // Edit, then reset back to the canonical shape; the roots survive and
      // the child visuals are rebuilt exactly.
      renderer.syncStructures({
        structures: {
          wall: { ...wall, editGrid: { kind: "wall", tiles: [true, false, true, false, true, false, true, false, true] } },
          floor: { ...floor, editGrid: { kind: "floor_cone", tiles: [true, false, false, true] } },
        },
      });
      expect((scene.getMeshByName("structure-wall") as Mesh).getChildMeshes(false)).toHaveLength(5);
      expect((scene.getMeshByName("structure-floor") as Mesh).getChildMeshes(false)).toHaveLength(2);

      renderer.syncStructures({ structures: { wall, floor } });
      advance(300);
      expect(scene.getMeshByName("structure-wall")).toBe(wallRoot);
      expect(scene.getMeshByName("structure-floor")).toBe(floorRoot);
      expect((wallRoot as Mesh).getChildMeshes(false)).toHaveLength(9);
      expect((floorRoot as Mesh).getChildMeshes(false)).toHaveLength(8);
      // No stale visual parts from either intermediate state.
      expect(scene.meshes.filter((m) => m.name.startsWith("visual-wall-")).length).toBe(9);
      expect(scene.meshes.filter((m) => m.name.startsWith("visual-floor-")).length).toBe(8);
    });

    it("renders edited floors and cones with only the retained canonical quadrants", () => {
      renderer.syncStructures({
        structures: {
          floor: { ...structure("floor", "floor"), editGrid: { kind: "floor_cone", tiles: [true, false, true, true] } },
          cone: { ...structure("cone", "cone"), editGrid: { kind: "floor_cone", tiles: [true, true, true, false] } },
        },
      });
      advance(300);

      // Floor: three slabs, none over the removed (+X, −Z) quadrant.
      const floorParts = (scene.getMeshByName("structure-floor") as Mesh).getChildMeshes(false) as Mesh[];
      expect(floorParts).toHaveLength(3);
      const missing = { x: CS / 4, z: -CS / 4 };
      for (const part of floorParts) {
        part.computeWorldMatrix(true);
        const bb = part.getBoundingInfo().boundingBox;
        const covers =
          bb.minimumWorld.x <= missing.x + 0.01 && bb.maximumWorld.x >= missing.x - 0.01 &&
          bb.minimumWorld.z <= missing.z + 0.01 && bb.maximumWorld.z >= missing.z - 0.01;
        expect(covers, "a slab must not cover the removed quadrant").toBe(false);
      }

      // Cone: one box per canonical roof-shell cuboid, none in the removed
      // (+X, +Z) quadrant — a true see-through opening through the shell.
      const coneCanonical = structureCuboids({
        buildType: "cone", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
        editGrid: { kind: "floor_cone", tiles: [true, true, true, false] },
      });
      const coneParts = (scene.getMeshByName("structure-cone") as Mesh).getChildMeshes(false) as Mesh[];
      expect(coneParts).toHaveLength(coneCanonical.length);
      for (const part of coneParts) {
        part.computeWorldMatrix(true);
        const bb = part.getBoundingInfo().boundingBox;
        // No box sits strictly inside the removed quadrant (x > 0, z > 0).
        expect(bb.minimumWorld.x <= 1e-3 || bb.minimumWorld.z <= 1e-3).toBe(true);
      }
    });

    it("keeps every decorative mesh non-pickable and non-colliding", () => {
      renderer.syncStructures({
        structures: {
          wall: structure("wall", "wall"),
          floor: structure("floor", "floor"),
          ramp: structure("ramp", "ramp"),
          cone: structure("cone", "cone"),
        },
      });
      advance(300);
      for (const id of ["wall", "floor", "ramp", "cone"]) {
        const root = scene.getMeshByName(`structure-${id}`)!;
        expect(root.isPickable).toBe(false);
        const parts = root.getChildMeshes(false);
        expect(parts.length).toBeGreaterThan(0);
        for (const part of parts) {
          expect(part.isPickable).toBe(false);
          expect(part.checkCollisions).toBe(false);
        }
      }
    });

    it("does not leak decorative meshes or materials through create/destroy cycles", () => {
      const baseMeshes = scene.meshes.length;
      const baseMaterials = scene.materials.length;
      for (let i = 0; i < 5; i++) {
        const id = `cycle-${i}`;
        const types: StructureState["buildType"][] = ["wall", "floor", "ramp", "cone"];
        renderer.syncStructures({
          structures: Object.fromEntries(types.map((t, j) => [`${id}-${j}`, structure(`${id}-${j}`, t)])),
        });
        advance(60); // interrupt mid build-up
        renderer.syncStructures({ structures: {} });
        advance(300); // destruction fades complete
        expect(scene.meshes.filter((m) => m.name.startsWith("visual-"))).toHaveLength(0);
        expect(scene.materials.filter((m) => m.name.startsWith("structure-material-"))).toHaveLength(0);
      }
      expect(scene.meshes.length).toBe(baseMeshes);
      expect(scene.materials.length).toBe(baseMaterials);
    });
  });

  // ─── Ramp and cone model v2 (thin ramp + supports, stepped roof shell) ────────

  const CS = BUILD_GRID.cellSize;
  const LH = BUILD_GRID.layerHeight;

  describe("ramp model v2", () => {
    it("renders a thin continuous plate (not a solid slab) with the correct height span for rotation 0", () => {
      renderer.syncStructures({ structures: { ramp: structure("ramp", "ramp", "", { x: 0, y: 0, z: 0 }) } });
      advance(300);
      const part = (scene.getMeshByName("structure-ramp") as Mesh).getChildMeshes(false)[0] as Mesh;
      part.computeWorldMatrix(true);
      const bb = part.getBoundingInfo().boundingBox;
      // The plate spans the full tile in X and Z, and the full layer height in Y.
      expect(bb.maximumWorld.x - bb.minimumWorld.x).toBeCloseTo(CS, 3);
      expect(bb.maximumWorld.y - bb.minimumWorld.y).toBeCloseTo(LH, 3);
      expect(bb.maximumWorld.z - bb.minimumWorld.z).toBeCloseTo(CS, 3);
      // The top surface rises from 0 to LH over the tile.
      const positions = part.getVerticesData("position") as number[];
      let minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        minY = Math.min(minY, positions[i + 1]!);
        maxY = Math.max(maxY, positions[i + 1]!);
      }
      expect(maxY - minY).toBeCloseTo(LH, 3);
      renderer.syncStructures({ structures: {} });
      advance(300);
    });

    it("has visible support struts underneath the plate (open underside, no solid bottom)", () => {
      renderer.syncStructures({ structures: { ramp: structure("ramp", "ramp", "", { x: 0, y: 0, z: 0 }) } });
      advance(300);
      const part = (scene.getMeshByName("structure-ramp") as Mesh).getChildMeshes(false)[0] as Mesh;
      part.computeWorldMatrix(true);
      // The ramp mesh is one child (plate + supports merged into one geometry).
      const parent = scene.getMeshByName("structure-ramp") as Mesh;
      const parts = parent.getChildMeshes(false);
      expect(parts).toHaveLength(1);
      // Verify the geometry has support struts: the bounding box min Y should
      // be 0 (ground) even though the plate top rises above it. The supports
      // bring the geometry down to ground level at the high end.
      const bb = part.getBoundingInfo().boundingBox;
      expect(bb.minimumWorld.y).toBeCloseTo(0, 3);
      expect(bb.maximumWorld.y).toBeCloseTo(LH, 3);
      renderer.syncStructures({ structures: {} });
      advance(300);
    });

    it("preserves canonical bounds for all four rotations", () => {
      const grid = { x: 1, y: 0, z: -2 };
      for (const rotation of [0, 1, 2, 3] as GridRotation[]) {
        renderer.syncStructures({
          structures: { ramp: { ...structure("ramp", "ramp"), rotation, grid } },
        });
        advance(300);
        const expected = structureBounds({ buildType: "ramp", grid, rotation });
        const root = scene.getMeshByName("structure-ramp") as Mesh;
        const part = root.getChildMeshes(false)[0] as Mesh;
        part.computeWorldMatrix(true);
        const bb = part.getBoundingInfo().boundingBox;
        expect(bb.minimumWorld.x).toBeCloseTo(expected.min[0]!, 3);
        expect(bb.minimumWorld.y).toBeCloseTo(expected.min[1]!, 3);
        expect(bb.minimumWorld.z).toBeCloseTo(expected.min[2]!, 3);
        expect(bb.maximumWorld.x).toBeCloseTo(expected.max[0]!, 3);
        expect(bb.maximumWorld.y).toBeCloseTo(expected.max[1]!, 3);
        expect(bb.maximumWorld.z).toBeCloseTo(expected.max[2]!, 3);
        renderer.syncStructures({ structures: {} });
        advance(300);
      }
    });

    it("reverses the slope for the flipped variant at rotation 0", () => {
      const grid = { x: 0, y: 0, z: 0 };
      // Default (full): high end at +X for rotation 0.
      renderer.syncStructures({ structures: { ramp: structure("ramp", "ramp", "", grid) } });
      advance(300);
      const defaultPart = (scene.getMeshByName("structure-ramp") as Mesh).getChildMeshes(false)[0] as Mesh;
      defaultPart.computeWorldMatrix(true);
      // The top vertex (max Y) should be near +X/2.
      const positions = defaultPart.getVerticesData("position") as number[];
      let topIdx = 0;
      for (let i = 1; i < positions.length / 3; i++) {
        if (positions[i * 3 + 1]! > positions[topIdx * 3 + 1]!) topIdx = i;
      }
      const topX = positions[topIdx * 3]!;
      expect(topX).toBeGreaterThan(0); // high end toward +X

      // Flipped: high end should be at −X.
      renderer.syncStructures({
        structures: { ramp: { ...structure("ramp", "ramp", "", grid), editGrid: { kind: "ramp", variant: "flipped" as never } } },
      });
      advance(300);
      const flipPart = (scene.getMeshByName("structure-ramp") as Mesh).getChildMeshes(false)[0] as Mesh;
      flipPart.computeWorldMatrix(true);
      const flipPositions = flipPart.getVerticesData("position") as number[];
      let flipTopIdx = 0;
      for (let i = 1; i < flipPositions.length / 3; i++) {
        if (flipPositions[i * 3 + 1]! > flipPositions[flipTopIdx * 3 + 1]!) flipTopIdx = i;
      }
      const flipTopX = flipPositions[flipTopIdx * 3]!;
      expect(flipTopX).toBeLessThan(0); // high end toward −X

      renderer.syncStructures({ structures: {} });
      advance(300);
    });

    it("rebuilds the visual when the edit variant changes and resets on clear", () => {
      const grid = { x: 0, y: 0, z: 0 };
      // Start with full ramp.
      renderer.syncStructures({ structures: { ramp: structure("ramp", "ramp", "", grid) } });
      advance(300);
      const fullPart = (scene.getMeshByName("structure-ramp") as Mesh).getChildMeshes(false)[0] as Mesh;
      fullPart.computeWorldMatrix(true);
      const fullBB = fullPart.getBoundingInfo().boundingBox;
      // Full ramp spans the entire tile in Z.
      expect(fullBB.maximumWorld.z - fullBB.minimumWorld.z).toBeCloseTo(CS, 3);

      // Change to half_left: the visual should shrink to half width.
      renderer.syncStructures({
        structures: { ramp: { ...structure("ramp", "ramp", "", grid), editGrid: { kind: "ramp", variant: "half_left" as never } } },
      });
      advance(300);
      const halfPart = (scene.getMeshByName("structure-ramp") as Mesh).getChildMeshes(false)[0] as Mesh;
      halfPart.computeWorldMatrix(true);
      const halfBB = halfPart.getBoundingInfo().boundingBox;
      expect(halfBB.maximumWorld.z - halfBB.minimumWorld.z).toBeCloseTo(CS / 2, 3);

      // Reset: remove the edit (back to full).
      renderer.syncStructures({ structures: { ramp: structure("ramp", "ramp", "", grid) } });
      advance(300);
      const resetPart = (scene.getMeshByName("structure-ramp") as Mesh).getChildMeshes(false)[0] as Mesh;
      resetPart.computeWorldMatrix(true);
      const resetBB = resetPart.getBoundingInfo().boundingBox;
      expect(resetBB.maximumWorld.z - resetBB.minimumWorld.z).toBeCloseTo(CS, 3);

      renderer.syncStructures({ structures: {} });
      advance(300);
    });

    it("disposes the ramp mesh and all children on destruction", () => {
      renderer.syncStructures({ structures: { ramp: structure("ramp", "ramp", "", { x: 0, y: 0, z: 0 }) } });
      advance(300); // construction complete
      expect(scene.getMeshByName("structure-ramp")).not.toBeNull();

      // Remove: triggers destruction animation.
      renderer.syncStructures({ structures: {} });
      advance(300); // destruction fade completes

      expect(scene.getMeshByName("structure-ramp")).toBeNull();
      expect(scene.meshes.filter((m) => m.name.startsWith("visual-ramp-")).length).toBe(0);
      expect(scene.materials.filter((m) => m.name === "structure-material-ramp").length).toBe(0);
    });
  });

  describe("cone model v2 (thin stepped roof shell)", () => {
    it("renders exactly the canonical roof-shell cuboids — one box each, matching the canonical bounds", () => {
      const grid = { x: 2, y: 0, z: 1 };
      renderer.syncStructures({ structures: { cone: { ...structure("cone", "cone"), grid } } });
      advance(300);
      const root = scene.getMeshByName("structure-cone") as Mesh;
      const parts = root.getChildMeshes(false) as Mesh[];
      const canonical = structureCuboids({ buildType: "cone", grid, rotation: 0 });
      // Honesty rule: the visual IS the canonical solid — one box per
      // collision cuboid, no smooth skin hiding a different volume.
      expect(parts).toHaveLength(canonical.length);
      const bbs = parts.map((part) => {
        part.computeWorldMatrix(true);
        return part.getBoundingInfo().boundingBox;
      });
      // Union matches the canonical bounds exactly.
      const expected = structureBounds({ buildType: "cone", grid, rotation: 0 });
      expect(Math.min(...bbs.map((b) => b.minimumWorld.x))).toBeCloseTo(expected.min[0]!, 3);
      expect(Math.min(...bbs.map((b) => b.minimumWorld.y))).toBeCloseTo(expected.min[1]!, 3);
      expect(Math.min(...bbs.map((b) => b.minimumWorld.z))).toBeCloseTo(expected.min[2]!, 3);
      expect(Math.max(...bbs.map((b) => b.maximumWorld.x))).toBeCloseTo(expected.max[0]!, 3);
      expect(Math.max(...bbs.map((b) => b.maximumWorld.y))).toBeCloseTo(expected.max[1]!, 3);
      expect(Math.max(...bbs.map((b) => b.maximumWorld.z))).toBeCloseTo(expected.max[2]!, 3);
      // Exact two-way parity: every canonical cuboid is rendered by SOME
      // box, and every rendered box IS a canonical cuboid.
      const same = (b: { minimumWorld: { x: number; y: number; z: number }; maximumWorld: { x: number; y: number; z: number } }, c: (typeof canonical)[number]) =>
        Math.abs(b.minimumWorld.x - (c.center.x - c.halfExtents.x)) < 1e-3
        && Math.abs(b.maximumWorld.x - (c.center.x + c.halfExtents.x)) < 1e-3
        && Math.abs(b.minimumWorld.y - (c.center.y - c.halfExtents.y)) < 1e-3
        && Math.abs(b.maximumWorld.y - (c.center.y + c.halfExtents.y)) < 1e-3
        && Math.abs(b.minimumWorld.z - (c.center.z - c.halfExtents.z)) < 1e-3
        && Math.abs(b.maximumWorld.z - (c.center.z + c.halfExtents.z)) < 1e-3;
      for (const c of canonical) expect(bbs.some((b) => same(b, c))).toBe(true);
      for (const b of bbs) expect(canonical.some((c) => same(b, c))).toBe(true);
      renderer.syncStructures({ structures: {} });
      advance(300);
    });

    it("keeps retained quadrants' shell and leaves edited quadrants fully open when edited", () => {
      const grid = { x: 0, y: 0, z: 0 };
      const tiles: [boolean, boolean, boolean, boolean] = [true, false, true, true];
      renderer.syncStructures({
        structures: { cone: { ...structure("cone", "cone", "", grid), editGrid: { kind: "floor_cone", tiles } } },
      });
      advance(300);
      const root = scene.getMeshByName("structure-cone") as Mesh;
      const parts = root.getChildMeshes(false) as Mesh[];
      const canonical = structureCuboids({ buildType: "cone", grid, rotation: 0, editGrid: { kind: "floor_cone", tiles } });
      expect(parts).toHaveLength(canonical.length);
      // Tile 1 (col 1 = +X, row 0 = −Z) removed: no rendered box sits
      // strictly inside that quadrant — a full-height see-through opening,
      // not a mini-spike or a phantom quarter-solid.
      for (const part of parts) {
        part.computeWorldMatrix(true);
        const bb = part.getBoundingInfo().boundingBox;
        expect(bb.minimumWorld.x <= 1e-3 || bb.maximumWorld.z >= -1e-3).toBe(true);
      }
      // Retained quadrants still climb to the canonical peak.
      let maxY = -Infinity;
      for (const part of parts) {
        part.computeWorldMatrix(true);
        maxY = Math.max(maxY, part.getBoundingInfo().boundingBox.maximumWorld.y);
      }
      expect(maxY).toBeCloseTo(grid.y * LH + CONE_PEAK_HEIGHT, 3);
      renderer.syncStructures({ structures: {} });
      advance(300);
    });

    it("disposes the cone mesh and all children on destruction", () => {
      renderer.syncStructures({ structures: { cone: structure("cone", "cone", "", { x: 0, y: 0, z: 0 }) } });
      advance(300); // construction complete
      expect(scene.getMeshByName("structure-cone")).not.toBeNull();

      renderer.syncStructures({ structures: {} });
      advance(300); // destruction fade completes

      expect(scene.getMeshByName("structure-cone")).toBeNull();
      expect(scene.meshes.filter((m) => m.name.startsWith("visual-cone-")).length).toBe(0);
      expect(scene.materials.filter((m) => m.name === "structure-material-cone").length).toBe(0);
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
      // Wall is one layer tall (≈3.84 m): the top-half ghost centres at
      // y = 1.92 + 0.96 = 2.88.
      expect(ghost.position.y).toBeCloseTo(2.88, 5);
      expect((ghost.material as StandardMaterial).alpha).toBeCloseTo(0.45, 5);
    });

    it("shows the bottom-half ghost for half_bottom", () => {
      const wall = structure("wall", "wall", "", { x: 1, y: 0, z: -2 });
      renderer.syncStructures({ structures: { wall } });
      advance(300);

      renderer.showEditResultPreview("wall", "half_bottom", 0);
      advance(16);

      const ghost = scene.getMeshByName("build-edit-result-preview") as Mesh;
      // The bottom-half ghost centres at y = 1.92 - 0.96 = 0.96.
      expect(ghost.position.y).toBeCloseTo(0.96, 5);
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

  describe("edit-settle reveal", () => {
    it("plays a quick non-obscuring settle when an edit rebuilds the wall geometry", () => {
      const wall = structure("wall", "wall");
      renderer.syncStructures({ structures: { wall } });
      advance(300); // construction + confirmation settle

      renderer.syncStructures({
        structures: {
          wall: { ...wall, editGrid: { kind: "wall", tiles: [true, false, true, false, true, false, true, false, true] } },
        },
      });

      // Mid-settle: the rebuilt panels are briefly semi-transparent.
      advance(70);
      const root = scene.getMeshByName("structure-wall") as Mesh;
      const mat = root.material as StandardMaterial;
      expect(mat.alpha).toBeGreaterThan(0.65);
      expect(mat.alpha).toBeLessThan(1);
      expect(root.getChildMeshes(false)).toHaveLength(5);

      // Settled: fully opaque with the edited shape in place.
      advance(300);
      expect(mat.alpha).toBe(1);
      expect(root.getChildMeshes(false)).toHaveLength(5);
    });

    it("settles on a clean reset back to the default shape and keeps the root", () => {
      const wall = structure("wall", "wall");
      renderer.syncStructures({
        structures: {
          wall: { ...wall, editGrid: { kind: "wall", tiles: [true, false, false, true, false, false, true, false, false] } },
        },
      });
      advance(400);

      const rootBefore = scene.getMeshByName("structure-wall") as Mesh;
      renderer.syncStructures({ structures: { wall } });

      advance(70);
      const mat = rootBefore.material as StandardMaterial;
      expect(mat.alpha).toBeLessThan(1);
      // The reset rebuilds the full framed panel immediately.
      expect(rootBefore.getChildMeshes(false)).toHaveLength(9);

      advance(300);
      expect(scene.getMeshByName("structure-wall")).toBe(rootBefore);
      expect(mat.alpha).toBe(1);
    });

    it("does not flash on a grid move (repositioning is not an edit)", () => {
      const wall = structure("wall", "wall");
      renderer.syncStructures({ structures: { wall } });
      advance(300);

      renderer.syncStructures({ structures: { wall: structure("wall", "wall", "", { x: 3, y: 0, z: 2 }) } });
      advance(70);
      const root = scene.getMeshByName("structure-wall") as Mesh;
      expect((root.material as StandardMaterial).alpha).toBe(1);
      expect(root.position.x).toBeCloseTo(3 * BUILD_GRID.cellSize, 5);
    });

    it("lets the construction reveal lead a first appearance with an existing edit", () => {
      const wall = structure("wall", "wall");
      renderer.syncStructures({
        structures: {
          wall: { ...wall, editGrid: { kind: "wall", tiles: [true, false, true, false, true, false, true, false, true] } },
        },
      });
      // Early in the construction build-up the alpha follows the construction
      // curve (starting at 0.35), not the edit-settle start (0.65).
      advance(35);
      const mat = (scene.getMeshByName("structure-wall") as Mesh).material as StandardMaterial;
      expect(mat.alpha).toBeLessThan(0.6);

      advance(400);
      expect(mat.alpha).toBe(1);
      expect((scene.getMeshByName("structure-wall") as Mesh).getChildMeshes(false)).toHaveLength(5);
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
      expect(preview!.position.x).toBeCloseTo(10.24, 4);
      expect(preview!.position.z).toBeCloseTo(5.12, 4);
    });

    it("eases the ghost toward a new grid cell instead of teleporting", () => {
      renderer.showPreview("wall", { x: 0, y: 0, z: 0 }, 0, true);
      advance(16); // settle at the first cell

      renderer.showPreview("wall", { x: 2, y: 0, z: 0 }, 0, true);
      advance(16); // one frame of easing

      const mid = scene.getMeshByName("build-preview") as Mesh;
      // Strictly between the old and new cell: smoothed, not snapped.
      expect(mid.position.x).toBeGreaterThan(0.01);
      expect(mid.position.x).toBeLessThan(10.24);

      for (let i = 0; i < 40; i++) advance(16);
      const settled = scene.getMeshByName("build-preview") as Mesh;
      expect(settled.position.x).toBeCloseTo(10.24, 3);
    });

    it("builds the ghost aligned to the canonical bounds for each rotation (rebuilt on rotate)", () => {
      const grid = { x: 0, y: 0, z: 0 };
      const ghostBounds = () => {
        const root = scene.getMeshByName("build-preview") as Mesh;
        expect(root.rotation.y).toBe(0);
        const parts = root.getChildMeshes();
        expect(parts.length).toBeGreaterThan(0);
        let min: Vector3 | null = null;
        let max: Vector3 | null = null;
        for (const part of parts) {
          part.computeWorldMatrix(true);
          const bb = part.getBoundingInfo().boundingBox;
          const pmin = new Vector3(bb.minimumWorld.x, bb.minimumWorld.y, bb.minimumWorld.z);
          const pmax = new Vector3(bb.maximumWorld.x, bb.maximumWorld.y, bb.maximumWorld.z);
          if (!min || !max) {
            min = pmin;
            max = pmax;
          } else {
            min = Vector3.Minimize(min, pmin);
            max = Vector3.Maximize(max, pmax);
          }
        }
        return { min: min!, max: max! };
      };

      for (const buildType of ["wall", "floor", "ramp", "cone"] as const) {
        const rotations: GridRotation[] = buildType === "floor" || buildType === "cone" ? [0] : [0, 1, 2, 3];
        for (const rotation of rotations) {
          renderer.showPreview(buildType, grid, rotation, true);
          for (let i = 0; i < 40; i++) advance(16);
          const expected = structureBounds({ buildType, grid, rotation });
          const { min, max } = ghostBounds();
          expect(min.x).toBeCloseTo(expected.min[0]!, 3);
          expect(min.y).toBeCloseTo(expected.min[1]!, 3);
          expect(min.z).toBeCloseTo(expected.min[2]!, 3);
          expect(max.x).toBeCloseTo(expected.max[0]!, 3);
          expect(max.y).toBeCloseTo(expected.max[1]!, 3);
          expect(max.z).toBeCloseTo(expected.max[2]!, 3);
        }
        renderer.hidePreview();
      }
    });

    it("shows a low-opacity ground marker on the snapped cell", () => {
      renderer.showPreview("wall", { x: 2, y: 0, z: 1 }, 0, true);
      advance(16);

      const cell = scene.getMeshByName("build-preview-cell");
      expect(cell).not.toBeNull();
      expect(cell!.position.x).toBeCloseTo(10.24, 4);
      expect(cell!.position.z).toBeCloseTo(5.12, 4);
      expect(cell!.position.y).toBeCloseTo(0.011, 5);
      expect((cell!.material as StandardMaterial).alpha).toBeCloseTo(0.3, 5);
    });

    it("keeps the ground marker tracking the eased ghost position", () => {
      renderer.showPreview("wall", { x: 0, y: 0, z: 0 }, 0, true);
      advance(16);

      renderer.showPreview("wall", { x: 2, y: 0, z: 0 }, 0, true);
      advance(16);

      const ghost = scene.getMeshByName("build-preview") as Mesh;
      const cell = scene.getMeshByName("build-preview-cell") as Mesh;
      expect(cell.position.x).toBeCloseTo(ghost.position.x, 6);
      expect(cell.position.z).toBeCloseTo(ghost.position.z, 6);
    });

    it("recolors the ground marker with preview validity", () => {
      renderer.showPreview("wall", { x: 0, y: 0, z: 0 }, 0, true);
      advance(16);
      const validMat = (scene.getMeshByName("build-preview-cell")!.material) as StandardMaterial;
      expect(validMat.diffuseColor.g).toBeGreaterThan(validMat.diffuseColor.r);

      renderer.showPreview("wall", { x: 1, y: 0, z: 0 }, 0, false);
      advance(16);
      const invalidMat = (scene.getMeshByName("build-preview-cell")!.material) as StandardMaterial;
      expect(invalidMat.diffuseColor.r).toBeGreaterThan(invalidMat.diffuseColor.g);
    });

    it("blinks the preview opacity when the candidate becomes invalid (reject feedback)", () => {
      renderer.showPreview("wall", { x: 0, y: 0, z: 0 }, 0, true);
      advance(16);

      renderer.showPreview("wall", { x: 1, y: 0, z: 0 }, 0, false);
      advance(16); // mid-blink

      const mat = (scene.getMeshByName("build-preview")!.material) as StandardMaterial;
      // The blink lifts opacity above the invalid pulse envelope
      // (0.5 ± 0.22 → max 0.72) regardless of pulse phase.
      expect(mat.alpha).toBeGreaterThan(0.72);

      advance(250); // blink fully expired
      const settled = (scene.getMeshByName("build-preview")!.material) as StandardMaterial;
      expect(settled.alpha).toBeLessThanOrEqual(0.5 + 0.22 + 1e-9);
    });

    it("does not blink when the preview starts invalid (no prior valid state)", () => {
      renderer.showPreview("wall", { x: 0, y: 0, z: 0 }, 0, false);
      advance(16);

      const mat = (scene.getMeshByName("build-preview")!.material) as StandardMaterial;
      // No blink: opacity stays inside the invalid pulse envelope.
      expect(mat.alpha).toBeLessThanOrEqual(0.5 + 0.22 + 1e-9);
    });

    it("pulses an invalid preview with a wider opacity envelope than a valid one", () => {
      const sampleEnvelope = (valid: boolean): number => {
        renderer.showPreview("wall", { x: 0, y: 0, z: 0 }, 0, valid);
        advance(300); // past any one-shot blink
        let minA = 2;
        let maxA = -1;
        for (let i = 0; i < 90; i++) {
          advance(16);
          const a = (scene.getMeshByName("build-preview")!.material as StandardMaterial).alpha;
          minA = Math.min(minA, a);
          maxA = Math.max(maxA, a);
        }
        renderer.hidePreview();
        return maxA - minA;
      };

      // Invalid pulse amplitude is 0.44 total swing vs 0.20 for valid.
      expect(sampleEnvelope(false)).toBeGreaterThan(0.4);
      expect(sampleEnvelope(true)).toBeLessThan(0.25);
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

  // ─── Placement confirmation ─────────────────────────────────────────────

  describe("placement confirmation", () => {
    it("plays a short emissive confirmation glow when a structure is accepted", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });

      advance(40); // mid-confirmation (glow decays over 220ms, ease-out)
      const midMat = (scene.getMeshByName("structure-wall") as Mesh)
        .material as StandardMaterial;
      // SOLID_EMISSIVE.r = 0.02; the glow must lift it clearly.
      expect(midMat.emissiveColor.r).toBeGreaterThan(0.3);
      expect(midMat.emissiveColor.g).toBeGreaterThan(0.2);

      advance(300); // past confirm + construction
      const lateMat = (scene.getMeshByName("structure-wall") as Mesh)
        .material as StandardMaterial;
      // Back to the solid base emissive (no residual glow).
      expect(lateMat.emissiveColor.r).toBeLessThan(0.15);
    });

    it("confirmation glow settles to a stable material (no lingering per-frame work)", () => {
      renderer.syncStructures({ structures: { wall: structure("wall", "wall") } });
      advance(300); // confirm (220ms) fully settled

      const mat = (scene.getMeshByName("structure-wall") as Mesh)
        .material as StandardMaterial;
      const r0 = mat.emissiveColor.r;
      const g0 = mat.emissiveColor.g;
      const b0 = mat.emissiveColor.b;

      for (let i = 0; i < 10; i++) advance(16);

      expect(mat.emissiveColor.r).toBe(r0);
      expect(mat.emissiveColor.g).toBe(g0);
      expect(mat.emissiveColor.b).toBe(b0);
    });

    it("does not re-play the confirmation glow on repeated identical syncs", () => {
      const wall = structure("wall", "wall");
      renderer.syncStructures({ structures: { wall } });
      advance(300); // confirm settled

      const mat = (scene.getMeshByName("structure-wall") as Mesh)
        .material as StandardMaterial;
      const baseR = mat.emissiveColor.r;

      renderer.syncStructures({ structures: { wall } });
      renderer.syncStructures({ structures: { wall } });
      advance(50);

      // No re-glow: emissive stays at the settled base.
      const settled = (scene.getMeshByName("structure-wall") as Mesh)
        .material as StandardMaterial;
      expect(settled.emissiveColor.r).toBeCloseTo(baseR, 5);
    });
  });

  // ─── Cleanup / dispose ───────────────────────────────────────────────────

  describe("dispose", () => {
    it("removes the preview mesh and its ground cell marker on dispose", () => {
      renderer.showPreview("wall", { x: 0, y: 0, z: 0 }, 0, true);
      renderer.dispose();
      expect(scene.getMeshByName("build-preview")).toBeNull();
      expect(scene.getMeshByName("build-preview-cell")).toBeNull();
    });

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
    it("keeps meshes and materials bounded through rapid mixed build churn", () => {
      const baseMeshes = scene.meshes.length;
      const baseMaterials = scene.materials.length;
      const types: StructureState["buildType"][] = ["wall", "floor", "ramp", "cone"];

      // This models repeated accepted placement followed by authoritative
      // removal/reset. It deliberately uses fresh IDs and grids every pass so
      // a renderer that leaves stale meshes, materials, or observers behind
      // cannot hide behind an idempotent update path.
      for (let cycle = 0; cycle < 20; cycle++) {
        const structures: Record<string, StructureState> = {};
        for (const [index, buildType] of types.entries()) {
          const id = `${buildType}-${cycle}`;
          structures[id] = structure(id, buildType, "", {
            x: cycle * types.length + index,
            y: 0,
            z: cycle % 3,
          });
        }
        renderer.syncStructures({ structures });
        advance(250);
        expect(scene.meshes.filter((mesh) => mesh.name.startsWith("structure-")).length).toBe(4);

        renderer.syncStructures({ structures: {} });
        advance(300);
        expect(scene.meshes.filter((mesh) => mesh.name.startsWith("structure-")).length).toBe(0);
        expect(scene.materials.filter((material) => material.name.startsWith("structure-material-")).length).toBe(0);
      }

      expect(scene.meshes.length).toBe(baseMeshes);
      expect(scene.materials.length).toBe(baseMaterials);
    });

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
    it("still rebuilds edited geometry after repeated identical syncs", () => {
      const wall = structure("wall", "wall");
      renderer.syncStructures({ structures: { wall } });
      advance(300); // construction complete
      renderer.syncStructures({ structures: { wall } }); // fast path x2
      renderer.syncStructures({ structures: { wall } });

      const half = { ...wall, editGrid: { kind: "wall" as const, tiles: [false, false, false, true, true, true, true, true, true] } };
      renderer.syncStructures({ structures: { wall: half } });
      expect(scene.meshes.filter((m) => m.name.startsWith("visual-wall-"))).toHaveLength(6);
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
      expect(mesh.position.x).toBeCloseTo(5.12, 4);
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

  // ─── Ownership accent ─────────────────────────────────────────────────

  describe("ownership accent", () => {
    it("distinguishes local-owner structures from remote-owner structures", () => {
      const localWall = { ...structure("local", "wall"), ownerId: "local" };
      const remoteWall = { ...structure("remote", "wall"), ownerId: "remote" };
      renderer.setLocalSessionId("local");
      renderer.syncStructures({ structures: { local: localWall, remote: remoteWall } });
      advance(300); // construction complete

      const localMat = (scene.getMeshByName("structure-local") as Mesh).material as StandardMaterial;
      const remoteMat = (scene.getMeshByName("structure-remote") as Mesh).material as StandardMaterial;

      // Local owner: emissive g is boosted by LOCAL_OWNER_ACCENT[1] (0.06).
      // Remote owner: emissive r is boosted by REMOTE_OWNER_ACCENT[0] (0.05).
      // SOLID_EMISSIVE = (0.02, 0.02, 0.04).
      // Local: g = 0.02 + 0.06 = 0.08
      // Remote: r = 0.02 + 0.05 = 0.07
      expect(localMat.emissiveColor.g).toBeCloseTo(0.08, 5);
      expect(remoteMat.emissiveColor.r).toBeCloseTo(0.07, 5);

      // The accents are clearly different channels.
      expect(localMat.emissiveColor.g).toBeGreaterThan(remoteMat.emissiveColor.g);
      expect(remoteMat.emissiveColor.r).toBeGreaterThan(localMat.emissiveColor.r);
    });

    it("is stable across frames (no per-frame drift or pulse)", () => {
      const localWall = { ...structure("local", "wall"), ownerId: "local" };
      renderer.setLocalSessionId("local");
      renderer.syncStructures({ structures: { local: localWall } });
      advance(300); // construction complete

      const mat = (scene.getMeshByName("structure-local") as Mesh).material as StandardMaterial;
      const r0 = mat.emissiveColor.r;
      const g0 = mat.emissiveColor.g;
      const b0 = mat.emissiveColor.b;

      for (let i = 0; i < 20; i++) advance(16);

      expect(mat.emissiveColor.r).toBe(r0);
      expect(mat.emissiveColor.g).toBe(g0);
      expect(mat.emissiveColor.b).toBe(b0);
    });

    it("updates all existing structures when the session ID changes", () => {
      const wallA = { ...structure("a", "wall"), ownerId: "playerA" };
      const wallB = { ...structure("b", "wall"), ownerId: "playerB" };
      renderer.setLocalSessionId("playerA");
      renderer.syncStructures({ structures: { a: wallA, b: wallB } });
      advance(300);

      const matA = (scene.getMeshByName("structure-a") as Mesh).material as StandardMaterial;
      const matB = (scene.getMeshByName("structure-b") as Mesh).material as StandardMaterial;

      // playerA is local → accent g; playerB is remote → accent r.
      expect(matA.emissiveColor.g).toBeGreaterThan(matB.emissiveColor.g);
      expect(matB.emissiveColor.r).toBeGreaterThan(matA.emissiveColor.r);

      // Switch local session to playerB.
      renderer.setLocalSessionId("playerB");
      advance(16);

      const matA2 = (scene.getMeshByName("structure-a") as Mesh).material as StandardMaterial;
      const matB2 = (scene.getMeshByName("structure-b") as Mesh).material as StandardMaterial;

      // Now playerB is local → accent g; playerA is remote → accent r.
      expect(matB2.emissiveColor.g).toBeGreaterThan(matA2.emissiveColor.g);
      expect(matA2.emissiveColor.r).toBeGreaterThan(matB2.emissiveColor.r);
    });

    it("clears the local accent when the session ID is set to null (disconnect)", () => {
      const wall = { ...structure("wall", "wall"), ownerId: "local" };
      renderer.setLocalSessionId("local");
      renderer.syncStructures({ structures: { wall } });
      advance(300);

      const mat = (scene.getMeshByName("structure-wall") as Mesh).material as StandardMaterial;
      const localEmissiveG = mat.emissiveColor.g;
      expect(localEmissiveG).toBeCloseTo(0.08, 5); // local accent active

      renderer.setLocalSessionId(null);
      advance(16);

      const remoteMat = (scene.getMeshByName("structure-wall") as Mesh).material as StandardMaterial;
      // Now remote accent: g = 0.02 + 0.02 = 0.04
      expect(remoteMat.emissiveColor.g).toBeCloseTo(0.04, 5);
    });

    it("is absent before setLocalSessionId is called (all structures get remote accent)", () => {
      const wall = { ...structure("wall", "wall"), ownerId: "someowner" };
      // Do NOT call setLocalSessionId.
      renderer.syncStructures({ structures: { wall } });
      advance(300);

      const mat = (scene.getMeshByName("structure-wall") as Mesh).material as StandardMaterial;
      // Remote accent: r = 0.02 + 0.05 = 0.07
      expect(mat.emissiveColor.r).toBeCloseTo(0.07, 5);
    });

    it("composes correctly with the damage tint (accent + damage tint are additive)", () => {
      const wall = { ...structure("wall", "wall"), ownerId: "local" };
      renderer.setLocalSessionId("local");
      renderer.syncStructures({ structures: { wall } });
      advance(300);

      const mat = (scene.getMeshByName("structure-wall") as Mesh).material as StandardMaterial;
      const healthyG = mat.emissiveColor.g;

      // Heavy damage: tint shifts diffuse toward DAMAGED_COLOR, emissive shifts toward DAMAGED_EMISSIVE.
      renderer.updateStructureDurability("wall", durability(20, 200));
      advance(200); // past hit-flash

      const damagedMat = (scene.getMeshByName("structure-wall") as Mesh).material as StandardMaterial;
      // The damaged emissive r is dominated by the DAMAGED_EMISSIVE shift,
      // but the local accent still adds to g.
      expect(damagedMat.emissiveColor.g).toBeGreaterThan(healthyG - 0.01); // accent persists
    });

    it("lifecycle: accent is removed when the structure is destroyed", () => {
      const wall = { ...structure("wall", "wall"), ownerId: "local" };
      renderer.setLocalSessionId("local");
      renderer.syncStructures({ structures: { wall } });
      advance(300);

      // Destroy the structure.
      renderer.syncStructures({ structures: {} });
      advance(300); // destruction animation completes

      expect(scene.getMeshByName("structure-wall")).toBeNull();
    });

    it("performance: 50 structures with mixed ownership have stable materials across frames", () => {
      const structures: Record<string, StructureState> = {};
      for (let i = 0; i < 50; i++) {
        structures[`s-${i}`] = {
          ...structure(`s-${i}`, "wall", "", { x: i % 10, y: 0, z: Math.floor(i / 10) }),
          ownerId: i % 2 === 0 ? "playerA" : "playerB",
        };
      }
      renderer.setLocalSessionId("playerA");
      renderer.syncStructures({ structures });
      advance(300); // construction complete

      // Sample emissive values for a spread of structures.
      const samples: Array<{ name: string; r: number; g: number; b: number }> = [];
      for (const i of [0, 1, 10, 11, 25, 49]) {
        const mat = (scene.getMeshByName(`structure-s-${i}`) as Mesh).material as StandardMaterial;
        samples.push({ name: `structure-s-${i}`, r: mat.emissiveColor.r, g: mat.emissiveColor.g, b: mat.emissiveColor.b });
      }

      // Advance 30 frames.
      for (let f = 0; f < 30; f++) advance(16);

      // All materials must be bit-stable (no drift).
      for (const s of samples) {
        const mat = (scene.getMeshByName(s.name) as Mesh).material as StandardMaterial;
        expect(mat.emissiveColor.r).toBe(s.r);
        expect(mat.emissiveColor.g).toBe(s.g);
        expect(mat.emissiveColor.b).toBe(s.b);
      }

      // Verify ownership distinction is preserved:
      // even indices (playerA = local) have higher g than odd indices (playerB = remote).
      const localMat = (scene.getMeshByName("structure-s-0") as Mesh).material as StandardMaterial;
      const remoteMat = (scene.getMeshByName("structure-s-1") as Mesh).material as StandardMaterial;
      expect(localMat.emissiveColor.g).toBeGreaterThan(remoteMat.emissiveColor.g);
    });

    it("setLocalSessionId is a no-op after dispose", () => {
      renderer.dispose();
      expect(() => renderer.setLocalSessionId("local")).not.toThrow();
    });

    it("setLocalSessionId with the same value does not re-mark structures dirty", () => {
      const wall = { ...structure("wall", "wall"), ownerId: "local" };
      renderer.setLocalSessionId("local");
      renderer.syncStructures({ structures: { wall } });
      advance(300);

      const mat = (scene.getMeshByName("structure-wall") as Mesh).material as StandardMaterial;
      const r0 = mat.emissiveColor.r;
      const g0 = mat.emissiveColor.g;

      // Setting the same session ID again should be a no-op.
      renderer.setLocalSessionId("local");
      advance(16);

      expect(mat.emissiveColor.r).toBe(r0);
      expect(mat.emissiveColor.g).toBe(g0);
    });
  });
});
