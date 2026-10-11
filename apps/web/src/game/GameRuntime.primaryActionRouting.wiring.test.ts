/**
 * Source-wiring contract test: the three primary-action consumers (weapon,
 * building, build-edit) must all read the SAME per-frame
 * {@link routePrimaryAction} decision over the centralized `InputManager`
 * fire state — one listener, one routing decision, no per-consumer mouse
 * state.
 *
 *  - the route is computed ONCE per render frame (before the connected /
 *    disconnected branches), with the fire edge only *consumed* when the
 *    player is connected and in an active round (the `IN_PROGRESS` gate —
 *    the "hold fire through the countdown" behaviour is preserved because
 *    the held state is always read, only the edge is dropped);
 *  - the weapon fires from the routed `weaponFirePressed` /
 *    `weaponFireHeld` (the held read persists into the fixed sim tick via
 *    the `frameRoute` field);
 *  - the building frame receives the routed `buildPlaceHeld` (turbo
 *    building) from the same decision;
 *  - the build-edit frame receives the routed `editSelectPressed` /
 *    `editSelectHeld`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtime = readFileSync(new URL("./GameRuntime.ts", import.meta.url), "utf8");

describe("GameRuntime primary-action routing", () => {
  it("computes one per-frame route from the centralized InputManager fire state", () => {
    expect(runtime).toContain(
      'import{routePrimaryAction,type PrimaryActionRoute}from"./input/primaryActionRouting"',
    );
    // The route is computed once per frame, at render-frame scope (before the
    // connected/disconnected branches), with the fire edge gated on
    // connected + IN_PROGRESS.
    expect(runtime).toContain(
      "const inRound=this.matchState.matchPhase===MatchPhase.IN_PROGRESS;const route=routePrimaryAction(this.buildingSystem.controller.isBuildModeActive(),this.buildEditSystem.controller.getMode(),this.isConnected&&inRound?this.inputManager.consumeFirePressed():false,this.inputManager.isFiring());this.frameRoute=route;",
    );
  });

  it("fires the weapon from the routed decision (gated out of the countdown)", () => {
    // The weapon consumer takes the route; firing is gated out of the
    // countdown phase (rounds + intermissions fire freely).
    expect(runtime).toContain(
      "if(this.matchState.matchPhase!==MatchPhase.COUNTDOWN)this.handleWeaponInput(route);",
    );
    expect(runtime).toContain("private handleWeaponInput(route:PrimaryActionRoute):void");
    // The fired shot uses the routed press edge.
    expect(runtime).toContain("if(route.weaponFirePressed){");
  });

  it("routes the held primary into the building frame and the sim tick through the same route", () => {
    // Building frame: routed build-owned hold (turbo building).
    expect(runtime).toContain(
      "updateBuildingFrame(this.buildingSystem,this.cameraController.getCamera(),this.currentAimDirection,this.playerController.getFeetPositionInto(this._feetPos),this.isConnected,route.buildPlaceHeld);",
    );
    // The fixed sim tick reads the held fire through the stored frame route
    // (same frame's decision — no re-reading of raw input).
    expect(runtime).toContain(
      "const fi=this.frameRoute.weaponFireHeld;",
    );
  });

  it("routes the edit select into the build-edit frame through the same route", () => {
    expect(runtime).toContain("this.updateBuildEditFrame(route);");
    expect(runtime).toContain(
      "editSelectPressed:route.editSelectPressed,editSelectHeld:route.editSelectHeld",
    );
  });

  it("suppresses weapon slot switches while build mode is active (no duplicate commands)", () => {
    // When build mode is on, number keys 1–2 are owned by the building system
    // (piece selection). The runtime must NOT also send a weapon switch for
    // the same key press. The gate reads the canonical build-mode state and
    // discards the weapon slot latch without acting.
    expect(runtime).toContain(
      "const inBuild=this.buildingSystem.controller.isBuildModeActive()",
    );
    expect(runtime).toContain(
      "if(wsi&&!inBuild)",
    );
    expect(runtime).toContain(
      "if(wsi2&&!inBuild)",
    );
  });
});
