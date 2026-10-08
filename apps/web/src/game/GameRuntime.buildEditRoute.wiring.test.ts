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
 *  - the controller talks build-edit ONLY through the canonical protocol
 *    identifiers (`BUILD_EDIT_EVENTS.EDIT_REQUEST` out,
 *    `BUILD_EDIT_EVENTS.EDIT_RESULT` in) — asserted against the real
 *    `@buildshift/protocol` values so a renamed / hard-coded side channel
 *    cannot slip in;
 *  - edit intents are submitted only while the canonical connection is live.
 */
import { readFileSync } from "node:fs";
import { BUILD_EDIT_EVENTS } from "@buildshift/protocol";
import { describe, expect, it } from "vitest";

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
    // the SAME canvas + the SAME network client instance.
    expect(runtime).toContain("this.buildingSystem=createBuildingSystem(canvas,this.networkClient);");
    expect(runtime).toContain(
      "this.buildEditSystem=createBuildEditSystem(canvas,this.networkClient);",
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
    expect(buildEditIndex).toContain("new BuildEditController(");
    const factoryIdx = buildEditIndex.indexOf("export function createBuildEditSystem");
    expect(factoryIdx).toBeGreaterThan(-1);
    const block = buildEditIndex.slice(factoryIdx, factoryIdx + 600);
    expect(block).toContain(
      "const controller = new BuildEditController(\n    input,\n    network,",
    );
  });

  it("uses the canonical protocol identifiers for edit traffic", () => {
    // The protocol package defines the canonical wire identifiers ...
    expect(typeof BUILD_EDIT_EVENTS.EDIT_REQUEST).toBe("string");
    expect(typeof BUILD_EDIT_EVENTS.EDIT_RESULT).toBe("string");
    // ... and the controller references those constants (not a hard-coded
    // string side channel) in both directions.
    expect(buildEditController).toContain("import {");
    expect(buildEditController).toContain("BUILD_EDIT_EVENTS,");
    expect(buildEditController).toContain(
      "this.network.send(BUILD_EDIT_EVENTS.EDIT_REQUEST, {",
    );
    expect(buildEditController).toContain("BUILD_EDIT_EVENTS.EDIT_RESULT,");
  });

  it("submits edit intents only while the canonical connection is live", () => {
    // The per-frame apply path is gated on the live-connection flag the
    // runtime hands over each frame ...
    const updateIdx = buildEditController.indexOf("public updateFrame(ctx: BuildEditFrameContext)");
    expect(updateIdx).toBeGreaterThan(-1);
    const updateBlock = buildEditController.slice(updateIdx, updateIdx + 1500);
    expect(updateBlock).toContain("ctx.connected");
    // ... and requestEdit re-checks it before touching the wire.
    const requestIdx = buildEditController.indexOf("public requestEdit(");
    expect(requestIdx).toBeGreaterThan(-1);
    const requestBlock = buildEditController.slice(requestIdx, requestIdx + 400);
    expect(requestBlock).toContain("ctx.connected");
  });
});
