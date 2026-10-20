/**
 * Behavioral NullEngine tests for the camera's crouch dip
 * ({@link ThirdPersonCameraController.setCrouchDip}).
 *
 * The contract being pinned (mirrors the transient vertical-offset hook):
 *  - default (dip 0) leaves the camera exactly where tracking puts it;
 *  - a non-zero dip is a pure VERTICAL TRANSLATION shared by the camera
 *    position and the effective look point, so the aim direction is
 *    undisturbed;
 *  - the dip is transient: set per frame, does not accumulate, and returns to
 *    the tracked baseline at zero;
 *  - it does not leak into yaw/pitch aim state.
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core";
import { ThirdPersonCameraController } from "./ThirdPersonCameraController";

const FEET = new Vector3(0, 0, 6);
const DIP = 0.45;

function build() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const controller = new ThirdPersonCameraController(scene);
  return { engine, scene, controller };
}

/** The live aim direction (fresh under NullEngine — no render pass needed). */
function aimDirection(controller: ThirdPersonCameraController): Vector3 {
  return controller.getCamera().getForwardRay().direction;
}

describe("ThirdPersonCameraController crouch dip", () => {
  it("defaults to no dip and leaves the camera exactly where tracking puts it", () => {
    const { engine, controller } = build();
    try {
      controller.update(FEET);
      const baseline = controller.getCamera().position.clone();

      expect(controller.getCrouchDip()).toBe(0);

      controller.update(FEET);
      expect(controller.getCamera().position).toEqual(baseline);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("lowers the camera by the dip while leaving the aim direction unchanged", () => {
    const { engine, controller } = build();
    try {
      controller.update(FEET);
      const basePosition = controller.getCamera().position.clone();
      const baseAim = aimDirection(controller);

      controller.setCrouchDip(DIP);
      controller.update(FEET);

      const position = controller.getCamera().position;
      // The pivot (and camera) drop by exactly the dip; X/Z are untouched.
      expect(position.y - basePosition.y).toBeCloseTo(-DIP, 6);
      expect(position.x).toBeCloseTo(basePosition.x, 6);
      expect(position.z).toBeCloseTo(basePosition.z, 6);
      expect(controller.getCrouchDip()).toBeCloseTo(DIP, 6);

      // Pure vertical translation: the aim direction is undisturbed.
      const aim = aimDirection(controller);
      expect(aim.x).toBeCloseTo(baseAim.x, 6);
      expect(aim.y).toBeCloseTo(baseAim.y, 6);
      expect(aim.z).toBeCloseTo(baseAim.z, 6);

      // The dip never leaks into the aim state.
      expect(controller.getPitch()).toBe(0);
      expect(controller.getYaw()).toBe(0);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("is set per frame, does not accumulate, and returns to baseline at zero", () => {
    const { engine, controller } = build();
    try {
      controller.setCrouchDip(DIP);
      controller.update(FEET);
      const once = controller.getCamera().position.clone();

      // A second frame with the same dip yields the same position.
      controller.setCrouchDip(DIP);
      controller.update(FEET);
      expect(controller.getCamera().position).toEqual(once);

      // Back to zero: the camera returns exactly to the tracked baseline.
      controller.setCrouchDip(0);
      controller.update(FEET);
      expect(controller.getCamera().position.y).toBeCloseTo(once.y + DIP, 6);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("setCrouchDip is a no-op after dispose", () => {
    const { engine, controller } = build();
    try {
      controller.dispose();
      expect(() => controller.setCrouchDip(0.5)).not.toThrow();
      expect(controller.getCrouchDip()).toBe(0);
    } finally {
      engine.dispose();
    }
  });
});
