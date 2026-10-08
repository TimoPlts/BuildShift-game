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
 *  - local weapon input uses the existing `WeaponController` and the canonical
 *    `NetworkClient` commands/input frame — no retired `weapon:*` messages
 *    can leave the runtime;
 *  - the authoritative `combat:weapon_state` broadcast reconciles the local
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

  it("routes both weapon-slot intents through the canonical switch command", () => {
    const idx = runtime.indexOf("consumeWeaponSlot1Pressed()");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 300);
    // The switch is accepted by the existing controller first ...
    expect(block).toContain("this.weaponController.switchWeapon(\"assault_rifle\")");
    // ... and only then is the canonical switch command sent on the shared
    // client, with the model mirroring the accepted weapon.
    expect(block).toContain("this.networkClient.sendWeaponSwitch(r.targetWeapon)");
    expect(block).toContain("this.weaponModel.setEquippedWeapon(r.targetWeapon)");
    expect(runtime).toContain("consumeWeaponSlot2Pressed()");
    expect(runtime).toContain("sendWeaponSwitch(r.targetWeapon)");
  });

  it("routes local reload and fire intent through the canonical network path", () => {
    // Reload is sent by the NetworkClient's canonical command.
    const reloadIdx = runtime.indexOf("consumeReloadPressed()");
    expect(reloadIdx).toBeGreaterThan(-1);
    const reloadBlock = runtime.slice(reloadIdx, reloadIdx + 300);
    expect(reloadBlock).toContain("this.networkClient.sendWeaponReload()");
    // Fire authority is carried by `primaryFire` in the shared input batch.
    // No retired direct weapon message may be sent by the runtime.
    expect(runtime).toContain("primaryFire:fi");
    expect(runtime).toContain("this.inputBatcher.send(sample,this.networkClient");
    expect(runtime).not.toContain("weapon:");
    expect(runtime).not.toContain("FIRE_MESSAGE");
    expect(runtime).not.toContain("SWITCH_WEAPON_MESSAGE");
    expect(runtime).not.toContain("RELOAD_MESSAGE");
  });

  it("reconciles the canonical authoritative weapon-state broadcast for the local session only", () => {
    const idx = runtime.indexOf("onEvent(WEAPON_STATE_EVENT");
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
