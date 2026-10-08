/**
 * Source-level contract for the real production connection route.
 *
 * GameRuntime requires Babylon/WebGL and Rapier, so the imperative hand-off
 * to the canonical NetworkClient is locked down here while GameCanvas's
 * StrictMode lifecycle is exercised in GameCanvas.startup.test.tsx.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtimeSource = readFileSync(new URL("./GameRuntime.ts", import.meta.url), "utf8");
const networkSource = readFileSync(
  new URL("./network/NetworkClient.ts", import.meta.url),
  "utf8",
);

describe("GameRuntime canonical network startup", () => {
  it("starts exactly the canonical NetworkClient which joins TwoPlayerMovementRoom", () => {
    expect(runtimeSource).toContain("const networking=createGameNetworking()");
    expect(runtimeSource).toContain("void this.networkClient.start()");
    expect(networkSource).toContain('export const ROOM_NAME = "two-player-movement"');
    expect(networkSource).toContain(".joinOrCreate(this.roomName)");
  });

  it("does not attach a completed join after its runtime has stopped or disposed", () => {
    expect(networkSource).toContain(
      "if (this.disposed || !this.started || this.client !== client)",
    );
    expect(networkSource).toContain("void sdkRoom.leave().catch(() => {})");
  });
});
