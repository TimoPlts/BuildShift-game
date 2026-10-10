/**
 * Behavioral NullEngine tests for the over-the-shoulder pivot and the
 * aim-authority boundary of the third-person camera.
 *
 * Contracts pinned here:
 *  - the camera forward (the aim direction) is ALWAYS the pure yaw/pitch
 *    direction — independent of the shoulder offset, the tracking distance,
 *    and any transient nudge. This is what keeps the crosshair (screen
 *    centre) an accurate aim reference while the server keeps aim authority
 *    over the yaw/pitch sent in input samples;
 *  - the orbit pivot is exactly `shoulderOffset` metres screen-right of the
 *    player's look point, and the camera sits exactly `distance` behind the
 *    pivot along the aim ray (at zero pitch);
 *  - the transient recoil pitch nudge rotates the view but never leaks into
 *    the persisted aim state (yaw/pitch).
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

/** Pure yaw/pitch forward direction (the convention the server receives). */
function expectedForward(yaw: number, pitch: number): Vector3 {
  return new Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  );
}

describe("ThirdPersonCameraController shoulder offset / aim authority", () => {
  it("aim direction is the pure yaw/pitch forward, independent of the shoulder offset", () => {
    const { engine, controller } = build();
    try {
      controller.applyLook(
        -0.35 / THIRD_PERSON_CAMERA.mouseSensitivity,
        0.2 / THIRD_PERSON_CAMERA.mouseSensitivity,
      );
      controller.update(FEET);

      const aim = controller.getCamera().getForwardRay().direction;
      const expected = expectedForward(0.35, -0.2);
      expect(aim.x).toBeCloseTo(expected.x, 6);
      expect(aim.y).toBeCloseTo(expected.y, 6);
      expect(aim.z).toBeCloseTo(expected.z, 6);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("orbits the screen-right pivot at the configured distance (zero pitch transform)", () => {
    const { engine, controller } = build();
    try {
      const yaw = 0.25;
      controller.applyLook(
        -yaw / THIRD_PERSON_CAMERA.mouseSensitivity,
        0,
      );
      controller.update(FEET);

      const { distance, targetHeight, shoulderOffset } = THIRD_PERSON_CAMERA;
      const rightX = -Math.cos(yaw);
      const rightZ = -Math.sin(yaw);
      const pivot = new Vector3(
        FEET.x + rightX * shoulderOffset,
        FEET.y + targetHeight,
        FEET.z + rightZ * shoulderOffset,
      );
      const forward = expectedForward(yaw, 0);
      const expectedPosition = pivot.subtract(forward.scale(distance));

      const position = controller.getCamera().position;
      expect(position.x).toBeCloseTo(expectedPosition.x, 6);
      expect(position.y).toBeCloseTo(expectedPosition.y, 6);
      expect(position.z).toBeCloseTo(expectedPosition.z, 6);

      // The effective look point (where the aim ray meets tracking distance)
      // is the pivot itself: the camera looks at the shoulder pivot, so the
      // player renders slightly screen-left of centre.
      const effective = position.add(forward.scale(distance));
      expect(effective.x).toBeCloseTo(pivot.x, 6);
      expect(effective.y).toBeCloseTo(pivot.y, 6);
      expect(effective.z).toBeCloseTo(pivot.z, 6);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("recoil pitch nudge rotates the view but never leaks into persisted aim state", () => {
    const { engine, controller } = build();
    try {
      controller.applyLook(
        -0.4 / THIRD_PERSON_CAMERA.mouseSensitivity,
        0,
      );
      controller.update(FEET);
      const baseAim = controller.getCamera().getForwardRay().direction.clone();

      // A transient nudge changes what the camera looks at ...
      controller.setPitchOffset(0.05);
      controller.update(FEET);
      const nudgedAim = controller.getCamera().getForwardRay().direction;
      expect(nudgedAim.y).not.toBeCloseTo(baseAim.y, 5);

      // ... but exactly matches the pure yaw/(pitch+offset) forward ...
      const expected = expectedForward(0.4, 0.05);
      expect(nudgedAim.x).toBeCloseTo(expected.x, 6);
      expect(nudgedAim.y).toBeCloseTo(expected.y, 6);
      expect(nudgedAim.z).toBeCloseTo(expected.z, 6);

      // ... and the user's aim state (what the server receives) is untouched.
      expect(controller.getYaw()).toBeCloseTo(0.4, 6);
      expect(controller.getPitch()).toBe(0);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });
});
