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
});
