/**
 * Feet-anchor regressions (anchored-turn 20261126).
 *
 * Reported bug: while STATIONARY, moving the mouse left/right rotated the
 * view but visibly dragged the CHARACTER through space (floating / off the
 * platform). Root cause was NEVER the camera: the camera sits on the
 * authoritative shot line through `feet + eyeHeight`, so a yaw-only sweep
 * already ORBITS the camera around a fixed anchor. The drift came from the
 * rendered body carrying a yaw-rotating root-local translation offset
 * (`localViewOffsetX = 0.8` under the body's yaw rotation), which moved the
 * rendered feet around a 0.8 m circle around the collider feet.
 *
 * These tests pin the camera-side half of the contract NUMERICALLY with
 * NullEngine projections (behavioral, not source strings):
 *  - the eye anchor (camera line origin) is invariant under yaw-only and
 *    pitch-only sweeps at a fixed feet position;
 *  - the camera itself orbits that anchor (its position must actually move);
 *  - the rendered forward equals the authoritative `ad(yaw, pitch)` aim
 *    direction at every cardinal yaw (reticle honesty is preserved);
 *  - the anchor holds on elevated feet (floor/ramp tops) and under crouch,
 *    recoil and movement bob (which stay along-line by construction).
 * The body-side half is pinned in
 * `scene/character/playerBodyFeetAnchor.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core";
import { ThirdPersonCameraController } from "./ThirdPersonCameraController";
import { THIRD_PERSON_CAMERA } from "./cameraConfig";
import {
  AIM_EYE_HEIGHT_STANDING,
  AIM_EYE_HEIGHT_CROUCHED,
} from "../aim/authoritativeAim";

const S = THIRD_PERSON_CAMERA.mouseSensitivity;
const D = THIRD_PERSON_CAMERA.distance;

let engine: NullEngine;
let scene: Scene;
let controller: ThirdPersonCameraController;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  controller = new ThirdPersonCameraController(scene);
});

afterEach(() => {
  controller.dispose();
  engine.dispose();
});

/** Drive yaw to an exact target through the production look-delta path. */
function setYaw(target: number): void {
  controller.applyLook((controller.getYaw() - target) / S, 0);
  // The controller wraps yaw into [-pi, pi]; compare modulo 2pi.
  const diff = controller.getYaw() - target;
  const wrapped = Math.atan2(Math.sin(diff), Math.cos(diff));
  expect(Math.abs(wrapped)).toBeLessThan(1e-9);
}

/** Drive pitch to an exact target through the production look-delta path. */
function setPitch(target: number): void {
  controller.applyLook(0, (controller.getPitch() - target) / S);
  expect(controller.getPitch()).toBeCloseTo(target, 9);
}

/** The rendered camera's true forward (fresh view matrix → fresh target). */
function renderedForward(): Vector3 {
  const cam = controller.getCamera();
  cam.getViewMatrix(); // forces Babylon to resync position/rotation -> target
  return cam.getTarget().subtract(cam.position).normalize();
}

/**
 * Reconstruct the eye anchor (the point the camera line passes through)
 * from the RENDERED camera alone: anchor = camPos + forward · t, where t is
 * derived from the vertical span between the camera and the known eye
 * height (exact whenever |forward.y| > 0; at level pitch the tracking
 * distance is the nominal `D` because no guard can shrink it at eyeY > 0.2).
 */
function reconstructedEye(feet: Vector3, eyeHeight: number): Vector3 {
  const cam = controller.getCamera();
  const fwd = renderedForward();
  const eyeY = feet.y + eyeHeight;
  const t = Math.abs(fwd.y) > 1e-9
    ? (eyeY - cam.position.y) / fwd.y
    : D;
  return new Vector3(
    cam.position.x + fwd.x * t,
    cam.position.y + fwd.y * t,
    cam.position.z + fwd.z * t,
  );
}

/** Assert the rendered camera passes the anchor test at the current pose. */
function expectAnchor(feet: Vector3, eyeHeight: number): void {
  const eye = reconstructedEye(feet, eyeHeight);
  expect(eye.x).toBeCloseTo(feet.x, 6);
  expect(eye.y).toBeCloseTo(feet.y + eyeHeight, 6);
  expect(eye.z).toBeCloseTo(feet.z, 6);
}

/** Level-pitch cardinal yaws 0/90/180/270 plus the wrap back to 0. */
const CARDINALS = [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0];

describe("third-person feet anchor under yaw-only turns", () => {
  it("yaw-only sweep at cardinal yaws keeps the eye anchor fixed while the camera orbits it", () => {
    const feet = new Vector3(1.5, 0, -2.5);
    controller.setCrouched(false);
    let previousCam: Vector3 | null = null;
    for (const yaw of CARDINALS) {
      setYaw(yaw);
      controller.update(feet);
      // The line still passes through the SAME anchor point.
      expectAnchor(feet, AIM_EYE_HEIGHT_STANDING);
      // The camera itself orbits: level pitch keeps the XZ orbit radius at
      // exactly the nominal tracking distance.
      const cam = controller.getCamera().position;
      const radius = Math.hypot(cam.x - feet.x, cam.z - feet.z);
      expect(radius).toBeCloseTo(D, 6);
      // ...and its position genuinely moves between cardinal yaws (the
      // camera orbits; it is not a fixed camera watching a moving body).
      if (previousCam) {
        const moved = Math.hypot(
          cam.x - previousCam.x,
          cam.z - previousCam.z,
        );
        if (Math.abs(yaw) > 1e-9) expect(moved).toBeGreaterThan(1);
      }
      previousCam = cam.clone();
    }
  });

  it("continuous 360-degree yaw sweep never drifts the anchor (feet-stationary proof)", () => {
    const feet = new Vector3(-3.25, 0, 4.75);
    const step = Math.PI / 12; // 15 degrees
    for (let i = 0; i <= 24; i++) {
      setYaw(i * step);
      controller.update(feet);
      expectAnchor(feet, AIM_EYE_HEIGHT_STANDING);
    }
  });

  it("rendered forward equals the authoritative aim direction at every cardinal yaw", () => {
    const feet = new Vector3(0, 0, 0);
    for (const yaw of CARDINALS) {
      setYaw(yaw);
      controller.update(feet);
      const dir = controller.getAimDirection();
      const fwd = renderedForward();
      expect(fwd.x).toBeCloseTo(dir.x, 6);
      expect(fwd.y).toBeCloseTo(dir.y, 6);
      expect(fwd.z).toBeCloseTo(dir.z, 6);
      // Independent ad(yaw, pitch) re-derivation at level pitch.
      expect(dir.x).toBeCloseTo(Math.sin(controller.getYaw()), 9);
      expect(dir.y).toBeCloseTo(0, 9);
      expect(dir.z).toBeCloseTo(-Math.cos(controller.getYaw()), 9);
    }
  });

  it("pitch-only sweep at fixed yaw keeps the same anchor (camera re-aims, anchor holds)", () => {
    const feet = new Vector3(2, 0, -1);
    const yaw = 0.9;
    setYaw(yaw);
    for (const pitch of [-1.0, -0.5, 0, 0.5, 1.0]) {
      setPitch(pitch);
      controller.update(feet);
      expectAnchor(feet, AIM_EYE_HEIGHT_STANDING);
      const dir = controller.getAimDirection();
      const fwd = renderedForward();
      expect(fwd.y).toBeCloseTo(dir.y, 6);
    }
  });

  it("anchor holds atop elevated feet (floor / ramp tops) under yaw sweeps", () => {
    // A floor stack top and a ramp apex height — the reported edge cases
    // where the drifting body read as "floating off the platform".
    for (const elevated of [new Vector3(2, 3.84, -1), new Vector3(-4, 7.68, 3)]) {
      for (const yaw of CARDINALS) {
        setYaw(yaw);
        controller.update(elevated);
        expectAnchor(elevated, AIM_EYE_HEIGHT_STANDING);
      }
    }
  });

  it("crouch keeps the anchor on the feet axis (discrete height switch only)", () => {
    const feet = new Vector3(0.5, 0, 0.5);
    controller.setCrouched(true);
    for (const yaw of CARDINALS) {
      setYaw(yaw);
      controller.update(feet);
      expectAnchor(feet, AIM_EYE_HEIGHT_CROUCHED);
    }
    controller.setCrouched(false);
    for (const yaw of CARDINALS) {
      setYaw(yaw);
      controller.update(feet);
      expectAnchor(feet, AIM_EYE_HEIGHT_STANDING);
    }
  });

  it("recoil and movement bob stay along-line: anchor and aim direction unchanged", () => {
    const feet = new Vector3(1, 0, 1);
    const yaw = Math.PI / 3;
    setYaw(yaw);

    controller.update(feet);
    const baselineEye = reconstructedEye(feet, AIM_EYE_HEIGHT_STANDING);
    const baselineDir = controller.getAimDirection().clone();

    controller.setRecoilKickback(0.4);
    controller.setTransientVerticalOffset(0.3);
    controller.update(feet);
    const kickedDir = controller.getAimDirection();
    expect(kickedDir.x).toBeCloseTo(baselineDir.x, 9);
    expect(kickedDir.y).toBeCloseTo(baselineDir.y, 9);
    expect(kickedDir.z).toBeCloseTo(baselineDir.z, 9);
    // The RENDERED line is unchanged: with the direction fixed, the camera
    // may only slide along it, so the baseline eye anchor still lies exactly
    // ON the new camera line ((anchor − camPos) ∥ forward).
    const cam = controller.getCamera();
    const toAnchor = baselineEye.subtract(cam.position);
    const fwd = renderedForward();
    const cross = Vector3.Cross(toAnchor, fwd);
    expect(cross.length()).toBeLessThan(1e-6);
    // And the anchor itself never left the feet axis.
    expect(baselineEye.x).toBeCloseTo(feet.x, 6);
    expect(baselineEye.z).toBeCloseTo(feet.z, 6);
  });
});
