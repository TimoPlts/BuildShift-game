/**
 * Source-wiring contract test for the player visual upgrade.
 *
 * The full GameRuntime needs a WebGL canvas and async Rapier WASM, so the
 * canonical `App -> GameCanvas -> GameRuntime -> NetworkClient` wiring is
 * asserted at the source level (mirroring
 * `GameRuntime.combatPresentation.wiring.test.ts`). The presentation module
 * itself is unit-tested in `scene/playerPresentation.test.ts`.
 *
 * What this contract locks down:
 *  - the local player body is the modular PlayerPresentation ("local"
 *    variant), owned and disposed by PlayerController;
 *  - the remote player body is created on demand by the runtime from the
 *    replicated/interpolated state only (no gameplay logic in the
 *    presentation path);
 *  - the old capsule-based remote visuals are gone;
 *  - teardown disposes the remote presentation through the shared
 *    disposeGameRuntimeResources path.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtime = readFileSync(new URL("./GameRuntime.ts", import.meta.url), "utf8");
const internal = readFileSync(new URL("./GameRuntimeInternal.ts", import.meta.url), "utf8");
const playerController = readFileSync(
  new URL("./player/PlayerController.ts", import.meta.url),
  "utf8",
);

describe("GameRuntime player presentation wiring", () => {
  it("uses the modular PlayerPresentation for both players", () => {
    expect(runtime).toContain('import{PlayerPresentation}from"./scene/PlayerPresentation"');
    expect(playerController).toContain("PlayerPresentation");
    // Local: the "local" variant created by the player controller.
    expect(playerController).toContain(
      'PlayerPresentation.create(scene, "local", "local-player")',
    );
    // Remote: the "remote" variant created lazily by the runtime.
    expect(runtime).toContain(
      'PlayerPresentation.create(this.scene,"remote","remote-player")',
    );
  });

  it("drives the remote body only from replicated/interpolated state", () => {
    const idx = runtime.indexOf("private updateRemotePlayers()");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 600);
    // Position + yaw come from the interpolation buffer ...
    expect(block).toContain("this.remoteInterpolation.getInterpolated(performance.now())");
    // ... and the eliminated / hit-flash state from the replicated match
    // flags the runtime already tracks.
    expect(block).toContain("this.remotePresentation.setTransform(");
    expect(block).toContain(
      "this.remotePresentation.applyState(this.remoteWasEliminated,this.remoteHitFlashFrames)",
    );
    // No data -> hidden, no mesh churn.
    expect(block).toContain("this.remotePresentation?.setEnabled(false)");
  });

  it("drives the local body state from the same canonical events as the remote body", () => {
    // An authoritative hit whose target is the local session sets the local
    // hit-flash counter (the mirror of the remote player's branch).
    const hitIdx = runtime.indexOf("onEvent(COMBAT_HIT_EVENT");
    expect(hitIdx).toBeGreaterThan(-1);
    const hitHandler = runtime.slice(hitIdx, hitIdx + 400);
    expect(hitHandler).toContain(
      "if(sid&&e.targetId===sid&&e.shooterId!==sid){this.localHitFlashFrames=6;this.combatFeedback.triggerDamageTaken();}",
    );
    // The render frame applies eliminated + hit-flash state to the local
    // presentation via the same applyState contract the remote body uses.
    expect(runtime).toContain(
      "this.localHitFlashFrames=this.playerController.presentation.applyState(this.localEliminated,this.localHitFlashFrames)",
    );
    // The local presentation is reached through the controller's read-only
    // accessor (ownership/disposal stay with the controller).
    expect(playerController).toContain(
      "public get presentation(): PlayerPresentation",
    );
  });

  it("resets the local hit-flash on reconnect and on match reset", () => {
    // Both canonical reset sites (connection change, match reset) clear the
    // local counter alongside the remote one; the field declaration itself
    // does not use the `this.` prefix, so exactly two reset sites remain.
    const resetSites = runtime.split("this.localHitFlashFrames=0").length - 1;
    expect(resetSites).toBe(2);
  });

  it("no longer uses the capsule-based remote visuals", () => {
    for (const legacy of [
      "ensureRemoteMesh",
      "updateRemotePlayersVisuals",
      "setRemoteVisible",
      "RemotePlayerVisuals",
    ]) {
      expect(runtime).not.toContain(legacy);
      expect(internal).not.toContain(legacy);
    }
    expect(playerController).not.toContain("CreateCapsule");
  });

  it("cleans up the presentation on teardown via the shared disposables path", () => {
    // The runtime hands its (lazily created) remote presentation to the
    // shared disposal helper ...
    expect(runtime).toContain("remotePresentation:this.remotePresentation");
    // ... which disposes it (the presentation owns all of its meshes/materials).
    expect(internal).toContain("d.remotePresentation?.dispose()");
    // The local presentation is disposed with the player controller.
    const disposeIdx = playerController.indexOf("public dispose(): void");
    expect(disposeIdx).toBeGreaterThan(-1);
    expect(playerController.slice(disposeIdx, disposeIdx + 300)).toContain(
      "this._presentation.dispose()",
    );
  });
});
