/**
 * Client prediction applies the same authoritative arena boundary as the
 * room (structure collision, then PLAYABLE_ARENA_BOUNDS), so a player
 * pushing into the edge predicts exactly the server's stopping position
 * instead of running ahead and being corrected back every snapshot.
 */
import { describe, expect, it } from "vitest";
import { PLAYABLE_ARENA_BOUNDS, PLAYER_COLLIDER } from "@buildshift/game-config";
import { PredictionOrchestrator } from "./predictionOrchestrator";

describe("PredictionOrchestrator arena bounds", () => {
  it("stops predicted movement at the authoritative boundary", () => {
    const orchestrator = new PredictionOrchestrator();
    let state = orchestrator.predict({ moveX: 0, moveZ: -1, yaw: 0, pitch: 0, jump: false, crouch: false });
    for (let i = 0; i < 200; i++) {
      state = orchestrator.predict({ moveX: 0, moveZ: -1, yaw: 0, pitch: 0, jump: false, crouch: false });
      expect(state.z).toBeGreaterThanOrEqual(PLAYABLE_ARENA_BOUNDS.minZ + PLAYER_COLLIDER.radius - 1e-9);
    }
    expect(state.z).toBeCloseTo(PLAYABLE_ARENA_BOUNDS.minZ + PLAYER_COLLIDER.radius, 9);
  });
});
