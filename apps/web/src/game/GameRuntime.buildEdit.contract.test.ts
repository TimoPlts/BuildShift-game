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
 *    surface) and the SAME shared interaction-mode coordinator (overhaul
 *    task 12 — one owner of the build/edit layer state), and driven once per
 *    render frame from the runtime's EXISTING sources (camera, aim, feet, the
 *    authoritative building mirror, session id, connection state, in-round
 *    flag, and the per-frame primary-action route);
 *  - the projected edit-grid preview (`EditPreviewPresentation`) is driven
 *    from the controller's pending state + the pure `aimEditTile` crosshair
 *    mapping, and hidden when there is nothing to show;
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
  it("constructs the build-edit system + preview from the existing canvas + network client", () => {
    expect(runtime).toContain(
      'import{createBuildEditSystem,buildBuildEditHudView,EditPreviewPresentation,aimEditTile,BUILD_EDIT_RANGE,type BuildEditSystem}from"./buildEdit"',
    );
    expect(runtime).toContain("private readonly buildEditSystem:BuildEditSystem;");
    // Same canvas + network client as the building system — no new network
    // surface — plus the shared interaction-mode coordinator.
    expect(runtime).toContain(
      "this.buildEditSystem=createBuildEditSystem(canvas,this.networkClient,{interactionMode:this.interactionMode});",
    );
    // The projected edit-grid preview is a presentation-only scene resource.
    expect(runtime).toContain(
      "this.editPreview=new EditPreviewPresentation(this.scene);",
    );
    // It is created after the network client exists (the building-system line
    // precedes it, which itself follows `this.networkClient=...`).
    const clientIdx = runtime.indexOf("this.networkClient=networking.client");
    const buildEditIdx = runtime.indexOf(
      "this.buildEditSystem=createBuildEditSystem(canvas,this.networkClient,{interactionMode:this.interactionMode});",
    );
    expect(clientIdx).toBeGreaterThan(-1);
    expect(buildEditIdx).toBeGreaterThan(clientIdx);
  });

  it("shares ONE interaction-mode coordinator between the building and build-edit systems", () => {
    // A single coordinator instance is constructed on the runtime ...
    expect(runtime).toContain(
      "private readonly interactionMode=new InteractionModeCoordinator();",
    );
    // ... and the SAME instance is threaded into both systems (no per-system
    // mode state, no duplicate listeners — the coordinator owns none).
    expect(runtime).toContain(
      "this.buildingSystem=createBuildingSystem(canvas,this.networkClient,this.interactionMode);",
    );
    expect(runtime).toContain(
      "this.buildEditSystem=createBuildEditSystem(canvas,this.networkClient,{interactionMode:this.interactionMode});",
    );
  });

  it("drives the build-edit frame from the runtime's existing sources each render frame", () => {
    // The update is called right after the building frame update in the render
    // loop, with the same per-frame primary-action route. Build presentation
    // synchronizes the same authoritative mirror before edit targeting and
    // HUD emission.
    // (Feet are written into a reusable runtime temp — no per-frame Vector3.)
    expect(runtime).toContain(
      "this.playerController.getFeetPositionInto(this._feetPos),this.isConnected,route.buildPlaceHeld,undefined,inRound,route.buildPlacePressed);this.updateBuildPresentation();this.updateBuildEditFrame(route);if(this.debugHudEnabled)",
    );

    const fnIdx = runtime.indexOf("private updateBuildEditFrame(route:PrimaryActionRoute):void");
    expect(fnIdx).toBeGreaterThan(-1);
    const block = runtime.slice(fnIdx, fnIdx + 900);
    // Reads only existing runtime sources: camera position, the shared aim
    // direction, the player's feet, the authoritative building mirror, the
    // session id, the live connection flag, the in-round flag, and the
    // routed edit-select edges.
    expect(block).toContain("camera.position");
    expect(block).toContain("this.currentAimDirection");
    expect(block).toContain("this.playerController.getFeetPositionInto(this._feetPos)");
    expect(block).toContain("this.buildingSystem.store.getBuildingState()");
    expect(block).toContain("sessionId:this.networkClient.sessionId");
    expect(block).toContain("connected:this.isConnected");
    expect(block).toContain("inRound");
    expect(block).toContain("editSelectPressed:route.editSelectPressed,editSelectHeld:route.editSelectHeld");
  });

  it("drives the projected edit-grid preview from the pending state + pure tile mapping", () => {
    const fnIdx = runtime.indexOf("private updateBuildEditFrame(route:PrimaryActionRoute):void");
    expect(fnIdx).toBeGreaterThan(-1);
    const block = runtime.slice(fnIdx, fnIdx + 1400);
    // The preview shows the pending (optimistic/auth) state for the targeted
    // structure with the crosshair tile / ramp-half highlighted ...
    expect(block).toContain("this.editPreview.show({");
    expect(block).toContain("aimEditTile({structure,aimOrigin:camera.position");
    expect(block).toContain("maxRange:BUILD_EDIT_RANGE");
    // ... and hides it whenever there is no target or pending state.
    expect(block).toContain("this.editPreview.hide();");
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
