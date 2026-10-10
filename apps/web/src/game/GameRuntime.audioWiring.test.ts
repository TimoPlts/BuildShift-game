/**
 * Source-wiring contract test for the client audio integration.
 *
 * `GameRuntime.create()` needs a WebGL canvas and an async Rapier physics
 * world, so the canonical wiring is asserted at the source level (mirroring
 * `GameRuntime.combatPresentation.wiring.test.ts` and
 * `GameRuntime.movementPresentation.wiring.test.ts`).
 *
 * What this contract locks down:
 *  - the audio component is instantiated and owned by the runtime;
 *  - AR/shotgun fire triggers the audio playFire call;
 *  - the authoritative hit event triggers playHitConfirm only for the local session;
 *  - build placement/destroy events trigger the respective audio calls;
 *  - round over triggers win/loss jingle based on local session;
 *  - jump/land transitions trigger the movement audio;
 *  - countdown tick triggers the tick sound;
 *  - audio is reset on reconnect and match reset;
 *  - audio is disposed on teardown and subscriptions are cleaned up.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtime = readFileSync(new URL("./GameRuntime.ts", import.meta.url), "utf8");

describe("GameRuntime audio wiring", () => {
  it("imports and owns the ClientAudio component", () => {
    expect(runtime).toContain('import{ClientAudio}from"./audio"');
    expect(runtime).toContain("private readonly audio:ClientAudio;");
    expect(runtime).toContain("this.audio=new ClientAudio();");
  });

  it("plays fire audio on an accepted local shot", () => {
    // The fire path calls audio.playFire with the weapon type.
    expect(runtime).toContain("this.audio.playFire(r.request.weaponType)");
    // It is on the same path as the existing combat feedback and recoil.
    const fireIdx = runtime.indexOf("this.audio.playFire(r.request.weaponType)");
    const playShotIdx = runtime.indexOf("this.combatFeedback.playShot");
    expect(fireIdx).toBeGreaterThan(-1);
    expect(playShotIdx).toBeGreaterThan(-1);
    expect(fireIdx).toBeGreaterThan(playShotIdx);
  });

  it("plays hit-confirm audio only for an authoritative hit by the local session", () => {
    const idx = runtime.indexOf("onEvent(COMBAT_HIT_EVENT");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 500);
    // Gated on the local session being the shooter.
    expect(block).toContain("e.shooterId===sid");
    expect(block).toContain("this.audio.playHitConfirm()");
  });

  it("subscribes to build:structure_placed and plays the place sound", () => {
    expect(runtime).toContain("BUILD_EVENTS.STRUCTURE_PLACED");
    const idx = runtime.indexOf("BUILD_EVENTS.STRUCTURE_PLACED");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 200);
    expect(block).toContain("this.audio.playBuildPlace()");
  });

  it("subscribes to structure_destroyed and plays the destroy sound", () => {
    const idx = runtime.indexOf("ENERGY_EVENTS.STRUCTURE_DESTROYED");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 200);
    expect(block).toContain("this.audio.playBuildDestroy()");
  });

  it("plays round win/loss jingle on match:round_over based on local session", () => {
    expect(runtime).toContain("MATCH_ROUND_OVER_EVENT");
    const idx = runtime.indexOf("onEvent(MATCH_ROUND_OVER_EVENT");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 300);
    expect(block).toContain("this.audio.playRoundWin()");
    expect(block).toContain("this.audio.playRoundLoss()");
    // Gated on the local session being the winner.
    expect(block).toContain("e.winnerId===sid");
  });

  it("plays jump and land audio from the predicted movement state", () => {
    // Jump: lastGrounded && !predicted.grounded
    expect(runtime).toContain("this.lastGrounded&&!predicted.grounded");
    expect(runtime).toContain("this.audio.playJump()");
    // Land: !lastGrounded && predicted.grounded
    expect(runtime).toContain("!this.lastGrounded&&predicted.grounded");
    expect(runtime).toContain("this.audio.playLand(");
    // lastGrounded is updated each tick.
    expect(runtime).toContain("this.lastGrounded=predicted.grounded");
  });

  it("plays the countdown tick sound only when the displayed second changes", () => {
    const idx = runtime.indexOf("private handleCountdownTickEvent");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 400);
    expect(block).toContain("this.audio.playCountdownTick()");
    // The server ticks at 30 Hz; the client must dedupe by displayed second.
    expect(block).toContain("if(next===this.countdownSeconds)return");
  });

  it("unlocks audio when the runtime starts", () => {
    const idx = runtime.indexOf("public start():void");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 400);
    expect(block).toContain("this.audio.unlock()");
  });

  it("plays reload audio when a local reload starts", () => {
    const idx = runtime.indexOf("this.networkClient.sendWeaponReload()");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 200);
    expect(block).toContain("this.audio.playReload()");
  });

  it("resets audio on (re)connect and on match reset", () => {
    const resets = runtime.match(/this\.audio\.reset\(\)/g) ?? [];
    expect(resets.length).toBeGreaterThanOrEqual(2);
    // lastGrounded is also reset to prevent stale jump detection.
    const lgResets = runtime.match(/this\.lastGrounded=true/g) ?? [];
    expect(lgResets.length).toBeGreaterThanOrEqual(2);
  });

  it("disposes audio and cleans up subscriptions on teardown", () => {
    expect(runtime).toContain("this.audio.dispose()");
    expect(runtime).toContain("this.unsubscribeBuildPlacedEvent?.()");
    expect(runtime).toContain("this.unsubscribeBuildDestroyedEvent?.()");
    expect(runtime).toContain("this.unsubscribeRoundOverEvent?.()");
  });
});
