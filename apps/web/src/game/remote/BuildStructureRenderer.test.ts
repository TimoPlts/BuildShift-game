import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import type { BuildingState, StructureState } from "@buildshift/protocol";
import { BuildStructureRenderer } from "./BuildStructureRenderer";

function structure(
  structureId: string,
  buildType: StructureState["buildType"],
  editType: StructureState["editType"] = "",
): StructureState {
  return {
    structureId,
    buildType,
    grid: { x: 0, y: 0, z: 0 },
    rotation: 0,
    ownerId: "owner",
    createdSequence: 0,
    editType,
  };
}

describe("BuildStructureRenderer", () => {
  let engine: NullEngine | undefined;
  let scene: Scene | undefined;
  let renderer: BuildStructureRenderer | undefined;

  afterEach(() => {
    renderer?.dispose();
    scene?.dispose();
    engine?.dispose();
  });

  it("renders every replicated build type and removes visuals from authoritative state", () => {
    engine = new NullEngine();
    scene = new Scene(engine);
    renderer = new BuildStructureRenderer(scene);
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

    renderer.syncStructures({ structures: { wall: state.structures.wall } });
    expect(scene.getMeshByName("structure-floor")).toBeNull();
    expect(scene.getMeshByName("structure-ramp")).toBeNull();
    expect(scene.getMeshByName("structure-cone")).toBeNull();

    // An authoritative round reset is an empty replicated structure set.
    renderer.syncStructures({ structures: {} });
    expect(scene.getMeshByName("structure-wall")).toBeNull();
  });

  it("updates a replicated build edit without changing gameplay state", () => {
    engine = new NullEngine();
    scene = new Scene(engine);
    renderer = new BuildStructureRenderer(scene);
    const wall = structure("wall", "wall");
    renderer.syncStructures({ structures: { wall } });

    const before = scene.getMeshByName("structure-wall")!;
    expect(before.scaling.y).toBe(1);
    const beforeY = before.position.y;
    renderer.syncStructures({
      structures: { wall: { ...wall, editType: "half_top" } },
    });

    const edited = scene.getMeshByName("structure-wall")!;
    expect(edited.scaling.y).toBe(0.5);
    expect(edited.position.y).toBeGreaterThan(beforeY);
  });
});
