/**
 * Runtime consolidation test for `apps/web/src/net/`.
 *
 * Verifies that the legacy `net/` stubs re-export the exact same bindings
 * (same function/class/constant identity) as the canonical
 * `network/twoPlayer/` modules. This guards against a future refactor
 * silently replacing a re-export with a copy or a different implementation.
 *
 * The audit test (`__tests__/netConsolidation.test.ts`) checks the *shape*
 * of the stubs (source-level). This test checks the *runtime* behavior
 * (binding identity).
 */

import { describe, expect, it } from "vitest";

// Import the same named exports from the legacy stubs, aliased for clarity.
import {
  TwoPlayerClient as LegacyTwoPlayerClient,
  TWO_PLAYER_ROOM_NAME as LegacyRoomName,
} from "./ConnectionManager";
import {
  InputSender as LegacyInputSender,
  INPUT_BUFFER_SIZE as LegacyBufferSize,
} from "./InputSender";
import {
  LocalPlayerPrediction as LegacyPrediction,
  SIMULATION_TICK_SECONDS as LegacyTick,
  CORRECTION_SNAP_THRESHOLD as LegacySnap,
} from "./LocalPlayerPredictor";

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

describe("net/ consolidation -> network/twoPlayer/", () => {
  it("net/ConnectionManager re-exports the canonical TwoPlayerClient binding", () => {
    expect(LegacyTwoPlayerClient).toBe(TwoPlayerClient);
    expect(LegacyRoomName).toBe(TWO_PLAYER_ROOM_NAME);
  });

  it("net/InputSender re-exports the canonical InputSender binding", () => {
    expect(LegacyInputSender).toBe(InputSender);
    expect(LegacyBufferSize).toBe(INPUT_BUFFER_SIZE);
  });

  it("net/LocalPlayerPredictor re-exports the canonical LocalPlayerPrediction binding", () => {
    expect(LegacyPrediction).toBe(LocalPlayerPrediction);
    expect(LegacyTick).toBe(SIMULATION_TICK_SECONDS);
    expect(LegacySnap).toBe(CORRECTION_SNAP_THRESHOLD);
  });

  it("exposes the canonical twoPlayer surface through the stubs (single source of truth)", () => {
    // All three stubs resolve to the same underlying module instances as
    // the canonical network/twoPlayer layer exports.
    expect(LegacyTwoPlayerClient).toBe(TwoPlayerClient);
    expect(LegacyInputSender).toBe(InputSender);
    expect(LegacyPrediction).toBe(LocalPlayerPrediction);
  });
});
