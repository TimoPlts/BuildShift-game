import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtime = readFileSync(new URL("./GameRuntime.ts", import.meta.url), "utf8");

describe("GameRuntime authoritative build presentation wiring", () => {
  it("renders only from the canonical replicated building mirror", () => {
    expect(runtime).toContain('import{BuildStructureRenderer}from"./remote/BuildStructureRenderer"');
    expect(runtime).toContain(
      "this.buildStructureRenderer=new BuildStructureRenderer(this.scene);",
    );
    expect(runtime).toContain(
      "this.buildStructureRenderer.syncStructures(this.buildingSystem.store.getBuildingState())",
    );
    expect(runtime).toContain("private updateBuildPresentation():void");
  });

  it("updates preview, damage tint, reset, and disposal through the same renderer", () => {
    expect(runtime).toContain("this.buildStructureRenderer.showPreview(");
    expect(runtime).toContain("this.buildStructureRenderer.updateStructureDurability(");
    expect(runtime).toContain(
      "this.buildingSystem.reset();this.buildStructureRenderer.syncStructures(this.buildingSystem.store.getBuildingState());",
    );
    expect(runtime).toContain("this.buildStructureRenderer.dispose();");
  });
});
