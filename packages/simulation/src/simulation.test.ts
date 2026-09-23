import { describe, expect, it } from "vitest";
import { SIMULATION_VERSION, gameConfigVersion } from "./index.js";
import { GAME_CONFIG_VERSION } from "@buildshift/game-config";

describe("simulation scaffold", () => {
  it("exposes a simulation version", () => {
    expect(SIMULATION_VERSION).toBe("0.1.0");
  });

  it("resolves the shared game-config version across the workspace", () => {
    expect(gameConfigVersion()).toBe(GAME_CONFIG_VERSION);
  });
});
