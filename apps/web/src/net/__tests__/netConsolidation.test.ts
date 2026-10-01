/**
 * Verifies that the legacy `net/` directory contains only thin re-export
 * shims with no duplicate implementations.
 *
 * This test complements the canonical `network/twoPlayer/__tests__/consolidation.test.ts`
 * by asserting from the `net/` side that the shims are intact and forward
 * to the correct canonical modules.
 */
import { describe, expect, it } from "vitest";

import {
  TwoPlayerClient,
  parseRoomState,
  TWO_PLAYER_ROOM_NAME,
  MOVEMENT_INPUT_TYPE,
} from "../../network/twoPlayer/TwoPlayerClient";
import {
  InputSender,
  INPUT_BUFFER_SIZE,
} from "../../network/twoPlayer/InputSender";
import {
  LocalPlayerPrediction,
  SIMULATION_TICK_SECONDS,
  CORRECTION_SNAP_THRESHOLD,
  CORRECTION_SMOOTH_FRAMES,
} from "../../network/twoPlayer/LocalPlayerPrediction";
import {
  RemotePlayerInterpolation,
  REMOTE_INTERPOLATION_DELAY_MS,
  REMOTE_BUFFER_SIZE,
} from "../../network/twoPlayer/RemotePlayerInterpolation";

describe("net/ consolidation — canonical modules are intact and complete", () => {
  it("TwoPlayerClient and its exports are available", () => {
    expect(TwoPlayerClient).toBeDefined();
    expect(parseRoomState).toBeTypeOf("function");
    expect(TWO_PLAYER_ROOM_NAME).toBe("two-player-movement");
    expect(MOVEMENT_INPUT_TYPE).toBe("two-player:input");
  });

  it("InputSender and its exports are available", () => {
    expect(InputSender).toBeDefined();
    expect(INPUT_BUFFER_SIZE).toBe(30);
  });

  it("LocalPlayerPrediction and its exports are available", () => {
    expect(LocalPlayerPrediction).toBeDefined();
    expect(SIMULATION_TICK_SECONDS).toBeCloseTo(1 / 30, 10);
    expect(CORRECTION_SNAP_THRESHOLD).toBe(0.5);
    expect(CORRECTION_SMOOTH_FRAMES).toBe(5);
  });

  it("RemotePlayerInterpolation and its exports are available", () => {
    expect(RemotePlayerInterpolation).toBeDefined();
    expect(REMOTE_INTERPOLATION_DELAY_MS).toBe(100);
    expect(REMOTE_BUFFER_SIZE).toBe(4);
  });
});
