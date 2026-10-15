/**
 * Source-wiring contract test: the three primary-action consumers (weapon,
 * building, build-edit) must all read the SAME per-frame
 * {@link routePrimaryAction} decision over the centralized `InputManager`
 * fire state — one listener, one routing decision, no per-consumer mouse
 * state.
 *
 * Centralized mode ownership (overhaul task 12):
 *
 *  - the build/edit layer flags live in ONE shared
 *    `InteractionModeCoordinator`; the route reads the coordinator's
 *    effective modes (`isBuildActive` / `isEditActive`), so build and edit
 *    can never both own the primary;
 *  - the fire edge is consumed EVERY frame (the latch can never survive a
 *    phase/mode transition) and gated on connected + `IN_PROGRESS` — the
 *    "hold fire through the countdown" behaviour is preserved because the
 *    HELD state is always read (the mouse button state persists in the
 *    `InputManager`), only stale edges are dropped;
 *  - `handleWeaponInput` runs unconditionally each frame so the weapon
 *    slot/reload latches are drained no matter the phase, while the actions
 *    themselves are gated on effective weapon mode + `IN_PROGRESS` +
 *    connected + not eliminated (matching the server's authority gates);
 *  - the building frame receives the routed `buildPlaceHeld` **and**
 *    `buildPlacePressed` plus the `inRound` gate, so placement intents are
 *    only submitted while the server can accept them;
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
    // The route is computed once per frame at render-frame scope (before the
    // connected/disconnected branches). The layer flags come from the shared
    // interaction-mode coordinator (single owner of build/edit state), the
    // fire edge is consumed unconditionally (no stale edge can survive) and
    // both the edge and the held read are gated on connected + IN_PROGRESS.
    expect(runtime).toContain(
      "const inRound=this.matchState.matchPhase===MatchPhase.IN_PROGRESS;const route=routePrimaryAction(this.interactionMode.isBuildActive(),this.interactionMode.isEditActive(),this.inputManager.consumeFirePressed()&&this.isConnected&&inRound,this.inputManager.isFiring()&&this.isConnected&&inRound);this.frameRoute=route;this.handleWeaponInput(route);",
    );
  });

  it("drains the weapon latches every frame and gates the actions on weapon mode + IN_PROGRESS", () => {
    // `handleWeaponInput` runs unconditionally each frame (the slot/reload
    // latches are drained in every phase, so nothing stale can fire on a
    // phase change) ...
    expect(runtime).toContain("private handleWeaponInput(route:PrimaryActionRoute):void");
    // ... while every weapon action is gated on the coordinator's effective
    // weapon mode, an active round, a live connection, and not being
    // eliminated (mirrors the server's IN_PROGRESS authority gates).
    expect(runtime).toContain(
      'const active=this.interactionMode.mode==="weapon"&&this.matchState.matchPhase===MatchPhase.IN_PROGRESS&&this.isConnected&&!this.predictionOrchestrator.getCombatState().isEliminated',
    );
    // The fired shot uses the routed press edge under the same gate.
    expect(runtime).toContain("if(route.weaponFirePressed&&active){");
  });

  it("routes the held AND pressed primary into the building frame with the in-round gate", () => {
    // Building frame: routed build-owned hold (turbo building) + press edge,
    // plus the `inRound` flag so placement intents are only submitted while
    // the server can accept them (the server rejects placement outside
    // IN_PROGRESS).
    expect(runtime).toContain(
      "updateBuildingFrame(this.buildingSystem,this.cameraController.getCamera(),this.currentAimDirection,this.buildFeetInto(this._feetPos),this.isConnected,route.buildPlaceHeld,undefined,inRound,route.buildPlacePressed);",
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

  it("suppresses weapon slot switches outside weapon mode (no duplicate commands)", () => {
    // Outside weapon mode the number keys 1–2 are owned by another layer
    // (build piece selection) or have no meaning (edit). The runtime
    // consumes the slot latch every frame (drained, never stale) but only
    // acts under the weapon-mode + IN_PROGRESS gate.
    expect(runtime).toContain(
      "if(this.inputManager.consumeWeaponSlot1Pressed()&&active)",
    );
    expect(runtime).toContain(
      "if(this.inputManager.consumeWeaponSlot2Pressed()&&active)",
    );
    expect(runtime).toContain(
      "if(this.inputManager.consumeReloadPressed()&&active)",
    );
  });
});
