/**
 * Obstruction stability tests for the line-sharing camera
 * (build-feel-20261123 — "sudden unwanted zoom when walking on or beside
 * builds").
 *
 * Pinned behaviours:
 *  1. SELF-SURFACE SKIP: an obstacle box containing the eye origin (the
 *     volume the player is standing on/inside) must NOT collapse the
 *     tracking distance to `minimumCameraDistance` — that was the reported
 *     zoom that buried the camera inside the yellow build. Boxes the eye is
 *     outside still obstruct exactly as before (real wall/ceiling safety).
 *  2. HYSTERESIS: the obstruction dolly snaps IN instantly (the camera must
 *     never clip a solid) but RELEASES at
 *     `obstructionRecoveryMetersPerSecond`, so recovering after walking
 *     past a build edge / step-up / jump / crouch is a smooth glide, never
 *     a snap.
 *  In every case the camera stays exactly ON the shot line and the aim
 *  direction is untouched (centred-crosshair invariant).
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core";
import { ThirdPersonCameraController, type ObstacleAABB } from "./ThirdPersonCameraController";
import { THIRD_PERSON_CAMERA } from "./cameraConfig";

const FEET = new Vector3(0, 0, 0);
const DT = 1 / 60;

function build() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const controller = new ThirdPersonCameraController(scene);
  return { engine, scene, controller };
}

/** Distance from the camera to the current eye origin (the tracking
 * distance along the line, signed behind the eye). */
function trackDist(controller: ThirdPersonCameraController, feet = FEET): number {
  const eye = new Vector3(feet.x, feet.y + controller.eyeHeight(), feet.z);
  return Vector3.Distance(controller.getCamera().position, eye);
}

/** Cross product magnitude of (camPos - eye) with dir — 0 iff on the line. */
function offLine(controller: ThirdPersonCameraController, feet = FEET): number {
  const dir = controller.getAimDirection();
  const eye = new Vector3(feet.x, feet.y + controller.eyeHeight(), feet.z);
  return Vector3.Cross(controller.getCamera().position.subtract(eye), dir).length();
}

/** Solid box spanning x/z, y ∈ [y0, y1], starting `zMin` behind the player
 * (yaw 0 → camera sits toward +Z). */
function slabBehind(y0: number, y1: number, zMin: number, zMax: number): ObstacleAABB {
  return { min: [-20, y0, zMin], max: [20, y1, zMax] };
}

describe("ThirdPersonCameraController obstruction stability (build-feel-20261123)", () => {
  it("a box containing the eye (self-surface: standing on/inside the build) does NOT collapse the rig", () => {
    const { engine, controller } = build();
    try {
      // The reported failure: a phantom full-volume build AABB swallowing
      // the eye → t = 0 → distance collapses to minimumCameraDistance and
      // the camera renders from inside the yellow build.
      controller.setObstacles([slabBehind(-1, 5, -30, 30)]);
      controller.update(FEET, DT);
      const d = trackDist(controller);
      expect(d).toBeCloseTo(THIRD_PERSON_CAMERA.distance, 6); // full 3.7 m rig kept
      expect(d).toBeGreaterThan(THIRD_PERSON_CAMERA.minimumCameraDistance * 2);
      expect(offLine(controller)).toBeLessThan(1e-6);
      // Aim untouched.
      const fwd = controller.getCamera().getForwardRay().direction;
      expect(fwd.z).toBeCloseTo(-1, 6);
      expect(Math.abs(fwd.x)).toBeLessThan(1e-6);
      expect(Math.abs(fwd.y)).toBeLessThan(1e-6);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("a box the eye is outside still obstructs exactly (real wall safety)", () => {
    const { engine, controller } = build();
    try {
      // Eye at y = 1.2, z = 0; wall face at z = 3 (behind the camera side).
      controller.setObstacles([slabBehind(0, 4, 3, 4)]);
      controller.update(FEET, DT);
      expect(trackDist(controller)).toBeCloseTo(
        3 - THIRD_PERSON_CAMERA.buildObstructionGap,
        6,
      );
      expect(offLine(controller)).toBeLessThan(1e-6);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("mixed self/foreign boxes: only the foreign wall dollies the camera in", () => {
    const { engine, controller } = build();
    try {
      controller.setObstacles([
        slabBehind(-1, 5, -30, 30), // contains the eye → ignored
        slabBehind(0, 4, 2.5, 3.5), // genuine wall behind the camera side
      ]);
      controller.update(FEET, DT);
      expect(trackDist(controller)).toBeCloseTo(
        2.5 - THIRD_PERSON_CAMERA.buildObstructionGap,
        6,
      );
      expect(offLine(controller)).toBeLessThan(1e-6);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("dolly-in is instant (never clips), recovery is finite-speed and monotonic (hysteresis)", () => {
    const { engine, controller } = build();
    try {
      const wall = [slabBehind(0, 4, 1, 2)];
      const noWall: ObstacleAABB[] = [];

      // Frame 1: wall appears → camera must already be clear of the face
      // (instant retract — a slow dolly-in would clip the solid).
      controller.setObstacles(wall);
      controller.update(FEET, DT);
      expect(trackDist(controller)).toBeCloseTo(
        1 - THIRD_PERSON_CAMERA.buildObstructionGap,
        6,
      );

      // Wall disappears (player walked past the edge): recovery must NOT
      // snap back to 3.7 in one frame…
      controller.setObstacles(noWall);
      controller.update(FEET, DT);
      const d1 = trackDist(controller);
      expect(d1).toBeLessThan(THIRD_PERSON_CAMERA.distance - 0.5);
      expect(d1).toBeGreaterThan(1 - THIRD_PERSON_CAMERA.buildObstructionGap);

      // …it glides at the configured rate, monotonically…
      const maxStep = THIRD_PERSON_CAMERA.obstructionRecoveryMetersPerSecond * DT + 1e-9;
      let prev = d1;
      const trace = [d1];
      for (let i = 0; i < 40; i++) {
        controller.update(FEET, DT);
        const d = trackDist(controller);
        expect(d - prev).toBeLessThanOrEqual(maxStep);
        expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
        expect(offLine(controller)).toBeLessThan(1e-6);
        prev = d;
        trace.push(d);
      }
      // …and fully re-homed to the inherited closer3.7 m framing.
      expect(prev).toBeCloseTo(THIRD_PERSON_CAMERA.distance, 6);
      expect(trace.every((d) => d <= THIRD_PERSON_CAMERA.distance + 1e-9)).toBe(true);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("walk-past a build edge at 60 fps never produces a sudden zoom step", () => {
    const { engine, controller } = build();
    try {
      // Simulate the camera-line hit distance shrinking as the player
      // strafes: the limit tightens gradually (a sweep across a ramp/cone
      // row), then clears. Steps at 60 Hz, sampling the tracking distance.
      const limitAt = (i: number) => 3.2 - 0.02 * i; // −2 cm/frame dolly-in
      const N = 60;
      const dists: number[] = [];
      for (let i = 0; i < N; i++) {
        const z = Math.max(0.6, limitAt(i));
        controller.setObstacles([slabBehind(0, 4, z, z + 1)]);
        controller.update(FEET, DT);
        dists.push(trackDist(controller));
      }
      // Dolly-in follows the shrinking limit exactly (no clipping lag)…
      expect(dists[N - 1]!).toBeCloseTo(
        Math.max(0.6, limitAt(N - 1)) - THIRD_PERSON_CAMERA.buildObstructionGap,
        6,
      );
      // …and no single frame jumps more than the configured step + dolly.
      const maxJump = THIRD_PERSON_CAMERA.obstructionRecoveryMetersPerSecond * DT + 0.02 + 1e-9;
      for (let i = 1; i < N; i++) {
        expect(Math.abs(dists[i]! - dists[i - 1]!)).toBeLessThanOrEqual(maxJump);
      }
      // Clearing the last obstacle recovers smoothly to the nominal rig.
      controller.setObstacles([]);
      let prev = dists[N - 1]!;
      for (let i = 0; i < 90; i++) {
        controller.update(FEET, DT);
        const d = trackDist(controller);
        expect(d - prev).toBeLessThanOrEqual(
          THIRD_PERSON_CAMERA.obstructionRecoveryMetersPerSecond * DT + 1e-9,
        );
        prev = d;
      }
      expect(prev).toBeCloseTo(THIRD_PERSON_CAMERA.distance, 6);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("recovery during step/jump/crouch footwork stays on-line and bounded", () => {
    const { engine, controller } = build();
    try {
      controller.setObstacles([slabBehind(0, 4, 1, 2)]);
      controller.update(FEET, DT); // dolled in at 0.9 m
      controller.setObstacles([]);

      // Jump (feet rise), crouch (pivot drops), land — all mid-recovery.
      const feetTrace = [0.4, 0.7, 0.4, 0];
      for (const crouched of [false, true, false]) {
        controller.setCrouched(crouched);
        for (const fy of feetTrace) {
          const feet = new Vector3(0, fy, 0);
          controller.update(feet, DT);
          const d = trackDist(controller, feet);
          expect(d).toBeGreaterThanOrEqual(THIRD_PERSON_CAMERA.minimumCameraDistance - 1e-9);
          expect(d).toBeLessThanOrEqual(THIRD_PERSON_CAMERA.distance + 1e-9);
          expect(offLine(controller, feet)).toBeLessThan(1e-6);
        }
      }
      controller.setCrouched(false);
      controller.setObstacles([]);
      for (let i = 0; i < 120; i++) controller.update(FEET, DT);
      expect(trackDist(controller)).toBeCloseTo(THIRD_PERSON_CAMERA.distance, 6);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("FOV never moves while the dolly works (no huge FOV changes)", () => {
    const { engine, controller } = build();
    try {
      const fov0 = controller.getCamera().fov;
      controller.setObstacles([slabBehind(0, 4, 0.5, 1)]);
      controller.update(FEET, DT);
      expect(controller.getCamera().fov).toBe(fov0);
      controller.setObstacles([]);
      controller.update(FEET, DT);
      expect(controller.getCamera().fov).toBe(fov0);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });
});
