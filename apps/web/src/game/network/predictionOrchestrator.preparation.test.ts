/**
 * Preparation-strip prediction parity.
 *
 * While the authoritative server says preparation is running for this
 * session's side, client prediction must confine the local capsule to the
 * SAME shared row strip the server clamps with (`clampToPreparationZone`,
 * CONTRACT.md §6) — otherwise every snapshot rubber-bands the player back.
 * When the flag clears (arena opens / new round / reconnect), the strip is
 * released with no residual ghost walls, and the reconciliation replay of
 * still-unacknowledged inputs honours the active strip too.
 */
import { describe, expect, it } from "vitest";
import { PLAYER_COLLIDER } from "@buildshift/game-config";
import type { PlayerNetworkInput } from "@buildshift/protocol";
import { PredictionOrchestrator } from "./predictionOrchestrator";
import { getPreparationZone, clampToPreparationZone } from "../preparation/preparationContract";
import type { BufferedInput } from "./inputBatcher";

function buffer(sequence: number, moveX: number, moveZ: number): BufferedInput {
  const input = {
    sequence,
    moveX,
    moveZ,
    lookYaw: 0,
    jump: false,
    crouch: false,
  } as unknown as PlayerNetworkInput;
  return {
    input,
    predictedX: 0,
    predictedY: 0,
    predictedZ: 0,
    predictedVelocityY: 0,
    predictedGrounded: true,
  };
}

function drive(
  orchestrator: PredictionOrchestrator,
  ticks: number,
  moveX: number,
  moveZ = 0,
) {
  let state = orchestrator.getCurrentState();
  for (let i = 0; i < ticks; i++) {
    state = orchestrator.predict({ moveX, moveZ, yaw: 0, pitch: 0, jump: false, crouch: false });
  }
  return state;
}

/** Seed the reconciled pose directly (the row spawn centre). */
function seedAt(orchestrator: PredictionOrchestrator, x: number, z: number, sequence = 1): void {
  orchestrator.onServerState(
    { x, y: 0, z, yaw: 0, velocityY: 0, grounded: true, sequence },
    [],
  );
}

describe("PredictionOrchestrator preparation strip", () => {
  it("confines live prediction to the assigned negative row (radius inset)", () => {
    const orchestrator = new PredictionOrchestrator();
    orchestrator.setPreparationSide("negative");
    const zone = getPreparationZone("negative");
    seedAt(orchestrator, (zone.minX + zone.maxX) / 2, 0);
    // Push hard −X (yaw-0 basis: moveX +1 maps to world −X): stop at the strip edge.
    let state = drive(orchestrator, 200, 1);
    expect(state.x).toBeCloseTo(zone.minX + PLAYER_COLLIDER.radius, 9);
    // Push hard +X: stop at the strip's arena-facing edge — NOT the centre.
    state = drive(orchestrator, 400, -1);
    expect(state.x).toBeCloseTo(zone.maxX - PLAYER_COLLIDER.radius, 9);
  });

  it("allows full-z movement inside the row", () => {
    const orchestrator = new PredictionOrchestrator();
    orchestrator.setPreparationSide("positive");
    const zone = getPreparationZone("positive");
    const centreX = (zone.minX + zone.maxX) / 2;
    seedAt(orchestrator, centreX, 0);
    const state = drive(orchestrator, 200, 0, -1);
    expect(state.z).toBeGreaterThanOrEqual(zone.minZ + PLAYER_COLLIDER.radius - 1e-9);
    // Still locked in x.
    expect(state.x).toBeCloseTo(centreX, 9);
  });

  it("clearing the side releases the strip (no ghost walls after the arena opens)", () => {
    const orchestrator = new PredictionOrchestrator();
    orchestrator.setPreparationSide("negative");
    const zone = getPreparationZone("negative");
    seedAt(orchestrator, (zone.minX + zone.maxX) / 2, 0);
    drive(orchestrator, 100, -1); // parked at the inner edge
    orchestrator.setPreparationSide(null);
    const state = drive(orchestrator, 100, -1);
    expect(state.x).toBeGreaterThan(zone.maxX + 1);
  });

  it("replays buffered inputs through the same strip during reconciliation", () => {
    const orchestrator = new PredictionOrchestrator();
    orchestrator.setPreparationSide("negative");
    const zone = getPreparationZone("negative");
    const inside = clampToPreparationZone({ x: zone.minX + 1, z: 0 }, PLAYER_COLLIDER.radius, "negative");
    orchestrator.onServerState(
      {
        x: inside.x,
        y: 0,
        z: inside.z,
        yaw: 0,
        velocityY: 0,
        grounded: true,
        sequence: 10,
      },
      // Unacknowledged inputs spoofed far outside the strip: the replay must
      // clamp them exactly like the server does.
      [11, 12, 13, 14, 15].map((s) => buffer(s, -1, 0)),
    );
    const state = orchestrator.getCurrentState();
    expect(state.x).toBeGreaterThanOrEqual(zone.minX + PLAYER_COLLIDER.radius - 1e-9);
    expect(state.x).toBeLessThanOrEqual(zone.maxX - PLAYER_COLLIDER.radius + 1e-9);
  });

  it("reset() does NOT silently drop the assignment (room-scoped lifecycle state)", () => {
    const orchestrator = new PredictionOrchestrator();
    orchestrator.setPreparationSide("positive");
    orchestrator.reset();
    expect(orchestrator.preparationSide).toBe("positive");
    orchestrator.setPreparationSide(null);
    expect(orchestrator.preparationSide).toBeNull();
  });
});
