/**
 * Source-wiring contract test for the combat presentation integration.
 *
 * `GameRuntime.create()` needs a WebGL canvas and an async Rapier physics
 * world, so the canonical `App -> GameCanvas -> GameRuntime -> NetworkClient`
 * wiring is asserted at the source level (mirroring
 * `GameRuntime.arenaScene.integration.test.ts`). The pure presentation
 * modules it drives (`CameraRecoil`, `resolveStructureImpactPosition`) are
 * unit-tested in `combat/cameraRecoil.test.ts` and
 * `combat/structureImpactPosition.test.ts`.
 *
 * What this contract locks down:
 *  - accepted local shots call the reviewed `playShot` (muzzle + tracer) and
 *    register a per-weapon camera-recoil kick (not the legacy flash-only shim);
 *  - the transient camera pitch offset is driven by `cameraRecoil.update` and
 *    applied before the camera update each frame;
 *  - the authoritative `combat:hit` event triggers the hit marker only when
 *    the local session is the shooter;
 *  - the authoritative `build:structure_damaged` event triggers a build impact
 *    only when the local session is the source, at a position derived from the
 *    replicated building state;
 *  - teardown / reset path cleans up the new subscription and clears recoil.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtime = readFileSync(new URL("./GameRuntime.ts", import.meta.url), "utf8");
const canvas = readFileSync(new URL("./GameCanvas.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("GameRuntime combat presentation wiring", () => {
  it("runs through App -> GameCanvas -> GameRuntime.create", () => {
    expect(app).toMatch(
      /import\s*\{[^}]*GameCanvas[^}]*\}\s*from\s*["']\.\/game\/GameCanvas["']/,
    );
    expect(app).toContain("<GameCanvas");
    expect(canvas).toContain("GameRuntime.create(canvas)");
  });

  it("plays a muzzle flash + tracer and kicks recoil on an accepted local shot", () => {
    // The fire path uses the reviewed playShot (muzzle + tracer), ...
    expect(runtime).toContain(
      "this.combatFeedback.playShot(r.request.weaponType,this._muzzlePos,d)",
    );
    // ...and registers a per-weapon camera-recoil kick.
    expect(runtime).toContain("this.cameraRecoil.kick(r.request.weaponType)");
    // The legacy flash-only shim is no longer on the fire path.
    expect(runtime).not.toContain("this.combatFeedback.triggerMuzzleFlash");
  });

  it("applies the modular recoil to the camera each frame before the camera update", () => {
    const setIdx = runtime.indexOf(
      "this.cameraController.setPitchOffset(this.cameraRecoil.update(dt))",
    );
    const updateIdx = runtime.indexOf(
      "this.cameraController.update(this.playerController.getFeetPositionInto(this._feetPos))",
    );
    expect(setIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(setIdx);
  });

  it("triggers the hit marker only for an authoritative hit by the local session", () => {
    const idx = runtime.indexOf("onEvent(COMBAT_HIT_EVENT");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 400);
    // Gated on the local session being the shooter (and not the target).
    expect(block).toContain("e.shooterId===sid");
    expect(block).toContain("this.combatFeedback.triggerHitMarker()");
  });

  it("triggers a build impact only for structure damage caused by the local session", () => {
    // The authoritative structure_damaged event is subscribed on the network client.
    expect(runtime).toContain("ENERGY_EVENTS.STRUCTURE_DAMAGED");
    const idx = runtime.indexOf("handleStructureDamage(payload:unknown)");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 500);
    // Gated on the local session being the damage source.
    expect(block).toContain("e.sourcePlayerId!==sid");
    // Plays a build impact at a position derived from the replicated state.
    expect(block).toContain("this.combatFeedback.playBuildImpact");
    expect(block).toContain(
      "resolveStructureImpactPosition(this.buildingSystem.store.getBuildingState()",
    );
  });

  it("cleans up the new subscription and clears recoil on teardown / reset", () => {
    // dispose removes the structure-damage subscription.
    expect(runtime).toContain("this.unsubscribeStructureDamageEvent?.()");
    // The recoil is reset on (re)connect and on match reset.
    expect(runtime.match(/this.cameraRecoil\.reset\(\)/g)?.length).toBeGreaterThanOrEqual(
      2,
    );
  });
});
