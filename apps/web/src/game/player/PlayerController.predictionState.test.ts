import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Stage 2C2B-2 contract: {@link PlayerController} must expose the prediction
 * state capture/restore API the {@link ReconciliationEngine} drives.
 *
 * The controller cannot be instantiated in the node test environment (it pulls
 * in a Babylon `Scene` + Rapier WASM in its constructor), so — consistent with
 * the Stage 2C2A contract test — this pins the glue by inspecting the source:
 * the exact state fields each method wires, and the authoritative override's
 * narrow (position + yaw only) behaviour.
 */
const source = readFileSync(
  fileURLToPath(new URL("./PlayerController.ts", import.meta.url)),
  "utf8",
);

function methodBody(name: string): string {
  const start = source.indexOf(`${name}(`);
  expect(start, `method ${name} must be present`).toBeGreaterThanOrEqual(0);
  // Phase 1: from the parameter-list '(', skip to the matching ')' (its
  //    parens may contain nested generic braces like `Readonly<{ ... }>`).
  let i = start + name.length; // index of the parameter-list '('
  let parenDepth = 0;
  let afterParams = -1;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") {
      parenDepth += 1;
    } else if (ch === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        afterParams = i; // closing ')' of the parameter list
        break;
      }
    }
  }
  expect(afterParams, `parameter list close for ${name}`).toBeGreaterThanOrEqual(0);
  // Phase 2: the body's opening '{' is the first '{' after the parameter list
  //    (may be the very next char for a body, or after a return-type annotation).
  let bodyOpen = -1;
  for (let j = afterParams + 1; j < source.length; j += 1) {
    if (source[j] === "{") {
      bodyOpen = j;
      break;
    }
  }
  expect(bodyOpen, `body opener for ${name}`).toBeGreaterThanOrEqual(0);
  // Phase 3: brace-match from the body opener to its closing brace.
  let depth = 0;
  for (let k = bodyOpen; k < source.length; k += 1) {
    const ch = source[k];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyOpen, k + 1);
      }
    }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

describe("PlayerController — capturePredictionState", () => {
  it("exists and returns a PredictionState-shaped object with all five fields", () => {
    const body = methodBody("capturePredictionState");
    expect(body).toContain("position: { x: center.x, y: center.y, z: center.z }");
    expect(body).toContain("verticalVelocity: this.verticalVelocity");
    expect(body).toContain("lastGrounded: this.lastGrounded");
    expect(body).toContain("jump: this.jumpController.captureState()");
    // The presentation root's Y rotation is the NEGATED yaw (Babylon's node
    // Y-rotation turns local -Z toward -X, while the shared movement
    // convention turns forward toward +X); the prediction state stores the
    // shared-movement yaw, so capture negates the mesh rotation.
    expect(body).toContain("facingYaw: -this.mesh.rotation.y");
    // It reads the capsule centre from the physics authority, not the mesh.
    expect(body).toContain("this.physics.getPosition()");
  });
});

describe("PlayerController — restorePredictionState", () => {
  it("restores physics position, vy, grounded, jump, and presentation transform", () => {
    const body = methodBody("restorePredictionState");
    expect(body).toContain("this.physics.setPosition(state.position)");
    expect(body).toContain("this.verticalVelocity = state.verticalVelocity");
    expect(body).toContain("this.lastGrounded = state.lastGrounded");
    expect(body).toContain("this.jumpController.restoreState(state.jump)");
    expect(body).toContain("this.presentation.setTransform(state.position, state.facingYaw)");
  });
});

describe("PlayerController — setAuthoritativePosition (narrow override)", () => {
  it("updates ONLY physics position and presentation transform", () => {
    const body = methodBody("setAuthoritativePosition");
    expect(body).toContain("this.physics.setPosition(position)");
    expect(body).toContain("this.presentation.setTransform(position, yaw)");
  });

  it("does NOT touch verticalVelocity, lastGrounded, or JumpController timing", () => {
    const body = methodBody("setAuthoritativePosition");
    expect(body).not.toContain("this.verticalVelocity");
    expect(body).not.toContain("this.lastGrounded");
    expect(body).not.toContain("this.jumpController");
  });
});

describe("PlayerController — JumpController wiring", () => {
  it("wires the shared JumpController through captureState/restoreState", () => {
    // The controller owns a JumpController and the state APIs route through it.
    expect(source).toContain("private readonly jumpController: JumpController");
    const capture = methodBody("capturePredictionState");
    const restore = methodBody("restorePredictionState");
    expect(capture).toContain("this.jumpController.captureState()");
    expect(restore).toContain("this.jumpController.restoreState(state.jump)");
  });
});
