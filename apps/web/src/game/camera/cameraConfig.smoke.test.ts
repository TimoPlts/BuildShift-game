import { describe, expect, it } from "vitest";

import { THIRD_PERSON_CAMERA } from "./cameraConfig";

/**
 * Smoke test: the presentation-only third-person camera config module resolves
 * and exports a well-formed, finite constant object. This guards against the
 * `@buildshift/web` game config accidentally breaking its shape; it does not
 * exercise any runtime/rendering behavior.
 */
describe("THIRD_PERSON_CAMERA (config smoke test)", () => {
  it("exports a finite numeric tuning object", () => {
    expect(THIRD_PERSON_CAMERA).toBeTypeOf("object");

    for (const value of [
      THIRD_PERSON_CAMERA.distance,
      THIRD_PERSON_CAMERA.recoilKickbackMetersPerRadian,
      THIRD_PERSON_CAMERA.localViewOffsetX,
      THIRD_PERSON_CAMERA.localViewOffsetZ,
      THIRD_PERSON_CAMERA.fieldOfView,
      THIRD_PERSON_CAMERA.buildModeFieldOfViewDelta,
      THIRD_PERSON_CAMERA.mouseSensitivity,
      THIRD_PERSON_CAMERA.minimumPitch,
      THIRD_PERSON_CAMERA.maximumPitch,
      THIRD_PERSON_CAMERA.minimumCameraHeight,
      THIRD_PERSON_CAMERA.minimumCameraDistance,
      THIRD_PERSON_CAMERA.buildObstructionGap,
      THIRD_PERSON_CAMERA.obstructionSelfMargin,
      THIRD_PERSON_CAMERA.obstructionRecoveryMetersPerSecond,
    ]) {
      expect(value).toBeTypeOf("number");
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("has a valid pitch range (minimum below maximum)", () => {
    expect(THIRD_PERSON_CAMERA.minimumPitch).toBeLessThan(
      THIRD_PERSON_CAMERA.maximumPitch,
    );
  });

  it("has presentation-sane feel bounds", () => {
    // FOV must be a proper wedge (0 < fov < π) and the build-mode delta must
    // only ever widen it.
    expect(THIRD_PERSON_CAMERA.fieldOfView).toBeGreaterThan(0);
    expect(THIRD_PERSON_CAMERA.fieldOfView).toBeLessThan(Math.PI);
    expect(THIRD_PERSON_CAMERA.buildModeFieldOfViewDelta).toBeGreaterThanOrEqual(0);
    // The closest along-line dolly must stay inside the tracking distance so
    // the floor/structure guards always have room to converge the camera
    // toward the eye WITHOUT leaving the shot line.
    expect(THIRD_PERSON_CAMERA.minimumCameraDistance).toBeGreaterThan(0);
    expect(THIRD_PERSON_CAMERA.minimumCameraDistance).toBeLessThan(
      THIRD_PERSON_CAMERA.distance,
    );
    expect(THIRD_PERSON_CAMERA.minimumCameraHeight).toBeGreaterThanOrEqual(0);
    // Obstruction stability (build-feel-20261123): the self-surface margin
    // is a small surface-contact tolerance, and recovery is a finite,
    // positive glide speed (instant would be the sudden-zoom regression,
    // zero would strand the camera dolled in).
    expect(THIRD_PERSON_CAMERA.obstructionSelfMargin).toBeGreaterThan(0);
    expect(THIRD_PERSON_CAMERA.obstructionSelfMargin).toBeLessThan(0.5);
    expect(THIRD_PERSON_CAMERA.obstructionRecoveryMetersPerSecond).toBeGreaterThan(0);
    expect(THIRD_PERSON_CAMERA.obstructionRecoveryMetersPerSecond).toBeLessThan(20);
  });

  it("keeps the floor guard satisfiable at max pitch for both eye heights", () => {
    // The floor guard dollies IN along the line; it is satisfiable iff the
    // allowed distance stays at or above minimumCameraDistance at the
    // steepest upward look for the LOWEST eye pivot (crouched eye).
    const eyeCrouched = 0.55; // PLAYER_CROUCH_COLLIDER_HALF_TOTAL_HEIGHT scale
    const maxT =
      (eyeCrouched - THIRD_PERSON_CAMERA.minimumCameraHeight) /
      Math.sin(THIRD_PERSON_CAMERA.maximumPitch);
    expect(maxT).toBeGreaterThanOrEqual(THIRD_PERSON_CAMERA.minimumCameraDistance);
  });
});
