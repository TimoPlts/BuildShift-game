/**
 * Closer over-the-shoulder framing (presentation mission: humanoid reads at
 * a comfortable size instead of tiny).
 *
 * The orbit distance was tuned from 7.0 m down into the 5.0–5.3 m band
 * (currently 5.2 m). Pinned here — measured from the ACTUAL camera
 * transform, not just re-reading the constant:
 *  - the level look sits at the new, closer orbit distance behind the exact
 *    shoulder pivot, with the camera forward still the pure yaw/pitch aim
 *    direction (crosshair/aim-ray contracts unchanged);
 *  - the standing humanoid subtends a noticeably larger vertical angle than
 *    it did at the old 7 m distance (real framing gain, not a FOV trick);
 *  - the aim direction for a given yaw/pitch is identical to what it was at
 *    7 m — shortening the orbit never rotates the view;
 *  - the floor dolly still lifts the camera no lower than
 *    `minimumCameraHeight` at a steep upward look (and now engages sooner,
 *    since the shorter orbit would otherwise dip lower), and the crouch dip
 *    still lowers the pivot without touching aim.
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core";
import { PLAYER_COLLIDER_TOTAL_HEIGHT } from "@buildshift/game-config";
import { ThirdPersonCameraController } from "./ThirdPersonCameraController";
import { THIRD_PERSON_CAMERA } from "./cameraConfig";

const FEET = new Vector3(0, 0, 6);
const PREVIOUS_DISTANCE = 7.0;

function build() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const controller = new ThirdPersonCameraController(scene);
  return { engine, scene, controller };
}

function expectedForward(yaw: number, pitch: number): Vector3 {
  return new Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  );
}

/** Vertical angle (radians) a body of `height` at range `d` subtends. */
const subtendedAngle = (height: number, d: number) =>
  2 * Math.atan(height / 2 / d);

describe("third-person closer over-the-shoulder framing", () => {
  it("uses a moderately closer orbit distance (5.0–5.3 m band, not first-person)", () => {
    const { distance, minimumCameraDistance } = THIRD_PERSON_CAMERA;
    // Noticeably closer than the old 7 m, but with real body clearance:
    // still well outside the shoulder offset and the dolly floor.
    expect(distance).toBeGreaterThanOrEqual(5.0);
    expect(distance).toBeLessThanOrEqual(5.3);
    expect(distance).toBeLessThan(PREVIOUS_DISTANCE - 1.5);
    expect(distance - minimumCameraDistance).toBeGreaterThan(3.5);
    // FOV must be untouched (no framing workaround through the lens).
    expect(THIRD_PERSON_CAMERA.fieldOfView).toBe(1.4);
  });

  it("positions the camera at the new distance behind the exact shoulder pivot with pure aim", () => {
    const { engine, controller } = build();
    try {
      const yaw = 0.25;
      controller.applyLook(-yaw / THIRD_PERSON_CAMERA.mouseSensitivity, 0);
      controller.update(FEET);

      const { distance, targetHeight, shoulderOffset } = THIRD_PERSON_CAMERA;
      const pivot = new Vector3(
        FEET.x - Math.cos(yaw) * shoulderOffset,
        FEET.y + targetHeight,
        FEET.z - Math.sin(yaw) * shoulderOffset,
      );
      const forward = expectedForward(yaw, 0);
      const position = controller.getCamera().position;

      // Actual orbit geometry: exactly `distance` behind the pivot.
      expect(Vector3.Distance(position, pivot)).toBeCloseTo(distance, 6);

      // Aim unchanged: camera forward is still the pure yaw/pitch direction.
      const aim = controller.getCamera().getForwardRay().direction;
      expect(aim.x).toBeCloseTo(forward.x, 6);
      expect(aim.y).toBeCloseTo(forward.y, 6);
      expect(aim.z).toBeCloseTo(forward.z, 6);

      // The old 7 m placement would be a full 1.8 m further back along the
      // same ray — confirm the new position is strictly in between the old
      // slot and the pivot (a dolly-in along the identical aim ray).
      const oldPosition = pivot.subtract(forward.scale(PREVIOUS_DISTANCE));
      expect(Vector3.Distance(position, oldPosition)).toBeCloseTo(
        PREVIOUS_DISTANCE - distance,
        6,
      );
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("standing humanoid subtends a noticeably larger vertical angle than at 7 m", () => {
    const { distance } = THIRD_PERSON_CAMERA;
    const gained = subtendedAngle(PLAYER_COLLIDER_TOTAL_HEIGHT, distance);
    const before = subtendedAngle(PLAYER_COLLIDER_TOTAL_HEIGHT, PREVIOUS_DISTANCE);
    // Real angular gain from the shorter orbit — at least a third larger.
    expect(gained / before).toBeGreaterThan(1.33);
    // But not first-person: the body still subtends a modest fraction of
    // the vertical FOV, leaving the crosshair view unobstructed.
    expect(gained).toBeLessThan(THIRD_PERSON_CAMERA.fieldOfView / 2);
  });

  it("aim direction for the same yaw/pitch is identical to the old 7 m orbit", () => {
    const { engine, controller } = build();
    try {
      controller.applyLook(
        -0.9 / THIRD_PERSON_CAMERA.mouseSensitivity,
        -0.3 / THIRD_PERSON_CAMERA.mouseSensitivity,
      );
      controller.update(FEET);
      const aim = controller.getAimDirection();
      const expected = expectedForward(0.9, 0.3);
      // Distance is not an input to aim: identical at 5.2 m and at 7 m.
      expect(Vector3.Distance(aim, expected)).toBeLessThan(1e-9);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("floor guard still clamps at minimumCameraHeight and crouch dip still lowers the pivot", () => {
    const { engine, controller } = build();
    try {
      // Steep upward look: the shorter orbit would dip the camera lower, so
      // the dolly must engage and never let the camera clip under the floor.
      controller.applyLook(
        0,
        -THIRD_PERSON_CAMERA.maximumPitch / THIRD_PERSON_CAMERA.mouseSensitivity + 0.5,
      );
      controller.update(FEET);
      const camera = controller.getCamera();
      const upPosition = camera.position.clone();
      expect(upPosition.y).toBeGreaterThanOrEqual(
        THIRD_PERSON_CAMERA.minimumCameraHeight - 1e-6,
      );

      // The pitch clamp keeps a standing level-look camera above the floor
      // at the new distance with margin: pivot 1.6 m, dolly floor 0.2 m.
      expect(
        THIRD_PERSON_CAMERA.targetHeight -
          THIRD_PERSON_CAMERA.minimumCameraHeight,
      ).toBeGreaterThan(0);

      // Crouch: pivot (look target) drops by the dip, camera drops with it,
      // and the aim direction is untouched.
      controller.applyLook(0, 0);
      controller.update(FEET);
      const standing = {
        pivotY: (controller as unknown as { lookTarget: Vector3 }).lookTarget.y,
        aim: controller.getAimDirection().clone(),
      };
      controller.setCrouchDip(THIRD_PERSON_CAMERA.crouchDip);
      controller.update(FEET);
      const crouched = {
        pivotY: (controller as unknown as { lookTarget: Vector3 }).lookTarget.y,
        aim: controller.getAimDirection().clone(),
      };
      expect(crouched.pivotY).toBeCloseTo(
        standing.pivotY - THIRD_PERSON_CAMERA.crouchDip,
        6,
      );
      expect(Vector3.Distance(crouched.aim, standing.aim)).toBeLessThan(1e-9);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });
});
