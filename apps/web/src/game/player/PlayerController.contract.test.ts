import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Stage 2C2A contract: {@link PlayerController} must simulate from *explicit*
 * simulation input only, never by reading live browser state. That is what
 * makes historical replay possible — replay feeds recorded inputs, not the
 * current keyboard.
 *
 * The controller cannot be instantiated in the node test environment (it pulls
 * in Babylon + Rapier WASM), so this test pins the dependency contract by
 * inspecting the source: no `InputManager` import, and no calls into the
 * browser input layer.
 */
describe("PlayerController — explicit-input contract", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./PlayerController.ts", import.meta.url)),
    "utf8",
  );

  it("does not import InputManager", () => {
    expect(source).not.toMatch(/from\s+["'].*InputManager["']/);
  });

  it("does not read movement or poll the jump edge from the browser", () => {
    expect(source).not.toContain("getMovementInput");
    expect(source).not.toContain("pollJumpPressed");
  });

  it("drives simulation from the explicit substep input", () => {
    expect(source).toContain("simulationInput");
    // The jump edge is consumed from the explicit input, not the browser.
    expect(source).toContain("jumpPressed");
  });
});
