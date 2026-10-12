/**
 * Source-wiring contract test proving the build-edit integration rides the
 * EXISTING server-authoritative route — no parallel network or authority
 * path.
 *
 * The behavioural authority contract (intents only, server result is truth,
 * presentation state never mutates gameplay) is unit-tested in
 * `buildEdit/buildEditController.test.ts` and `ui/hud/BuildEditHud.test.ts`;
 * the runtime-level construction/reset/dispose wiring is locked down in
 * `GameRuntime.buildEdit.contract.test.ts`. This file closes the route:
 *
 *  - the build-edit system is handed the runtime's own `NetworkClient`
 *    (the SAME instance the building system and every other system use —
 *    one connection surface);
 *  - the factory threads that network surface unchanged into the
 *    `BuildEditController`;
 *  - the controller talks build-edit ONLY through the canonical
 *    `two-player:edit_grid_action` identifier (out for intents, in for the
 *    result broadcast) — asserted against the real protocol value so a
 *    renamed / hard-coded side channel cannot slip in;
 *  - edit intents are submitted only while the connection is live AND an
 *    active round is running (`ctx.connected && ctx.inRound`).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EDIT_GRID_ACTION_MESSAGE } from "./buildEdit";

const runtime = readFileSync(new URL("./GameRuntime.ts", import.meta.url), "utf8");
const buildEditIndex = readFileSync(
  new URL("./buildEdit/index.ts", import.meta.url),
  "utf8",
);
const buildEditController = readFileSync(
  new URL("./buildEdit/buildEditController.ts", import.meta.url),
  "utf8",
);

describe("build-edit authoritative route", () => {
  it("is constructed from the runtime's own NetworkClient (one connection surface)", () => {
    // The building system and the build-edit system are both created from
    // the SAME canvas + the SAME network client instance + the SAME shared
    // interaction-mode coordinator (overhaul task 12).
    expect(runtime).toContain(
      "this.buildingSystem=createBuildingSystem(canvas,this.networkClient,this.interactionMode);",
    );
    expect(runtime).toContain(
      "this.buildEditSystem=createBuildEditSystem(canvas,this.networkClient,{interactionMode:this.interactionMode});",
    );
    // The build-edit system is created after the shared client exists.
    const clientIdx = runtime.indexOf("this.networkClient=networking.client");
    const buildEditIdx = runtime.indexOf("this.buildEditSystem=createBuildEditSystem(");
    expect(clientIdx).toBeGreaterThan(-1);
    expect(buildEditIdx).toBeGreaterThan(clientIdx);
  });

  it("threads that network surface unchanged into the BuildEditController", () => {
    // The factory passes the caller's network object straight through — no
    // wrapper, no second client, no new event bus.
    const factoryIdx = buildEditIndex.indexOf("export function createBuildEditSystem");
    expect(factoryIdx).toBeGreaterThan(-1);
    const block = buildEditIndex.slice(factoryIdx, factoryIdx + 700);
    expect(block).toContain("new BuildEditInputController(");
    expect(block).toContain("options?.env");
    expect(block).toContain("options?.interactionMode");
    expect(block).toContain(
      "const controller = new BuildEditController(\n    input,\n    network,",
    );
  });

  it("uses the canonical two-player:edit_grid_action identifier for edit traffic", () => {
    // The controller's identifier is the canonical wire value (matching the
    // server's `EDIT_GRID_ACTION_INPUT`) — so a renamed / hard-coded side
    // channel cannot slip in.
    expect(EDIT_GRID_ACTION_MESSAGE).toBe("two-player:edit_grid_action");
    // ... and the controller references the shared constant (not a
    // hard-coded string side channel) in both directions: intents go out on
    // it, the result broadcast comes in on it.
    expect(buildEditController).toContain("this.network.send(EDIT_GRID_ACTION_MESSAGE, payload)");
    expect(buildEditController).toContain(
      "this.unsubscribeResult = network.onEvent(\n      EDIT_GRID_ACTION_MESSAGE,",
    );
    expect(buildEditController).toContain("parseEditActionResult(payload)");
  });

  it("submits edit intents only while connected AND in an active round", () => {
    // The per-frame intent path is gated on the live-connection flag and the
    // in-round flag the runtime hands over each frame ...
    const updateIdx = buildEditController.indexOf("public updateFrame(ctx: BuildEditFrameContext)");
    expect(updateIdx).toBeGreaterThan(-1);
    const updateBlock = buildEditController.slice(updateIdx, updateIdx + 3000);
    expect(updateBlock).toContain("ctx.connected");
    expect(updateBlock).toContain("ctx.inRound");
    // ... and the per-frame intent path re-checks both before consuming the
    // routed select edges.
    expect(updateBlock).toContain(
      "if (this.mode && this.target !== null && ctx.connected && ctx.inRound) {",
    );
  });
});
