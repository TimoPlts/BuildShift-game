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
      THIRD_PERSON_CAMERA.targetHeight,
      THIRD_PERSON_CAMERA.shoulderOffset,
      THIRD_PERSON_CAMERA.fieldOfView,
      THIRD_PERSON_CAMERA.buildModeFieldOfViewDelta,
      THIRD_PERSON_CAMERA.mouseSensitivity,
      THIRD_PERSON_CAMERA.minimumPitch,
      THIRD_PERSON_CAMERA.maximumPitch,
      THIRD_PERSON_CAMERA.minimumCameraHeight,
      THIRD_PERSON_CAMERA.minimumCameraDistance,
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
    expect(THIRD_PERSON_CAMERA.shoulderOffset).toBeGreaterThanOrEqual(0);
    // The ground dolly needs headroom: the floor must be below the look
    // point, and the closest dolly distance must be inside the tracking
    // distance so the camera can never tunnel through the player.
    expect(THIRD_PERSON_CAMERA.minimumCameraHeight).toBeGreaterThan(0);
    expect(THIRD_PERSON_CAMERA.minimumCameraHeight).toBeLessThan(
      THIRD_PERSON_CAMERA.targetHeight,
    );
    expect(THIRD_PERSON_CAMERA.minimumCameraDistance).toBeGreaterThan(0);
    expect(THIRD_PERSON_CAMERA.minimumCameraDistance).toBeLessThan(
      THIRD_PERSON_CAMERA.distance,
    );
  });
});
