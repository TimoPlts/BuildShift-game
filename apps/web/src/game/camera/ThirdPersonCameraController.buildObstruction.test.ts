/**
 * Behavioral NullEngine tests for the camera build-structure obstruction:
 * when the camera's orbit path from the pivot toward the camera position
 * intersects a solid build structure AABB, the camera dollies in to just
 * before the nearest hit point (minus the configured gap).
 *
 * Contracts pinned here:
 *  - the camera never renders inside a solid build structure;
 *  - the dolly is a pure distance change along the orbit path: the look
 *    target and the aim direction (camera forward) are untouched;
 *  - when no structure obstructs the path, the camera uses the full
 *    tracking distance (unaffected by the obstruction system);
 *  - the dolly can never bring the camera closer than
 *    `minimumCameraDistance` to the pivot;
 *  - multiple structures: the nearest hit wins (shortest dolly).
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core";
import {
  ThirdPersonCameraController,
  type ObstacleAABB,
} from "./ThirdPersonCameraController";
import { THIRD_PERSON_CAMERA } from "./cameraConfig";

const FEET = new Vector3(0, 0, 6);

function build() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const controller = new ThirdPersonCameraController(scene);
  return { engine, scene, controller };
}

/**
 * Computes the orbit pivot for the given feet position at yaw=0, pitch=0.
 * The pivot is shoulderOffset metres screen-right of the player.
 */
function pivotAtYaw0(): Vector3 {
  const { targetHeight, shoulderOffset } = THIRD_PERSON_CAMERA;
  // At yaw=0: rightX = -cos(0) = -1, rightZ = -sin(0) = 0
  return new Vector3(
    FEET.x + (-1) * shoulderOffset,
    FEET.y + targetHeight,
    FEET.z + 0,
  );
}

/**
 * At yaw=0, pitch=0: the camera forward is (0, 0, -1), so the camera sits
 * at pivot - forward * distance = (pivot.x, pivot.y, pivot.z + distance).
 */
function unobstructedCameraPos(): Vector3 {
  const pivot = pivotAtYaw0();
  return new Vector3(pivot.x, pivot.y, pivot.z + THIRD_PERSON_CAMERA.distance);
}

describe("ThirdPersonCameraController build obstruction", () => {
  it("dollies in when a structure blocks the orbit path", () => {
    const { engine, controller } = build();
    try {
      // A wall between the pivot and the unobstructed camera position.
      // At yaw=0 the camera is behind the pivot (in +Z direction).
      const pivot = pivotAtYaw0();
      // Place a box 4m behind the pivot (along +Z), spanning 2m in each axis.
      const wallCenter = new Vector3(pivot.x, pivot.y, pivot.z + 4);
      const wall: ObstacleAABB = {
        min: [wallCenter.x - 1, wallCenter.y - 1, wallCenter.z - 1],
        max: [wallCenter.x + 1, wallCenter.y + 1, wallCenter.z + 1],
      };
      controller.setObstacles([wall]);
      controller.update(FEET);

      const camera = controller.getCamera();
      const distToPivot = camera.position.subtract(pivot).length();

      // The camera should be dollied in: less than the full distance.
      expect(distToPivot).toBeLessThan(THIRD_PERSON_CAMERA.distance);

      // The camera should be just before the wall (minus the gap).
      // The near face of the wall is at z = wallCenter.z - 1 = pivot.z + 3.
      // Expected distance = 3 - buildObstructionGap.
      const expectedDist = 3 - THIRD_PERSON_CAMERA.buildObstructionGap;
      expect(distToPivot).toBeCloseTo(expectedDist, 5);

      // The aim direction is untouched: still the pure yaw/pitch forward.
      const forward = camera.getForwardRay().direction;
      expect(forward.x).toBeCloseTo(0, 8);
      expect(forward.y).toBeCloseTo(0, 8);
      expect(forward.z).toBeCloseTo(-1, 8);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("uses full tracking distance when no structure obstructs the path", () => {
    const { engine, controller } = build();
    try {
      // A wall far to the side — does not block the orbit path.
      const wall: ObstacleAABB = {
        min: [100, 0, 0],
        max: [102, 2, 2],
      };
      controller.setObstacles([wall]);
      controller.update(FEET);

      const camera = controller.getCamera();
      const distToPivot = camera.position.subtract(pivotAtYaw0()).length();
      expect(distToPivot).toBeCloseTo(THIRD_PERSON_CAMERA.distance, 5);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("no obstacles = no obstruction (identical to unobstructed position)", () => {
    const { engine, controller } = build();
    try {
      controller.setObstacles([]);
      controller.update(FEET);

      const expected = unobstructedCameraPos();
      const pos = controller.getCamera().position;
      expect(pos.x).toBeCloseTo(expected.x, 8);
      expect(pos.y).toBeCloseTo(expected.y, 8);
      expect(pos.z).toBeCloseTo(expected.z, 8);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("never dollies closer than minimumCameraDistance", () => {
    const { engine, controller } = build();
    try {
      // A wall very close to the pivot — the dolly would push the camera
      // inside the minimum distance, so it clamps.
      const pivot = pivotAtYaw0();
      const wall: ObstacleAABB = {
        min: [pivot.x - 1, pivot.y - 1, pivot.z + 0.5],
        max: [pivot.x + 1, pivot.y + 1, pivot.z + 1.5],
      };
      controller.setObstacles([wall]);
      controller.update(FEET);

      const distToPivot = controller
        .getCamera()
        .position.subtract(pivot).length();
      expect(distToPivot).toBeGreaterThanOrEqual(
        THIRD_PERSON_CAMERA.minimumCameraDistance - 1e-9,
      );
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("nearest structure wins when multiple obstacles are present", () => {
    const { engine, controller } = build();
    try {
      const pivot = pivotAtYaw0();
      // Near wall at 3m behind pivot.
      const nearWall: ObstacleAABB = {
        min: [pivot.x - 1, pivot.y - 1, pivot.z + 2.5],
        max: [pivot.x + 1, pivot.y + 1, pivot.z + 3.5],
      };
      // Far wall at 6m behind pivot.
      const farWall: ObstacleAABB = {
        min: [pivot.x - 1, pivot.y - 1, pivot.z + 5.5],
        max: [pivot.x + 1, pivot.y + 1, pivot.z + 6.5],
      };
      controller.setObstacles([nearWall, farWall]);
      controller.update(FEET);

      const distToPivot = controller
        .getCamera()
        .position.subtract(pivot).length();

      // Should be blocked by the near wall (3m - 0.5 half-extent = 2.5m from
      // pivot to near face), minus the gap.
      const expectedDist = 2.5 - THIRD_PERSON_CAMERA.buildObstructionGap;
      expect(distToPivot).toBeCloseTo(expectedDist, 5);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("obstruction does not change the aim direction (reticle stays aligned)", () => {
    const { engine, controller } = build();
    try {
      const yaw = 0.4;
      const pitch = -0.2;
      controller.applyLook(
        -yaw / THIRD_PERSON_CAMERA.mouseSensitivity,
        -pitch / THIRD_PERSON_CAMERA.mouseSensitivity,
      );

      // No obstruction baseline.
      controller.setObstacles([]);
      controller.update(FEET);
      const baseline = controller.getAimDirection();

      // Add a wall that blocks the path.
      const pivot = new Vector3(
        FEET.x - Math.cos(yaw) * THIRD_PERSON_CAMERA.shoulderOffset,
        FEET.y + THIRD_PERSON_CAMERA.targetHeight,
        FEET.z - Math.sin(yaw) * THIRD_PERSON_CAMERA.shoulderOffset,
      );
      // Place a wall 3m along the camera direction from the pivot.
      const cosP = Math.cos(pitch);
      const fwd = new Vector3(
        Math.sin(yaw) * cosP,
        Math.sin(pitch),
        -Math.cos(yaw) * cosP,
      );
      const wallCenter = pivot.add(fwd.scale(3));
      const wall: ObstacleAABB = {
        min: [wallCenter.x - 2, wallCenter.y - 2, wallCenter.z - 2],
        max: [wallCenter.x + 2, wallCenter.y + 2, wallCenter.z + 2],
      };
      controller.setObstacles([wall]);
      controller.update(FEET);
      const obstructed = controller.getAimDirection();

      expect(obstructed.x).toBeCloseTo(baseline.x, 10);
      expect(obstructed.y).toBeCloseTo(baseline.y, 10);
      expect(obstructed.z).toBeCloseTo(baseline.z, 10);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("structure behind the player does not obstruct the camera", () => {
    const { engine, controller } = build();
    try {
      const pivot = pivotAtYaw0();
      // A wall in front of the player (in -Z, away from the camera which is
      // in +Z). The camera looks toward -Z, so this wall is between the
      // player and the look target, NOT between the pivot and the camera.
      const wall: ObstacleAABB = {
        min: [pivot.x - 1, pivot.y - 1, pivot.z - 5],
        max: [pivot.x + 1, pivot.y + 1, pivot.z - 3],
      };
      controller.setObstacles([wall]);
      controller.update(FEET);

      const distToPivot = controller
        .getCamera()
        .position.subtract(pivot).length();
      expect(distToPivot).toBeCloseTo(THIRD_PERSON_CAMERA.distance, 5);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });
});
