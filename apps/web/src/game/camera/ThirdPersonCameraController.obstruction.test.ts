/**
 * Ground obstruction (floor guard) tests for the line-sharing camera.
 *
 * Looking UP, the shot line trails below the camera floor behind the eye.
 * The guard dollies IN ALONG THE LINE so the camera height stays at or above
 * `minimumCameraHeight` — it never moves the camera off the line (the CSS
 * screen-centre ray stays the shot ray) and never leaves the camera below
 * the floor, even at max pitch from the low crouched eye.
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core";
import { ThirdPersonCameraController } from "./ThirdPersonCameraController";
import { THIRD_PERSON_CAMERA } from "./cameraConfig";

const FEET = new Vector3(1, 0, 2);

function build() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const controller = new ThirdPersonCameraController(scene);
  return { engine, scene, controller };
}

/** Apply an absolute yaw/pitch through the only orientation input there is. */
function aim(controller: ThirdPersonCameraController, yaw: number, pitch: number) {
  controller.applyLook(
    -yaw / THIRD_PERSON_CAMERA.mouseSensitivity,
    -pitch / THIRD_PERSON_CAMERA.mouseSensitivity,
  );
}

/** Cross product magnitude of (camPos - eye) with dir — 0 iff on the line. */
function offLineMagnitude(controller: ThirdPersonCameraController, feet: Vector3) {
  const dir = controller.getAimDirection();
  const eye = new Vector3(feet.x, feet.y + controller.eyeHeight(), feet.z);
  const toCam = controller.getCamera().position.subtract(eye);
  return Vector3.Cross(toCam, dir).length();
}

describe("ThirdPersonCameraController floor guard (on-line dolly)", () => {
  it("level and downward looks sit at the full tracking distance behind the eye", () => {
    const { engine, controller } = build();
    try {
      for (const pitch of [0, -0.5, THIRD_PERSON_CAMERA.minimumPitch]) {
        aim(controller, 0.4, pitch);
        controller.update(FEET);
        const pos = controller.getCamera().position;
        const eye = new Vector3(FEET.x, FEET.y + controller.eyeHeight(), FEET.z);
        expect(Vector3.Distance(pos, eye)).toBeCloseTo(THIRD_PERSON_CAMERA.distance, 6);
        expect(offLineMagnitude(controller, FEET)).toBeLessThan(1e-6);
      }
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("looking up dollies in along the line so the camera rests exactly at minimumCameraHeight", () => {
    const { engine, controller } = build();
    try {
      aim(controller, 0, Math.PI / 6); // +30°
      controller.update(FEET);
      const pos = controller.getCamera().position;
      expect(pos.y).toBeCloseTo(THIRD_PERSON_CAMERA.minimumCameraHeight, 6);
      // Still exactly on the shot line (screen centre == shot ray).
      expect(offLineMagnitude(controller, FEET)).toBeLessThan(1e-6);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("at max pitch (standing and crouched) the camera is never below the floor and never off the line", () => {
    const { engine, controller } = build();
    try {
      for (const crouched of [false, true]) {
        controller.setCrouched(crouched);
        for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 4]) {
          aim(controller, yaw, THIRD_PERSON_CAMERA.maximumPitch);
          controller.update(FEET);
          const pos = controller.getCamera().position;
          expect(pos.y).toBeGreaterThanOrEqual(
            THIRD_PERSON_CAMERA.minimumCameraHeight - 1e-6,
          );
          expect(offLineMagnitude(controller, FEET)).toBeLessThan(1e-6);
          // And the dolly never passed through the eye to the far side.
          const dir = controller.getAimDirection();
          const eye = new Vector3(FEET.x, FEET.y + controller.eyeHeight(), FEET.z);
          const along = pos.subtract(eye).dot(dir);
          expect(along).toBeLessThanOrEqual(0);
          expect(-along).toBeGreaterThanOrEqual(
            THIRD_PERSON_CAMERA.minimumCameraDistance - 1e-6,
          );
        }
      }
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("the guard never rotates the camera: forward stays the raw aim direction", () => {
    const { engine, controller } = build();
    try {
      aim(controller, 0.9, THIRD_PERSON_CAMERA.maximumPitch);
      controller.update(FEET);
      const forward = controller.getCamera().getForwardRay().direction;
      const dir = controller.getAimDirection();
      expect(forward.x).toBeCloseTo(dir.x, 5);
      expect(forward.y).toBeCloseTo(dir.y, 5);
      expect(forward.z).toBeCloseTo(dir.z, 5);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });
});
