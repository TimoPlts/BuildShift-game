/**
 * Behavioral NullEngine tests for the camera field of view and the
 * build-mode readability FOV toggle.
 *
 * Contracts pinned here:
 *  - the camera is constructed with the configured base field of view;
 *  - `setBuildMode(true)` widens the FOV by exactly the configured delta,
 *    and `setBuildMode(false)` restores the base FOV;
 *  - toggling build mode never moves the camera or rotates the aim ray —
 *    it is a pure FOV change, so aim accuracy is unaffected;
 *  - the setter is idempotent (safe to call every frame) and a no-op after
 *    dispose.
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

describe("ThirdPersonCameraController build-mode field of view", () => {
  it("constructs with the configured base field of view", () => {
    const { engine, controller } = build();
    try {
      expect(controller.getCamera().fov).toBeCloseTo(
        THIRD_PERSON_CAMERA.fieldOfView,
        6,
      );
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("widens the FOV by exactly the configured delta in build mode and restores it after", () => {
    const { engine, controller } = build();
    try {
      const base = THIRD_PERSON_CAMERA.fieldOfView;
      const delta = THIRD_PERSON_CAMERA.buildModeFieldOfViewDelta;

      controller.setBuildMode(true);
      expect(controller.getCamera().fov).toBeCloseTo(base + delta, 6);

      // Idempotent: calling again with the same state changes nothing.
      controller.setBuildMode(true);
      expect(controller.getCamera().fov).toBeCloseTo(base + delta, 6);

      controller.setBuildMode(false);
      expect(controller.getCamera().fov).toBeCloseTo(base, 6);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("never moves the camera or rotates the aim ray when toggling build mode", () => {
    const { engine, controller } = build();
    try {
      controller.applyLook(
        -0.3 / THIRD_PERSON_CAMERA.mouseSensitivity,
        -0.5 / THIRD_PERSON_CAMERA.mouseSensitivity,
      );
      controller.update(FEET);
      const position = controller.getCamera().position.clone();
      const aim = controller.getCamera().getForwardRay().direction.clone();

      controller.setBuildMode(true);
      controller.update(FEET);
      expect(controller.getCamera().position.x).toBeCloseTo(position.x, 6);
      expect(controller.getCamera().position.y).toBeCloseTo(position.y, 6);
      expect(controller.getCamera().position.z).toBeCloseTo(position.z, 6);

      const aimAfter = controller.getCamera().getForwardRay().direction;
      expect(aimAfter.x).toBeCloseTo(aim.x, 6);
      expect(aimAfter.y).toBeCloseTo(aim.y, 6);
      expect(aimAfter.z).toBeCloseTo(aim.z, 6);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("setBuildMode is a no-op after dispose", () => {
    const { engine, controller } = build();
    try {
      const fovBefore = controller.getCamera().fov;
      controller.dispose();
      expect(() => controller.setBuildMode(true)).not.toThrow();
      expect(controller.getCamera().fov).toBe(fovBefore);
    } finally {
      engine.dispose();
    }
  });
});
