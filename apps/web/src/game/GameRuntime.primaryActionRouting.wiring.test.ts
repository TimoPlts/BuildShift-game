import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtime = readFileSync(new URL("./GameRuntime.ts", import.meta.url), "utf8");

describe("GameRuntime primary-action routing", () => {
  it("uses one build-mode ownership decision for fire edges and held fire", () => {
    expect(runtime).toContain('import{routePrimaryAction}from"./input/primaryActionRouting"');
    expect(runtime).toContain(
      "routePrimaryAction(this.buildingSystem.controller.isBuildModeActive(),this.inputManager.consumeFirePressed(),this.inputManager.isFiring()).weaponFirePressed",
    );
    expect(runtime).toContain(
      "routePrimaryAction(this.buildingSystem.controller.isBuildModeActive(),false,this.inputManager.isFiring()).weaponFireHeld",
    );
  });

  it("routes the held primary into the building frame through the same centralized input", () => {
    // The building frame receives the routed build-owned hold (turbo
    // building) from the same routePrimaryAction decision over the
    // centralized InputManager fire state — no second mouse listener.
    expect(runtime).toContain(
      "updateBuildingFrame(this.buildingSystem,this.cameraController.getCamera(),this.currentAimDirection,this.playerController.getFeetPositionInto(this._feetPos),this.isConnected,routePrimaryAction(this.buildingSystem.controller.isBuildModeActive(),false,this.inputManager.isFiring()).buildPlaceHeld);",
    );
  });

  it("suppresses weapon slot switches while build mode is active (no duplicate commands)", () => {
    // When build mode is on, number keys 1–2 are owned by the building system
    // (piece selection). The runtime must NOT also send a weapon switch for
    // the same key press. The gate reads the canonical build-mode state and
    // discards the weapon slot latch without acting.
    expect(runtime).toContain(
      "const inBuild=this.buildingSystem.controller.isBuildModeActive()",
    );
    expect(runtime).toContain(
      "if(wsi&&!inBuild)",
    );
    expect(runtime).toContain(
      "if(wsi2&&!inBuild)",
    );
  });
});
