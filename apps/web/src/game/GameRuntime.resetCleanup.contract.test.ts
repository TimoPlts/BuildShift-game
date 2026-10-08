/**
 * Source-wiring contract test for round-reset / rematch / teardown cleanup.
 *
 * The overnight presentation work added several per-frame systems (combat
 * feedback, movement feedback, weapon model, audio, build edit, camera
 * recoil) on top of the pre-existing prediction / building / energy state.
 * `GameRuntime.create()` needs a WebGL canvas and an async Rapier physics
 * world, so the cleanup invariants are asserted at the source level
 * (mirroring `GameRuntime.hudWiring.contract.test.ts`).
 *
 * What this contract locks down:
 *  - the round-reset block runs ONLY from the canonical reset decision
 *    (`computeMatchReset(...).shouldReset`) — exactly one such block — and
 *    resets EVERY presentation and tracked-state system, so nothing stale
 *    (effects, weapon model, audio, build edit, remote flags, timers)
 *    survives into the next round or match;
 *  - (re)connect (join / rejoin / rematch) resets the same set AND clears
 *    the match bookkeeping, so a rejoin never replays a stale match-end;
 *  - a connection drop clears the build-edit presentation state;
 *  - teardown stops the render loop, removes the window listener, releases
 *    EVERY network subscription, disposes every owned component (including
 *    the shared NetworkClient through the disposables helper), and clears
 *    the runtime's listener arrays.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtime = readFileSync(new URL("./GameRuntime.ts", import.meta.url), "utf8");
const internal = readFileSync(new URL("./GameRuntimeInternal.ts", import.meta.url), "utf8");

/** The per-system resets a fresh round / match must perform. */
const ROUND_RESET_OPS = [
  "this.predictionOrchestrator.reset()",
  "this.inputBatcher.reset()",
  "this.remoteInterpolation.reset()",
  "this.energyConsumer.reset()",
  "this.weaponController.reset()",
  "this.cameraRecoil.reset()",
  "this.combatFeedback.reset()",
  "this.movementFeedback.reset()",
  "this.audio.reset()",
  "this.lastGrounded=true",
  'this.weaponModel.setEquippedWeapon("assault_rifle")',
  "this.remoteWasEliminated=false",
  "this.remoteHitFlashFrames=0",
  "this.lastRoundTimer=null",
  "this.countdownSeconds=0",
] as const;

/** The authoritative mirrors a fresh round / match must reset as well. */
const ROUND_RESET_AUTHORITATIVE = [
  "this.buildingSystem.reset()",
  "this.buildEditSystem.reset()",
] as const;

function shouldResetBlock(source: string): string {
  const idx = source.indexOf("if(dec.shouldReset){");
  expect(idx).toBeGreaterThan(-1);
  const end = source.indexOf("}", idx);
  return source.slice(idx, end + 1);
}

function connectBlock(source: string): string {
  const idx = source.indexOf("this.unsubscribeConnection=this.networkClient.onConnectionChange");
  expect(idx).toBeGreaterThan(-1);
  const start = source.indexOf("if(c){", idx);
  const end = source.indexOf("}else{", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 6);
}

describe("round reset / rematch cleanup", () => {
  it("runs the reset block only from the canonical reset decision", () => {
    // Exactly one reset block, and it is gated on the canonical decision
    // computed from the authoritative snapshot diff.
    expect(runtime.match(/if\(dec\.shouldReset\)\{/g)?.length).toBe(1);
    expect(runtime).toContain("const dec=computeMatchReset(this.prevMatchSnapshot,snap);");
    expect(runtime).toContain("if(dec.shouldReset){");
  });

  it("resets every presentation system on a round reset", () => {
    const block = shouldResetBlock(runtime);
    for (const op of ROUND_RESET_OPS) {
      expect(block, op).toContain(op);
    }
  });

  it("resets the authoritative building / build-edit mirrors on a round reset", () => {
    const block = shouldResetBlock(runtime);
    for (const op of ROUND_RESET_AUTHORITATIVE) {
      expect(block, op).toContain(op);
    }
  });

  it("resets the full system set AND the match bookkeeping on (re)connect", () => {
    const block = connectBlock(runtime);
    for (const op of ROUND_RESET_OPS) {
      expect(block, op).toContain(op);
    }
    // Rejoin/rematch must also clear the match-level bookkeeping, or a
    // stale match-end / snapshot would bleed into the fresh match.
    expect(block).toContain("this.matchOver=false");
    expect(block).toContain("this.prevMatchSnapshot={...INITIAL_MATCH_SNAPSHOT}");
  });

  it("clears the build-edit presentation state on a connection drop", () => {
    expect(runtime).toContain(
      "}else{this.buildEditSystem.clearOnDisconnect();}this.debugHud.state.connectionState",
    );
  });
});

describe("teardown cleanup", () => {
  const DISPOSE_OPS = [
    "window.removeEventListener(\"resize\",this.resizeEngine)",
    "this.engine.stopRenderLoop(this.renderFrame)",
    "this.unsubscribeState?.()",
    "this.unsubscribeConnection?.()",
    "this.unsubscribeHitEvent?.()",
    "this.unsubscribeEliminatedEvent?.()",
    "this.unsubscribeWeaponStateEvent?.()",
    "this.unsubscribeStructureDamageEvent?.()",
    "this.unsubscribeRoundTimerEvent?.()",
    "this.unsubscribeCountdownEvent?.()",
    "this.unsubscribeBuildPlacedEvent?.()",
    "this.unsubscribeBuildDestroyedEvent?.()",
    "this.unsubscribeRoundOverEvent?.()",
    "this.combatFeedback.dispose()",
    "this.movementFeedback.dispose()",
    "this.weaponModel.dispose()",
    "this.hudCleanup?.()",
    "this.audio.dispose()",
    "this.matchStateListeners.length=0",
    "this.localHudListeners.length=0",
  ] as const;

  it("releases every resource and subscription owned by the runtime", () => {
    const idx = runtime.indexOf("public dispose():void");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 2000);
    for (const op of DISPOSE_OPS) {
      expect(block, op).toContain(op);
    }
  });

  it("disposes every shared system through the disposables helper", () => {
    // The runtime hands its complete ownership inventory to the shared
    // helper ...
    expect(runtime).toContain(
      "disposeGameRuntimeResources({energyConsumer:this.energyConsumer,buildingSystem:this.buildingSystem,buildEditSystem:this.buildEditSystem,weaponController:this.weaponController,networkClient:this.networkClient,debugHud:this.debugHud,playerController:this.playerController,inputManager:this.inputManager,cameraController:this.cameraController,remotePresentation:this.remotePresentation})",
    );
    // ... which disposes each one, including the shared NetworkClient.
    for (const op of [
      "d.energyConsumer.dispose();",
      "d.buildingSystem.dispose();",
      "d.buildEditSystem.dispose();",
      "d.weaponController.dispose();",
      "d.networkClient.dispose();",
      "d.debugHud.dispose();",
      "d.remotePresentation?.dispose();",
      "d.playerController.dispose();",
      "d.inputManager.dispose();",
      "d.cameraController.dispose();",
    ]) {
      expect(internal, op).toContain(op);
    }
  });
});
