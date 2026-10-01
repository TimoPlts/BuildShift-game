import { describe, expect, it } from "vitest";
import {
  SIMULATION_VERSION,
  integrateVerticalMovement,
  stepHorizontalMovement,
} from "./index.js";

/**
 * Smoke test for the simulation package's public export surface.
 *
 * This only verifies that existing public exports can be imported and are
 * defined. It intentionally does not exercise behavior or change runtime code.
 */
describe("simulation public exports", () => {
  it("exposes a defined, imported public export", () => {
    expect(typeof SIMULATION_VERSION).toBe("string");
    expect(typeof stepHorizontalMovement).toBe("function");
  });

  it("exposes integrateVerticalMovement as a defined function", () => {
    expect(typeof integrateVerticalMovement).toBe("function");
  });
});
