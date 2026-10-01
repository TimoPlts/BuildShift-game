import { describe, expect, it } from "vitest";
import { SIMULATION_VERSION, stepHorizontalMovement } from "./index.js";

/**
 * Smoke test for the simulation package's public export surface.
 *
 * This only verifies that an existing public export can be imported and is
 * defined. It intentionally does not exercise behavior or change runtime code.
 */
describe("simulation public exports", () => {
  it("exposes a defined, imported public export", () => {
    expect(typeof SIMULATION_VERSION).toBe("string");
    expect(typeof stepHorizontalMovement).toBe("function");
  });
});
