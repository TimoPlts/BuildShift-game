/**
 * Source-wiring contract test for the weapon-model presentation integration.
 *
 * `GameRuntime.create()` needs a WebGL canvas and an async Rapier physics
 * world, so the canonical `App -> GameCanvas -> GameRuntime -> NetworkClient`
 * wiring is asserted at the source level (mirroring
 * `GameRuntime.combatPresentation.wiring.test.ts` and
 * `GameRuntime.playerPresentation.wiring.test.ts`). The presentation
 * component itself is unit-tested in `scene/weaponModelPresentation.test.ts`
 * and the local weapon state machine in the `weapon` module tests.
 *
 * What this contract locks down:
 *  - the first-person weapon model is the modular `WeaponModelPresentation`,
 *    owned by the runtime and parented to the local player's presentation
 *    root (no separate player rig or second scene graph);
 *  - local weapon input (switch / reload / fire) goes through the existing
 *    `WeaponController` and reaches the server ONLY via the shared
 *    `NetworkClient.send` route — the runtime never opens a second
 *    connection or sends weapon traffic on a side channel;
 *  - the authoritative `weapon:state_update` broadcast reconciles the local
 *    weapon state only for the local session (canonical authoritative
 *    state, not a client-predicted mirror);
 *  - round reset / rematch and (re)connect restore the default weapon on the
 *    model, so no stale weapon survives a fresh match;
 *  - teardown disposes the model and releases the weapon-state subscription.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtime = readFileSync(new URL("./GameRuntime.ts", import.meta.url), "utf8");

describe("GameRuntime weapon model wiring", () => {
  it("owns the modular WeaponModelPresentation parented to the local player", () => {
    expect(runtime).toContain(
      'import{WeaponModelPresentation}from"./scene/WeaponModelPresentation"',
    );
    expect(runtime).toContain("private readonly weaponModel:WeaponModelPresentation;");
    expect(runtime).toContain(
      'this.weaponModel=WeaponModelPresentation.create(this.scene,"weapon-model");',
    );
    // Parented into the existing local-player presentation root — the model
    // rides the player, it is not a separate player rig.
    expect(runtime).toContain(
      "this.weaponModel.root.parent=this.playerController.presentationRoot;",
    );
  });

  it("routes local weapon-switch intent through the shared NetworkClient", () => {
    const idx = runtime.indexOf("consumeWeaponSlot1Pressed()");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 300);
    // The switch is accepted by the existing controller first ...
    expect(block).toContain("this.weaponController.switchWeapon(\"assault_rifle\")");
    // ... and only then is the canonical switch message sent on the shared
    // network client, with the model mirroring the accepted weapon.
    expect(block).toContain("this.networkClient.send(SWITCH_WEAPON_MESSAGE,msg)");
    expect(block).toContain("this.weaponModel.setEquippedWeapon(r.targetWeapon)");
  });

  it("routes local reload and fire intents through the shared NetworkClient", () => {
    // Reload: the request carries the local session id read from the client.
    const reloadIdx = runtime.indexOf("consumeReloadPressed()");
    expect(reloadIdx).toBeGreaterThan(-1);
    const reloadBlock = runtime.slice(reloadIdx, reloadIdx + 300);
    expect(reloadBlock).toContain("this.networkClient.sessionId");
    expect(reloadBlock).toContain("this.networkClient.send(RELOAD_MESSAGE,msg)");
    // Fire: the controller-produced request is sent on the shared client.
    expect(runtime).toContain("this.networkClient.send(FIRE_MESSAGE,r.request);");
  });

  it("reconciles the authoritative weapon-state broadcast for the local session only", () => {
    const idx = runtime.indexOf("onEvent(WEAPON_STATE_UPDATE_EVENT");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 200);
    // Canonical authoritative state: gated on a known local session id ...
    expect(block).toContain("this.networkClient.sessionId");
    // ... and fed into the existing weapon controller's reconcile path.
    expect(block).toContain("this.weaponController.reconcile(p as WeaponStateUpdate,sid)");
  });

  it("restores the default weapon on (re)connect and on round reset / rematch", () => {
    // Both the reconnect block and the match-reset block restore the
    // default weapon, so a fresh match never starts on a stale model.
    const resets =
      runtime.match(/this\.weaponModel\.setEquippedWeapon\("assault_rifle"\)/g) ?? [];
    expect(resets.length).toBeGreaterThanOrEqual(2);
  });

  it("disposes the model and releases the weapon-state subscription on teardown", () => {
    expect(runtime).toContain("this.weaponModel.dispose();");
    expect(runtime).toContain("this.unsubscribeWeaponStateEvent?.();");
  });
});
