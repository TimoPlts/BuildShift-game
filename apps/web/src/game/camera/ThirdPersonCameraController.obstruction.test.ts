/**
 * Behavioral NullEngine tests for the camera ground-obstruction behavior:
 * when the player looks up steeply, the orbit circle would push the camera
 * below the arena floor (ground top is y = 0). Instead of letting the
 * camera clip under the floor, it dollies in along the aim ray.
 *
 * Contracts pinned here:
 *  - the camera never renders below `minimumCameraHeight`;
 *  - the dolly is a pure distance change along the aim ray: the look target
 *    and the aim direction (camera forward) are untouched, so aiming stays
 *    a function of the user's yaw/pitch only (server aim authority boundary);
 *  - level/downward looks are unaffected (full tracking distance);
 *  - the dolly can never bring the camera closer than
 *    `minimumCameraDistance` to the look target.
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core";
import { ThirdPersonCameraController } from "./ThirdPersonCameraController";
import { THIRD_PERSON_CAMERA } from "./cameraConfig";

const FEET = new Vector3(0, 0, 6);

function build() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const controller = new ThirdPersonCameraController(scene);
  return { engine, scene, controller };
}

/** The orbit pivot for the given feet position (shoulder offset applied). */
function pivot(feet: Vector3, yaw: number): Vector3 {
  const { targetHeight, shoulderOffset } = THIRD_PERSON_CAMERA;
  return new Vector3(
    feet.x - Math.cos(yaw) * shoulderOffset,
    feet.y + targetHeight,
    feet.z - Math.sin(yaw) * shoulderOffset,
  );
}

describe("ThirdPersonCameraController ground obstruction dolly", () => {
  it("dollies in along the aim ray instead of clipping below the floor when looking up", () => {
    const { engine, controller } = build();
    try {
      const pitch = Math.PI / 3; // 60° up — orbit circle would sink below y = 0
      controller.applyLook(
        0,
        -pitch / THIRD_PERSON_CAMERA.mouseSensitivity,
      );
      controller.update(FEET);

      const camera = controller.getCamera();
      const forward = camera.getForwardRay().direction;
      const distanceToPivot = camera.position
        .subtract(pivot(FEET, 0))
        .length();

      // The camera stays at or above the configured floor ...
      expect(camera.position.y).toBeGreaterThanOrEqual(
        THIRD_PERSON_CAMERA.minimumCameraHeight - 1e-9,
      );
      // ... by shrinking the tracking distance instead of moving the target.
      expect(distanceToPivot).toBeLessThan(THIRD_PERSON_CAMERA.distance);
      expect(distanceToPivot).toBeCloseTo(
        (THIRD_PERSON_CAMERA.targetHeight - THIRD_PERSON_CAMERA.minimumCameraHeight) /
          Math.sin(pitch),
        5,
      );
      // The aim direction is untouched: still the pure yaw/pitch forward.
      const expectedY = Math.sin(pitch);
      expect(forward.y).toBeCloseTo(expectedY, 5);
      expect(forward.x).toBeCloseTo(0, 5);
      expect(forward.z).toBeCloseTo(-Math.cos(pitch), 5);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("leaves level and downward looks at the full tracking distance", () => {
    const { engine, controller } = build();
    try {
      for (const pitch of [0, -0.3]) {
        controller.applyLook(
          0,
          -pitch / THIRD_PERSON_CAMERA.mouseSensitivity,
        );
        controller.update(FEET);

        const distanceToPivot = controller
          .getCamera()
          .position.subtract(pivot(FEET, 0))
          .length();
        expect(distanceToPivot).toBeCloseTo(THIRD_PERSON_CAMERA.distance, 5);
      }
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("never dollies closer than the minimum camera distance", () => {
    const { engine, controller } = build();
    try {
      // Steepest configured look (maximumPitch): the dolly is bounded by the
      // minimum distance, so the camera can never tunnel into the player.
      controller.applyLook(
        0,
        -THIRD_PERSON_CAMERA.maximumPitch / THIRD_PERSON_CAMERA.mouseSensitivity,
      );
      controller.update(FEET);

      const distanceToPivot = controller
        .getCamera()
        .position.subtract(pivot(FEET, 0))
        .length();
      expect(distanceToPivot).toBeGreaterThanOrEqual(
        THIRD_PERSON_CAMERA.minimumCameraDistance - 1e-9,
      );
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });
});
