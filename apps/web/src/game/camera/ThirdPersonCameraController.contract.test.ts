import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contract test: the canonical ThirdPersonCameraController must map
 * positive mouse movementX (mouse right) to a yaw *decrease*, turning
 * the camera visually right, while preserving the standard vertical
 * convention (mouse up = look up, mouse down = look down).
 *
 * This mirrors the yaw convention documented in `movementInputToWorld`:
 * at yaw 0 the camera looks toward -Z and its right direction is -X,
 * so decreasing yaw rotates the forward vector toward -X (right).
 *
 * The controller cannot be instantiated in the node test environment
 * (it pulls in Babylon.js), so this test pins the dependency contract
 * by inspecting the source — the same pattern used by
 * PlayerController.contract.test.ts.
 */
describe("ThirdPersonCameraController — look direction contract", () => {
  const source = readFileSync(
    fileURLToPath(
      new URL("./ThirdPersonCameraController.ts", import.meta.url),
    ),
    "utf8",
  );

  it("mouse right (positive deltaX) decreases yaw (turns visually right)", () => {
    // The yaw update line must use subtraction: this.yaw -= deltaX * ...
    // This ensures positive movementX rotates the camera right, matching
    // the convention that camera-right at yaw 0 is world -X.
    const yawLine = source.match(/this\.yaw\s*(-|\+)=\s*deltaXPixels/);
    expect(yawLine, "yaw update line not found").not.toBeNull();
    expect(yawLine![1]).toBe("-");
  });

  it("preserves the vertical convention: mouse up looks up, mouse down looks down", () => {
    // movementY is positive when mouse moves down. The pitch update uses
    // subtraction (this.pitch -= deltaY * ...) so:
    //   mouse down (deltaY > 0) → pitch decreases → look down ✓
    //   mouse up   (deltaY < 0) → pitch increases → look up   ✓
    const pitchLine = source.match(/this\.pitch\s*(-|\+)=\s*deltaYPixels/);
    expect(pitchLine, "pitch update line not found").not.toBeNull();
    expect(pitchLine![1]).toBe("-");
  });

  it("clamps pitch to the configured min/max range", () => {
    // Pitch must be clamped every frame to prevent over-rotation.
    expect(source).toContain("THIRD_PERSON_CAMERA.minimumPitch");
    expect(source).toContain("THIRD_PERSON_CAMERA.maximumPitch");
  });

  it("normalizes yaw to [-π, π] to keep long sessions bounded", () => {
    expect(source).toContain("normalizeAngle");
  });
});
