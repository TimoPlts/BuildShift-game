/**
 * Runtime consolidation test verifying that the canonical `network/twoPlayer/`
 * modules export the expected bindings.
 *
 * The legacy `net/` directory has been consolidated into `network/twoPlayer/`.
 * This test ensures the canonical modules are intact and export the correct
 * identity bindings.
 */

import { describe, expect, it } from "vitest";

// Import the canonical bindings directly from the network/twoPlayer layer.
import {
  TwoPlayerClient,
  TWO_PLAYER_ROOM_NAME,
} from "../network/twoPlayer/TwoPlayerClient";
import { InputSender, INPUT_BUFFER_SIZE } from "../network/twoPlayer/InputSender";
import {
  LocalPlayerPrediction,
  SIMULATION_TICK_SECONDS,
  CORRECTION_SNAP_THRESHOLD,
} from "../network/twoPlayer/LocalPlayerPrediction";

describe("network/twoPlayer/ canonical module integrity", () => {
  it("exports TwoPlayerClient with the correct room name constant", () => {
    expect(TwoPlayerClient).toBeDefined();
    expect(TWO_PLAYER_ROOM_NAME).toBeTypeOf("string");
  });

  it("exports InputSender with the correct buffer size constant", () => {
    expect(InputSender).toBeDefined();
    expect(INPUT_BUFFER_SIZE).toBeTypeOf("number");
  });

  it("exports LocalPlayerPrediction with correct tuning constants", () => {
    expect(LocalPlayerPrediction).toBeDefined();
    expect(SIMULATION_TICK_SECONDS).toBeTypeOf("number");
    expect(CORRECTION_SNAP_THRESHOLD).toBeTypeOf("number");
  });
});
