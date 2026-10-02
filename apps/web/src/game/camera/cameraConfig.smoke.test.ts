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
      THIRD_PERSON_CAMERA.mouseSensitivity,
      THIRD_PERSON_CAMERA.minimumPitch,
      THIRD_PERSON_CAMERA.maximumPitch,
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
});
