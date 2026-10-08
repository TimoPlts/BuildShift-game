/**
 * Source-wiring contract test for the build-edit client integration.
 *
 * `GameRuntime.create()` needs a WebGL canvas and an async Rapier physics
 * world, so the canonical `App -> GameCanvas -> GameRuntime -> NetworkClient`
 * build-edit wiring is asserted at the source level (mirroring
 * `GameRuntime.hudWiring.contract.test.ts`). The pure build-edit logic it
 * drives is unit-tested in the `src/game/buildEdit` tests and the panel in
 * `ui/hud/BuildEditHud.test.ts`.
 *
 * What this contract locks down:
 *  - the build-edit system is constructed in the runtime constructor from the
 *    SAME canvas + network client as the building system (no second network
 *    surface), and driven once per render frame from the runtime's EXISTING
 *    sources (camera, aim, feet, the authoritative building mirror, session
 *    id, connection state);
 *  - the build-edit presentation state is folded into the local HUD view
 *    through the pure `buildBuildEditHudView` mapper (no mirrored gameplay
 *    state invented in the runtime);
 *  - preview + feedback are cleaned up on a round reset / rematch
 *    (`buildEditSystem.reset()`) and on a connection drop
 *    (`buildEditSystem.clearOnDisconnect()`);
 *  - the system is disposed with the rest of the runtime
 *    (`disposeGameRuntimeResources` carries + disposes `buildEditSystem`);
 *  - `GameHud` renders the `BuildEditHud` panel from `local.buildEdit`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtime = readFileSync(new URL("./GameRuntime.ts", import.meta.url), "utf8");
const internal = readFileSync(new URL("./GameRuntimeInternal.ts", import.meta.url), "utf8");
const hud = readFileSync(new URL("../ui/hud/GameHud.tsx", import.meta.url), "utf8");

describe("GameRuntime build-edit wiring", () => {
  it("constructs the build-edit system from the existing canvas + network client", () => {
    expect(runtime).toContain(
      "import{createBuildEditSystem,buildBuildEditHudView,type BuildEditSystem}from\"./buildEdit\"",
    );
    expect(runtime).toContain("private readonly buildEditSystem:BuildEditSystem;");
    // Same canvas + network client as the building system — no new network surface.
    expect(runtime).toContain(
      "this.buildEditSystem=createBuildEditSystem(canvas,this.networkClient);",
    );
    // It is created after the network client exists (the building-system line
    // precedes it, which itself follows `this.networkClient=...`).
    const clientIdx = runtime.indexOf("this.networkClient=networking.client");
    const buildEditIdx = runtime.indexOf(
      "this.buildEditSystem=createBuildEditSystem(canvas,this.networkClient);",
    );
    expect(clientIdx).toBeGreaterThan(-1);
    expect(buildEditIdx).toBeGreaterThan(clientIdx);
  });

  it("drives the build-edit frame from the runtime's existing sources each render frame", () => {
    // The update is called right after the building frame update in the render
    // loop. Build presentation synchronizes the same authoritative mirror
    // before edit targeting and HUD emission.
    expect(runtime).toContain(
      "this.playerController.getFeetPosition(),this.isConnected);this.updateBuildPresentation();this.updateBuildEditFrame();if(this.debugHudEnabled)",
    );

    const fnIdx = runtime.indexOf("private updateBuildEditFrame():void");
    expect(fnIdx).toBeGreaterThan(-1);
    const block = runtime.slice(fnIdx, fnIdx + 400);
    // Reads only existing runtime sources: camera position, the shared aim
    // direction, the player's feet, the authoritative building mirror, the
    // session id, and the live connection flag.
    expect(block).toContain("camera.position");
    expect(block).toContain("this.currentAimDirection");
    expect(block).toContain("this.playerController.getFeetPosition()");
    expect(block).toContain("this.buildingSystem.store.getBuildingState()");
    expect(block).toContain("sessionId:this.networkClient.sessionId");
    expect(block).toContain("connected:this.isConnected");
  });

  it("folds the build-edit presentation state into the local HUD view via the pure mapper", () => {
    const hudIdx = runtime.indexOf("public getLocalHudView():LocalHudView");
    expect(hudIdx).toBeGreaterThan(-1);
    // The controller's presentation state is mapped through the pure mapper...
    expect(runtime).toContain("const be=this.buildEditSystem.controller");
    expect(runtime).toContain("buildBuildEditHudView({mode:be.getMode()");
    // ...and folded into the flat view alongside the building fields.
    expect(runtime).toContain("p.grid:null,buildEdit,roundTimer:this.lastRoundTimer");
  });

  it("clears build-edit preview + feedback on a round reset / rematch", () => {
    const msIdx = runtime.indexOf("handleMatchState(match:ParsedMatchState)");
    expect(msIdx).toBeGreaterThan(-1);
    // The build-edit reset rides on the same `shouldReset` block as the building reset.
    expect(runtime).toContain(
      "this.buildingSystem.reset();this.buildStructureRenderer.syncStructures(this.buildingSystem.store.getBuildingState());this.buildEditSystem.reset();",
    );
  });

  it("clears build-edit preview + feedback when the connection drops", () => {
    expect(runtime).toContain(
      "}else{this.buildEditSystem.clearOnDisconnect();}this.debugHud.state.connectionState",
    );
  });

  it("disposes the build-edit system with the rest of the runtime", () => {
    expect(runtime).toContain(
      "buildingSystem:this.buildingSystem,buildEditSystem:this.buildEditSystem,weaponController:this.weaponController",
    );
    expect(internal).toContain("buildEditSystem: BuildEditSystem;");
    expect(internal).toContain("d.buildEditSystem.dispose();");
  });

  it("renders the BuildEditHud panel from the local HUD view", () => {
    expect(hud).toContain("import { BuildEditHud } from \"./BuildEditHud\";");
    expect(hud).toContain("<BuildEditHud");
    expect(hud).toContain("mode={local.buildEdit.mode}");
    expect(hud).toContain("target={local.buildEdit.target}");
    expect(hud).toContain("feedback={local.buildEdit.feedback}");
  });
});
