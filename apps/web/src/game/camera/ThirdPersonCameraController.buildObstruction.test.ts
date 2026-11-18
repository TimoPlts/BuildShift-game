/**
 * Build-structure obstruction tests for the line-sharing camera.
 *
 * The guard raycasts from the EYE ORIGIN along `-aimDir` (the shot line
 * behind the player). A structure that blocks the line makes the camera
 * dolly IN along the line to just before the hit — the aim direction and the
 * centred crosshair's alignment with the shot ray never change.
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core";
import { ThirdPersonCameraController } from "./ThirdPersonCameraController";
import { THIRD_PERSON_CAMERA } from "./cameraConfig";

const FEET = new Vector3(0, 0, 0);

function build() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const controller = new ThirdPersonCameraController(scene);
  return { engine, scene, controller };
}

/** Axis-aligned wall slab perpendicular to Z spanning [zMin, zMax] behind the player at yaw 0. */
function wallAtZ(zMin: number, zMax: number) {
  return { min: [-5, 0, zMin] as const, max: [5, 4, zMax] as const };
}

describe("ThirdPersonCameraController build obstruction (on-line dolly)", () => {
  it("dollies in along the line when a structure blocks the shot line behind the eye", () => {
    const { engine, controller } = build();
    try {
      // yaw=0, pitch=0: camera direction behind the eye is +Z. Wall near
      // face at z=3 → tracking distance 3 - gap.
      controller.setObstacles([wallAtZ(3, 4)]);
      controller.update(FEET);
      const pos = controller.getCamera().position;
      const expected =
        THIRD_PERSON_CAMERA.distance > 3 - THIRD_PERSON_CAMERA.buildObstructionGap
          ? 3 - THIRD_PERSON_CAMERA.buildObstructionGap
          : THIRD_PERSON_CAMERA.distance;
      expect(pos.z).toBeCloseTo(expected, 6);
      expect(pos.x).toBeCloseTo(0, 6);
      expect(pos.y).toBeCloseTo(controller.eyeHeight(), 6); // level look: on the eye's horizontal line
      // Forward unchanged.
      const fwd = controller.getCamera().getForwardRay().direction;
      expect(fwd.z).toBeCloseTo(-1, 6);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("nearest structure wins when multiple obstacles block the line", () => {
    const { engine, controller } = build();
    try {
      controller.setObstacles([wallAtZ(4, 5), wallAtZ(1.5, 2)]);
      controller.update(FEET);
      expect(controller.getCamera().position.z).toBeCloseTo(
        1.5 - THIRD_PERSON_CAMERA.buildObstructionGap,
        6,
      );
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("a structure in FRONT of the player (on the aim side) does not obstruct the camera", () => {
    const { engine, controller } = build();
    try {
      controller.setObstacles([wallAtZ(-6, -5)]);
      controller.update(FEET);
      expect(controller.getCamera().position.z).toBeCloseTo(
        THIRD_PERSON_CAMERA.distance,
        6,
      );
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("no obstacles leave the camera at the full tracking distance", () => {
    const { engine, controller } = build();
    try {
      controller.setObstacles([]);
      controller.update(FEET);
      expect(controller.getCamera().position.z).toBeCloseTo(
        THIRD_PERSON_CAMERA.distance,
        6,
      );
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("a fully enclosed player never gets the camera pushed off the line below minimumCameraDistance", () => {
    const { engine, controller } = build();
    try {
      controller.setObstacles([wallAtZ(0.05, 10)]);
      controller.update(FEET);
      const pos = controller.getCamera().position;
      expect(pos.z).toBeCloseTo(THIRD_PERSON_CAMERA.minimumCameraDistance, 6);
      // Still on the line: x and y unchanged for a level look.
      expect(pos.x).toBeCloseTo(0, 6);
      expect(pos.y).toBeCloseTo(controller.eyeHeight(), 6);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });
});
