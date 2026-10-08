/**
 * Source-wiring contract test for the movement presentation integration.
 *
 * `GameRuntime.create()` needs a WebGL canvas and an async Rapier physics
 * world, so the canonical wiring is asserted at the source level (mirroring
 * `GameRuntime.combatPresentation.wiring.test.ts`). The presentation modules
 * are unit-tested in `scene/movement/movementFeedbackModel.test.ts` and
 * `scene/movementFeedback.test.ts`; the camera hook in
 * `camera/ThirdPersonCameraController.movementOffset.test.ts`.
 *
 * What this contract locks down:
 *  - movement feedback is driven EXCLUSIVELY from the existing predicted
 *    movement state (position, grounded, vertical velocity) on the
 *    simulation-tick path — no new input, physics, or prediction hooks;
 *  - the transient VERTICAL camera offset (a translation, not a rotation)
 *    is driven every render frame from the modular model and applied before
 *    the camera update, so aiming accuracy is never disturbed;
 *  - round reset / reconnect clears the presentation state;
 *  - teardown disposes the component.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtime = readFileSync(new URL("./GameRuntime.ts", import.meta.url), "utf8");

describe("GameRuntime movement presentation wiring", () => {
  it("owns the modular MovementFeedback component", () => {
    expect(runtime).toContain('import{MovementFeedback}from"./scene/MovementFeedback"');
    expect(runtime).toContain("private readonly movementFeedback:MovementFeedback;");
    expect(runtime).toContain("this.movementFeedback=new MovementFeedback(scene);");
  });

  it("drives the feedback from the existing predicted movement state only", () => {
    const idx = runtime.indexOf("private stepSimulationTick():void{");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 1200);
    // The step call consumes the predicted sample the runtime already
    // computes (no new input/physics/prediction source).
    expect(block).toContain(
      "this.movementFeedback.step(this._movSample)",
    );
  });

  it("applies the transient vertical camera offset each frame before the camera update", () => {
    const setIdx = runtime.indexOf(
      "this.cameraController.setTransientVerticalOffset(this.movementFeedback.updateCameraMotion(dt))",
    );
    const updateIdx = runtime.indexOf(
      "this.cameraController.update(this.playerController.getFeetPosition())",
    );
    expect(setIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(setIdx);
    // The movement offset is a translation hook, distinct from the combat
    // pitch nudge — both may be present, but aiming is never rotated by the
    // movement feedback.
    expect(runtime).toContain("this.cameraController.setPitchOffset(this.cameraRecoil.update(dt))");
  });

  it("resets the presentation on (re)connect and on match reset", () => {
    const resets = runtime.match(/this\.movementFeedback\.reset\(\)/g) ?? [];
    expect(resets.length).toBeGreaterThanOrEqual(2);
  });

  it("disposes the component on teardown", () => {
    expect(runtime).toContain("this.movementFeedback.dispose()");
  });
});
