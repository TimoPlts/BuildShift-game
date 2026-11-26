/**
 * Source-wiring contract for held-fire shot presentation (autofire tracers).
 *
 * GameRuntime cannot be instantiated in the web vitest environment (WebGL
 * canvas + async Rapier), so — mirroring the other GameRuntime wiring
 * contracts — this test pins the SUSTAINED FIRE LOOP itself at the source
 * level: the per-simulation-tick path that must present every locally
 * accepted round while the primary button is held, not just a manually
 * invoked tracer.
 *
 * Locked invariants:
 *  - the fire presentation is evaluated once per simulation tick from the
 *    ROUTED held leg (`frameRoute.weaponFireHeld`), i.e. the same signal the
 *    authoritative `primaryFire` intent uses — independent of click edges;
 *  - the gate consumes that tick's input sequence and the EQUIPPED weapon's
 *    `fireIntervalTicks` (server-parity cadence, frame-rate independent), the
 *    pre-prediction local ammo, and the reload / eliminated reject states;
 *  - the same tick still drives `predictionOrchestrator.predictFire` (HUD
 *    ammo prediction unchanged) and the input batcher still ships the intent
 *    exactly once — no second network fire path was introduced;
 *  - muzzle + tracer + recoil + audio all live behind the single
 *    `presentLocalAcceptedShot` call site.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtime = readFileSync(new URL("./GameRuntime.ts", import.meta.url), "utf8");

function tickBody(): string {
  const start = runtime.indexOf("private stepSimulationTick():void{");
  expect(start).toBeGreaterThan(-1);
  const end = runtime.indexOf("private handleNetworkState", start);
  expect(end).toBeGreaterThan(start);
  return runtime.slice(start, end);
}

describe("GameRuntime held-fire tracer wiring", () => {
  it("evaluates the presentation gate on every simulation tick inside the sustained loop", () => {
    const tick = tickBody();
    // The held leg is read once per tick from the routed frame (same frame's
    // decision the server intent uses), never a re-pressed click edge.
    expect(tick).toContain("const fi=this.frameRoute.weaponFireHeld;");
    const gateIdx = tick.indexOf("this.heldFireGate.allows({fireHeld:fi,sequence:seq,");
    expect(gateIdx).toBeGreaterThan(-1);
    // Per-weapon tick cadence (server `wcfg` parity), pre-prediction ammo,
    // and the reload / eliminated rejection states.
    expect(tick).toContain(
      'fireIntervalTicks:this.weaponController.activeWeapon==="shotgun"?SHOTGUN.fireIntervalTicks:ASSAULT_RIFLE.fireIntervalTicks',
    );
    expect(tick).toContain("ammo:ammoBeforeFire");
    expect(tick).toContain("reloading:this.weaponController.isReloading");
    expect(tick).toContain("eliminated:this.predictionOrchestrator.isEliminated");
    // Accepted -> the single presentation sink; rejected -> nothing.
    expect(tick).toContain("}))this.presentLocalAcceptedShot();");
  });

  it("keeps the existing tick prediction and single shipped intent intact (no duplicate fire path)", () => {
    const tick = tickBody();
    // Ammo/cooldown prediction for the HUD still runs exactly once...
    expect(tick.match(/predictFire\(/g)?.length).toBe(1);
    // ...the ammo snapshot for the gate is taken BEFORE the prediction
    // decrements, so the first round of a near-empty magazine is not
    // silenced by the local optimistic decrement.
    expect(tick.indexOf("const ammoBeforeFire=this.predictionOrchestrator.localAmmo;")).toBeLessThan(
      tick.indexOf("this.predictionOrchestrator.predictFire(seq,fi);"),
    );
    // The authoritative intent is still shipped once, through the batcher.
    expect(tick).toContain("this.inputBatcher.send(sample,this.networkClient,");
    expect(tick.match(/inputBatcher\.send\(/g)?.length).toBe(1);
    // No new network fire/weapon message was introduced on the tick.
    expect(tick).not.toMatch(/networkClient\.sendWeaponFire|sendFire/);
  });

  it("routes muzzle, tracer, recoil and audio through exactly one presentation sink", () => {
    const start = runtime.indexOf("private presentLocalAcceptedShot():void{");
    expect(start).toBeGreaterThan(-1);
    const sink = runtime.slice(start, runtime.indexOf("/**", start + 10) === -1 ? start + 900 : runtime.indexOf("/**", start + 10));
    expect(sink).toContain("const wt=this.weaponController.activeWeapon;");
    expect(sink).toContain("this.weaponModel.getMuzzlePosition(this._muzzlePos)");
    expect(sink).toContain("this.combatFeedback.playShot(wt,");
    expect(sink).toContain("this.cameraRecoil.kick(wt)");
    expect(sink).toContain("this.audio.playFire(wt)");
    // Only ever called from the sim-tick gate — one feedback source per round.
    expect((runtime.match(/presentLocalAcceptedShot\(\)/g) ?? []).length).toBe(2); // decl + call
  });

  it("presents on the tick after release handling: held leg goes false with no feedback and disposal still tears the feedback layer down", () => {
    // Release / mode switch routes fireHeld false (primaryActionRouting owns
    // it) — the gate rejects before advancing cadence (unit-tested in
    // combat/heldFirePresentation.test.ts). Here: dispose still disposes the
    // combat feedback (active tracers included) and stops the render loop.
    expect(runtime).toContain("this.combatFeedback.dispose()");
    expect(runtime).toContain("this.engine.stopRenderLoop(this.renderFrame)");
  });
});
