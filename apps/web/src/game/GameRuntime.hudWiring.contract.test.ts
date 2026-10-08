/**
 * Source-wiring contract test for the cohesive in-game HUD.
 *
 * `GameRuntime.create()` needs a WebGL canvas and an async Rapier physics
 * world, so the canonical `App -> GameCanvas -> GameRuntime -> NetworkClient`
 * wiring is asserted at the source level (mirroring
 * `GameRuntime.arenaScene.integration.test.ts`). The pure mapping layer it
 * drives is unit-tested in `localHudView.test.ts` and the panels in
 * `ui/hud/GameHud.test.ts`.
 *
 * What this contract locks down:
 *  - the authoritative round-timer / countdown broadcasts are consumed on
 *    the network client and their subscriptions are removed on dispose;
 *  - the local HUD view is built (per frame) only from the runtime's
 *    EXISTING sources (prediction combat state, weapon controller, energy
 *    consumer, building system) through the pure `buildLocalHudView` mapper —
 *    no mirrored gameplay state is invented in the runtime;
 *  - the legacy DOM combat HUD (`HealthHud` / `updateCombatHudFn`) is no
 *    longer wired into the runtime;
 *  - the development debug HUD is hidden by default and only attached when
 *    explicitly enabled via the `?debug=1` / `?debug=true` URL opt-in;
 *  - `GameCanvas` renders the cohesive `GameHud` (match header + local
 *    panels) and subscribes to the runtime's local-HUD snapshots.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtime = readFileSync(new URL("./GameRuntime.ts", import.meta.url), "utf8");
const internal = readFileSync(new URL("./GameRuntimeInternal.ts", import.meta.url), "utf8");
const canvas = readFileSync(new URL("./GameCanvas.tsx", import.meta.url), "utf8");

describe("GameRuntime HUD wiring", () => {
  it("consumes the authoritative round-timer and countdown broadcasts", () => {
    expect(runtime).toContain(
      "onEvent(MATCH_ROUND_TIMER_EVENT,(p)=>this.handleRoundTimerEvent(p))",
    );
    expect(runtime).toContain(
      "onEvent(MATCH_COUNTDOWN_TICK_EVENT,(p)=>this.handleCountdownTickEvent(p))",
    );
    // The countdown seconds are derived from the tick fraction and the
    // shared game-config round countdown length.
    expect(runtime).toContain("ROUND_COUNTDOWN_SECONDS");
    const cdIdx = runtime.indexOf("handleCountdownTickEvent(payload:unknown)");
    expect(cdIdx).toBeGreaterThan(-1);
    const block = runtime.slice(cdIdx, cdIdx + 400);
    expect(block).toContain("e.countdownTicks/e.totalTicks");
  });

  it("clears the authoritative timer / countdown when the round is not in progress", () => {
    const msIdx = runtime.indexOf("handleMatchState(match:ParsedMatchState)");
    expect(msIdx).toBeGreaterThan(-1);
    const block = runtime.slice(msIdx, msIdx + 300);
    expect(block).toContain("match.matchPhase!==MatchPhase.IN_PROGRESS");
    expect(block).toContain("this.lastRoundTimer=null");
  });

  it("builds the local HUD view only from the runtime's existing sources", () => {
    // The pure mapper is the only place the flat view is produced.
    expect(runtime).toContain(
      "import{buildLocalHudView,localHudChangeKey,type LocalHudView}from\"./localHudView\"",
    );
    const idx = runtime.indexOf("getLocalHudView():LocalHudView");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 900);
    // Health / shield / ammo / elimination — prediction combat state:
    expect(block).toContain("this.predictionOrchestrator.getCombatState()");
    // Weapon type / reload — weapon controller local state:
    expect(block).toContain("this.weaponController.getLocalState()");
    // Energy — canonical energy runtime consumer (fallback to combat state):
    expect(block).toContain("this.energyConsumer.localEnergy??c.energy");
    // Build intent + preview — building system:
    expect(block).toContain("this.buildingSystem.controller");
  });

  it("emits the local HUD once per frame, change-detecting on the quantised key", () => {
    // The frame loop calls emitLocalHud() before rendering the scene.
    expect(runtime).toContain("this.emitLocalHud();this.scene.render()");
    const idx = runtime.indexOf("emitLocalHud():void");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 400);
    expect(block).toContain("localHudChangeKey(v)");
    expect(block).toContain("k===this.lastLocalHudKey");
    // Exposed to the React layer:
    expect(runtime).toContain(
      "public onLocalHudChange(listener:(view:LocalHudView)=>void):()=>void",
    );
    expect(runtime).toContain("public getCountdownSeconds():number");
  });

  it("no longer wires the legacy DOM combat HUD", () => {
    expect(runtime).not.toContain("new HealthHud()");
    expect(runtime).not.toContain("updateCombatHudFn");
    expect(runtime).not.toContain("this.combatHud");
    // The internal helper and its disposable are gone too.
    expect(internal).not.toContain("updateCombatHudFn");
    expect(internal).not.toContain("combatHud");
  });

  it("hides the development debug HUD by default and requires the explicit URL opt-in", () => {
    // The flag is resolved from the URL (default: hidden).
    expect(runtime).toContain("debugHudEnabledFromUrl()");
    // Both attach and per-frame update are gated on the flag.
    expect(runtime).toContain(
      "if(this.debugHudEnabled)this.hudCleanup=this.debugHud.attach()",
    );
    expect(runtime).toContain("if(this.debugHudEnabled)updateDebugHudFn(");
    // The attach happens exactly once, and only inside the gate.
    expect(runtime.match(/this\.hudCleanup=this\.debugHud\.attach\(\)/g)?.length).toBe(
      1,
    );
  });

  it("removes the new event subscriptions on dispose", () => {
    const idx = runtime.indexOf("dispose():void");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 1500);
    expect(block).toContain("this.unsubscribeRoundTimerEvent?.()");
    expect(block).toContain("this.unsubscribeCountdownEvent?.()");
  });
});

describe("GameCanvas HUD wiring", () => {
  it("renders the cohesive GameHud with the match header and the local view", () => {
    expect(canvas).toContain('import { GameHud } from "../ui/hud/GameHud"');
    expect(canvas).toContain("matchHudProps !== null && <GameHud match={matchHudProps} local={localHud} />");
  });

  it("subscribes to the runtime's local HUD snapshots and cleans up the subscription", () => {
    expect(canvas).toContain("r.onLocalHudChange(setLocalHud)");
    // The countdown fed to the lifecycle view comes from the runtime
    // (authoritative), not a hard-coded zero.
    expect(canvas).toContain("r.getCountdownSeconds()");
    // The subscription is released on unmount.
    expect(canvas).toContain("unsubLocalHud?.()");
  });
});
