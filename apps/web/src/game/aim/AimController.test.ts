import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { computePlacementPreview } from "../building/placementPreview";
import { AimController } from "./AimController";

describe("AimController", () => {
  it("supplies the camera forward ray used by the build placement preview", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new UniversalCamera("camera", new Vector3(0, 5, 5), scene);
    camera.setTarget(Vector3.Zero());

    const direction = new AimController().getAimDirection(camera);
    expect(direction.length()).toBeCloseTo(1, 6);
    expect(direction.y).toBeLessThan(0);

    for (const buildType of ["wall", "floor", "ramp", "cone"] as const) {
      const preview = computePlacementPreview({
        aimOrigin: camera.position,
        aimDirection: direction,
        playerPosition: Vector3.Zero(),
        buildType,
        rotation: 0,
        occupied: [],
      });
      expect(preview.valid, `${buildType} should have a ground-plane candidate`).toBe(true);
    }

    scene.dispose();
    engine.dispose();
  });
});
