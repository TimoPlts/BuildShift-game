/**
 * Behavioral NullEngine tests for the camera's transient vertical offset
 * (the movement-presentation camera motion hook).
 *
 * The contract being pinned:
 *  - default (offset 0) leaves the camera exactly where the tracking math
 *    puts it — no behavior change for existing consumers;
 *  - a non-zero offset is a pure VERTICAL TRANSLATION shared by the camera
 *    position and the effective look point, so the aim direction is
 *    undisturbed (unlike the pitch nudge, which rotates the view);
 *  - the offset is transient: it is set per frame, does not accumulate, and
 *    is not persisted into yaw/pitch state;
 *  - it does not interfere with the existing transient pitch nudge.
 *
 * Note: `camera.getTarget()` is refreshed only during the render path, so
 * the effective look point here is derived from the live camera position and
 * the (fresh) forward ray at the configured tracking distance.
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

/** The live aim direction (fresh under NullEngine — no render pass needed). */
function aimDirection(controller: ThirdPersonCameraController): Vector3 {
  return controller.getCamera().getForwardRay().direction;
}

/** The effective look point: position + forward * tracking distance. */
function effectiveTarget(controller: ThirdPersonCameraController): Vector3 {
  const camera = controller.getCamera();
  return camera
    .position
    .add(aimDirection(controller).scale(THIRD_PERSON_CAMERA.distance));
}

describe("ThirdPersonCameraController transient vertical offset", () => {
  it("defaults to zero and leaves the camera exactly where tracking puts it", () => {
    const { engine, controller } = build();
    try {
      controller.update(FEET);
      const baseline = controller.getCamera().position.clone();

      expect(controller.getTransientVerticalOffset()).toBe(0);

      controller.update(FEET);
      expect(controller.getCamera().position).toEqual(baseline);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("translates camera and effective look point vertically by the same amount (aim direction unchanged)", () => {
    const { engine, controller } = build();
    try {
      controller.update(FEET);
      const basePosition = controller.getCamera().position.clone();
      const baseTarget = effectiveTarget(controller);
      const baseAim = aimDirection(controller);

      controller.setTransientVerticalOffset(0.1);
      controller.update(FEET);

      const position = controller.getCamera().position;
      const target = effectiveTarget(controller);
      expect(position.y - basePosition.y).toBeCloseTo(0.1, 6);
      expect(target.y - baseTarget.y).toBeCloseTo(0.1, 6);
      expect(position.x).toBeCloseTo(basePosition.x, 6);
      expect(position.z).toBeCloseTo(basePosition.z, 6);

      // Pure translation: the aim direction is undisturbed.
      const aim = aimDirection(controller);
      expect(aim.x).toBeCloseTo(baseAim.x, 6);
      expect(aim.y).toBeCloseTo(baseAim.y, 6);
      expect(aim.z).toBeCloseTo(baseAim.z, 6);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("is transient: set per frame, does not accumulate, and is not persisted into aim state", () => {
    const { engine, controller } = build();
    try {
      controller.setTransientVerticalOffset(0.1);
      controller.update(FEET);
      const once = controller.getCamera().position.clone();

      // A second frame with the same offset yields the same position — the
      // runtime sets the value fresh each frame, and update() must not add it
      // on top of a previous frame's value.
      controller.setTransientVerticalOffset(0.1);
      controller.update(FEET);
      expect(controller.getCamera().position).toEqual(once);

      // Back to zero: the camera returns exactly to the tracked baseline.
      controller.setTransientVerticalOffset(0);
      controller.update(FEET);
      expect(controller.getCamera().position.x).toBeCloseTo(once.x, 6);
      expect(controller.getCamera().position.y).toBeCloseTo(once.y - 0.1, 6);
      expect(controller.getCamera().position.z).toBeCloseTo(once.z, 6);

      // The nudge never leaks into the aim state.
      expect(controller.getPitch()).toBe(0);
      expect(controller.getYaw()).toBe(0);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("does not interfere with the transient pitch nudge (translation vs rotation)", () => {
    const { engine, controller } = build();
    try {
      controller.update(FEET);
      const baseAim = aimDirection(controller);

      // Pitch nudge alone rotates the view (existing recoil behavior) ...
      controller.setPitchOffset(0.1);
      controller.update(FEET);
      expect(aimDirection(controller).y).not.toBeCloseTo(baseAim.y, 5);

      // ... while the vertical nudge alone does not.
      controller.setPitchOffset(0);
      controller.setTransientVerticalOffset(0.1);
      controller.update(FEET);
      const aim = aimDirection(controller);
      expect(aim.x).toBeCloseTo(baseAim.x, 6);
      expect(aim.y).toBeCloseTo(baseAim.y, 6);
      expect(aim.z).toBeCloseTo(baseAim.z, 6);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("setTransientVerticalOffset is a no-op after dispose", () => {
    const { engine, controller } = build();
    try {
      controller.dispose();
      expect(() => controller.setTransientVerticalOffset(0.5)).not.toThrow();
      expect(controller.getTransientVerticalOffset()).toBe(0);
    } finally {
      engine.dispose();
    }
  });
});
