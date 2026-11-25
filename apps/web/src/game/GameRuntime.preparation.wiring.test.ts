/**
 * Source-wiring contract test for the round-preparation client seam.
 *
 * `GameRuntime.create()` needs WebGL + Rapier, so (mirroring the other
 * GameRuntime wiring tests) the wiring is asserted at the source level, and
 * the pure pieces are unit-tested beside their modules:
 *  - `preparation/preparationContract.test.ts` (zone/clamp/grid parity with
 *    the shared CONTRACT.md contract),
 *  - `network/preparationStateParse.test.ts` (replicated signals),
 *  - `network/predictionOrchestrator.preparation.test.ts` (no-rubberband
 *    strip prediction),
 *  - `building/placementPreview.preparation.test.ts` (row-restricted ghost),
 *  - `preparation/PreparationBarrierPresentation.test.ts` (barrier bounds,
 *    cleanup, disposal, no growth).
 *
 * What this contract locks down:
 *  - preparation state is read ONLY from the canonical replicas via
 *    `syncPreparation`, called from `handleNetworkState` AFTER the match
 *    lifecycle handling (so every round reset re-arms a fresh prep);
 *  - the old all-input COUNTDOWN freeze is lifted ONLY while authoritative
 *    preparation is active; combat (fire routing, weapon actions) stays
 *    gated on `IN_PROGRESS`;
 *  - placement/edit submission opens for the WHOLE preparation phase
 *    (`buildPhaseOpen` = `IN_PROGRESS` or `COUNTDOWN`, so own-row building
 *    works while waiting for the opponent too); the row restriction comes
 *    from the shared rule handed to the building controller for every
 *    COUNTDOWN snapshot (independent of the active-countdown flag), while
 *    movement prediction and barriers stay on the active-preparation signal;
 *  - barriers open/close strictly with the preparation state and are
 *    disposed on reset/disconnect/leave paths and in `dispose()`;
 *  - the countdown tick maps through `BOX_FIGHT_PREPARATION.durationSeconds`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtime = readFileSync(new URL("./GameRuntime.ts", import.meta.url), "utf8");

describe("GameRuntime preparation wiring", () => {
  it("sources the contract + barrier component", () => {
    expect(runtime).toContain(
      'import{BOX_FIGHT_PREPARATION,type PreparationSide}from"./preparation/preparationContract"',
    );
    expect(runtime).toContain(
      'import{PreparationBarrierPresentation}from"./preparation/PreparationBarrierPresentation"',
    );
    // Zones are NEVER re-derived in the runtime: no local geometry maths.
    expect(runtime).not.toContain("PREP_ZONE");
    expect(runtime).not.toMatch(/preparationZone\s*=/);
  });

  it("lifts the frozen countdown ONLY for active preparation, keeps combat gated on IN_PROGRESS", () => {
    expect(runtime).toContain(
      "const inCd=(this.matchState.matchPhase===MatchPhase.COUNTDOWN&&!this.preparationActive)||this.predictionOrchestrator.getCombatState().isEliminated;",
    );
    // The shared fire edge reaches all owners during the placement phases
    // (IN_PROGRESS or COUNTDOWN — prep pre-builds), but the WEAPON legs of
    // the route are re-gated on IN_PROGRESS (combat blocked while prepping).
    expect(runtime).toContain(
      "const firePressedAvailable=this.inputManager.consumeFirePressed()&&this.isConnected&&(inRound||buildPhaseOpen)",
    );
    expect(runtime).toContain(
      "weaponFirePressed:routedAction.weaponFirePressed&&inRound,weaponFireHeld:routedAction.weaponFireHeld&&inRound",
    );
    expect(runtime).toContain(
      'const active=this.interactionMode.mode==="weapon"&&this.matchState.matchPhase===MatchPhase.IN_PROGRESS&&this.isConnected',
    );
  });

  it("syncs strictly from the replicated signals, after the match lifecycle handling", () => {
    const handleIdx = runtime.indexOf("private handleNetworkState(state:ParsedRoomState):void{");
    const syncIdx = runtime.indexOf("this.syncPreparation(state,sid);", handleIdx);
    const matchIdx = runtime.indexOf("this.handleMatchState(state.match);", handleIdx);
    expect(handleIdx).toBeGreaterThan(-1);
    expect(matchIdx).toBeGreaterThan(handleIdx);
    expect(syncIdx).toBeGreaterThan(matchIdx);
    // Only the canonical replica fields drive it.
    const block = runtime.slice(
      runtime.indexOf("private syncPreparation(state:ParsedRoomState,sid:string):void{"),
      runtime.indexOf("private clearPreparation():void{"),
    );
    expect(block).toContain("state.match.preparationActive===true");
    expect(block).toContain('state.players[sid]?.preparationSide??""');
    expect(block).toContain('raw==="negative"||raw==="positive"');
    // One shared assignment drives prediction; the BUILD preview gets the
    // own-row restriction for the WHOLE COUNTDOWN phase (rowSide), so the
    // ghost already refuses enemy/centre cells while the countdown is still
    // frozen waiting for the opponent.
    expect(block).toContain("this.predictionOrchestrator.setPreparationSide(assigned)");
    expect(block).toContain("this.buildingSystem.controller.setPreparationSide(rowSide)");
    expect(block).toContain("const rowSide:PreparationSide|null=state.match.matchPhase===MatchPhase.COUNTDOWN&&side!==\"\"?side as PreparationSide:null;");
    // Barriers follow the SAME authoritative signal (both sides open together).
    expect(block).toContain("if(assigned)this.prepBarriers.open(assigned);else this.prepBarriers.close();");
  });

  it("opens placement/edit submission for the whole preparation phase (row rule enforced via the shared preview + server)", () => {
    // Placement rides the phase gate, not the countdown-active flag: own-row
    // building works while the countdown waits for the second client.
    expect(runtime).toContain(
      "const buildPhaseOpen=inRound||this.matchState.matchPhase===MatchPhase.COUNTDOWN;",
    );
    expect(runtime).toContain(
      "undefined,buildPhaseOpen,route.buildPlacePressed,this.predictionOrchestrator.getCrouched());",
    );
    // Combat stays on the fight-only flag (fire routing above).
    expect(runtime).not.toContain("consumeFirePressed()&&this.isConnected&&buildPhaseOpen");
    // Edit frame: editing owned structures is allowed during the whole prep phase too.
    const editIdx = runtime.indexOf("private updateBuildEditFrame(route:PrimaryActionRoute):void{");
    expect(
      runtime.slice(editIdx, editIdx + 700).includes(
        "const inRound=this.matchState.matchPhase===MatchPhase.IN_PROGRESS||this.matchState.matchPhase===MatchPhase.COUNTDOWN;",
      ),
    ).toBe(true);
  });

  it("clears preparation + barriers on every reset / disconnect / leave path and disposes the component", () => {
    const clearIdx = runtime.indexOf("private clearPreparation():void{");
    expect(clearIdx).toBeGreaterThan(-1);
    // Round/match lifecycle reset inside handleMatchState.
    const matchFn = runtime.slice(
      runtime.indexOf("private handleMatchState(match:ParsedMatchState):void{"),
      clearIdx,
    );
    expect(matchFn).toContain("this.localSimActive=false;this.clearPreparation();");
    // Reconnect AND disconnect branches of the connection listener.
    expect(runtime).toContain("this.localSimActive=false;this.clearPreparation();}else{");
    expect(runtime).toContain(
      "this.buildStructureRenderer.setLocalSessionId(null);this.clearPreparation();}",
    );
    // dispose() tears the barrier component down with the rest of the scene.
    expect(runtime).toContain(
      "this.combatFeedback.dispose();this.prepBarriers.dispose();",
    );
  });

  it("republishes match state AFTER preparation sync so listeners never see stale prep flags", () => {
    // One emission per replicated snapshot, ordered AFTER the lifecycle
    // reset handling AND the preparation sync — so waiting→preparing and
    // prep pause/resume toggles inside COUNTDOWN (no phase / score change)
    // always reach the React layer with the CURRENT flags of that snapshot.
    const handleIdx = runtime.indexOf(
      "private handleNetworkState(state:ParsedRoomState):void{",
    );
    const handleEnd = runtime.indexOf("private handleMatchState", handleIdx);
    const matchIdx = runtime.indexOf("this.handleMatchState(state.match);", handleIdx);
    const syncIdx = runtime.indexOf("this.syncPreparation(state,sid);", handleIdx);
    const emitIdx = runtime.indexOf("this.emitMatchState();", handleIdx);
    expect(handleIdx).toBeGreaterThan(-1);
    expect(matchIdx).toBeGreaterThan(handleIdx);
    expect(syncIdx).toBeGreaterThan(matchIdx);
    expect(emitIdx).toBeGreaterThan(syncIdx);
    expect(emitIdx).toBeLessThan(handleEnd);
    // handleMatchState itself no longer publishes inline (the reset path's
    // clearPreparation therefore happens BEFORE any emission).
    const matchFn = runtime.slice(
      runtime.indexOf("private handleMatchState(match:ParsedMatchState):void{"),
      runtime.indexOf("private syncPreparation", handleEnd),
    );
    expect(matchFn).toContain("this.clearPreparation();");
    expect(matchFn).not.toContain("matchStateListeners");
    // The single republish seam iterates the listeners with the fresh state.
    const emitFnIdx = runtime.indexOf("private emitMatchState():void{");
    expect(emitFnIdx).toBeGreaterThan(-1);
    expect(
      runtime.slice(emitFnIdx, emitFnIdx + 160),
    ).toContain("for(const l of this.matchStateListeners){l(this.matchState);}");
    // Narrow read seam for the lifecycle view (current side, no mirrored
    // flag in the React layer).
    expect(runtime).toContain(
      "public getPreparationSide():string{return this.preparationSide;}",
    );
  });

  it("maps the countdown ticks through the shared preparation duration", () => {
    expect(runtime).toContain(
      "Math.ceil((e.countdownTicks/e.totalTicks)*BOX_FIGHT_PREPARATION.durationSeconds)",
    );
    // The legacy fixed 3 s countdown constant is no longer consulted.
    expect(runtime).not.toContain("ROUND_COUNTDOWN_SECONDS");
  });

  it("calls the shipped local view offset directly (guarded runtime hook replaced)", () => {
    expect(runtime).toContain(
      "private applyLocalViewOffset():void{this.playerController.presentation.setLocalViewOffset(THIRD_PERSON_CAMERA.localViewOffsetX,THIRD_PERSON_CAMERA.localViewOffsetZ);}",
    );
    expect(runtime).not.toContain('typeof p.setLocalViewOffset==="function"');
  });
});
