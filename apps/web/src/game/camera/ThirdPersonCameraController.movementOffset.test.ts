/**
 * Transient vertical movement nudge (camera bob) tests for the
 * line-sharing camera.
 *
 * The bob is a world-Y number supplied by the movement-presentation module,
 * but the camera applies ONLY its projection onto the shot line
 * (`offset * aimDir.y`). The camera therefore slides along the line — the
 * aim direction and the screen-centre/shot-ray alignment are untouched, and
 * nothing is persisted into aim state.
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

function eyeOf(controller: ThirdPersonCameraController, feet = FEET) {
  return new Vector3(feet.x, feet.y + controller.eyeHeight(), feet.z);
}

describe("ThirdPersonCameraController transient vertical offset (on-line projection)", () => {
  it("level look: vertical bob has zero line projection — camera position unchanged", () => {
    const { engine, controller } = build();
    try {
      controller.update(FEET);
      const baseline = controller.getCamera().position.clone();
      controller.setTransientVerticalOffset(0.12);
      controller.update(FEET);
      const pos = controller.getCamera().position;
      expect(pos.x).toBeCloseTo(baseline.x, 9);
      expect(pos.y).toBeCloseTo(baseline.y, 9);
      expect(pos.z).toBeCloseTo(baseline.z, 9);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("downward look: bob slides the camera ALONG the line, keeping it exactly on the line", () => {
    const { engine, controller } = build();
    try {
      // Pitch down so the floor guard stays inactive and the pure bob
      // projection is observable.
      const pitch = -0.5;
      controller.applyLook(0, -pitch / THIRD_PERSON_CAMERA.mouseSensitivity);
      controller.setTransientVerticalOffset(0);
      controller.update(FEET);
      const dir = controller.getAimDirection();

      controller.setTransientVerticalOffset(0.1);
      controller.update(FEET);
      const eye = eyeOf(controller);
      const toCam = controller.getCamera().position.subtract(eye);
      // On the line: cross product with dir is zero.
      expect(Vector3.Cross(toCam, dir).length()).toBeLessThan(1e-6);
      // Slid along the line by offset * dir.y (downward look: dir.y < 0,
      // positive bob moves the camera BACK along the line).
      const along = -toCam.dot(dir);
      expect(along).toBeCloseTo(
        THIRD_PERSON_CAMERA.distance - 0.1 * dir.y,
        6,
      );
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("is transient: set per frame, does not accumulate, and never touches aim state", () => {
    const { engine, controller } = build();
    try {
      controller.applyLook(0.3 / THIRD_PERSON_CAMERA.mouseSensitivity, 0);
      const yawBefore = controller.getYaw();
      const pitchBefore = controller.getPitch();
      const dirBefore = controller.getAimDirection().clone();

      controller.setTransientVerticalOffset(0.2);
      controller.update(FEET);
      controller.setTransientVerticalOffset(0);
      controller.update(FEET);

      expect(controller.getYaw()).toBeCloseTo(yawBefore, 12);
      expect(controller.getPitch()).toBeCloseTo(pitchBefore, 12);
      const dir = controller.getAimDirection();
      expect(dir.x).toBeCloseTo(dirBefore.x, 12);
      expect(dir.y).toBeCloseTo(dirBefore.y, 12);
      expect(dir.z).toBeCloseTo(dirBefore.z, 12);
      // Zeroed bob = baseline placement again.
      expect(Vector3.Distance(controller.getCamera().position, eyeOf(controller))).toBeCloseTo(
        THIRD_PERSON_CAMERA.distance,
        6,
      );
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("setters are no-ops after dispose", () => {
    const { engine, controller } = build();
    controller.setRecoilKickback(0.1);
    controller.setTransientVerticalOffset(0.1);
    controller.setCrouched(true);
    controller.dispose();
    expect(controller.getRecoilKickback()).toBeCloseTo(0.1, 12);
    expect(controller.getTransientVerticalOffset()).toBeCloseTo(0.1, 12);
    expect(controller.isCrouchedForCamera()).toBe(true);
    engine.dispose();
  });
});
