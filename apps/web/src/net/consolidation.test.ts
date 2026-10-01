/**
 * Consolidation verification for the legacy `net/` module.
 *
 * The two-player networking code was consolidated from `src/net/` into
 * `src/network/twoPlayer/`. The old `src/net/` files were reduced to pure
 * re-export stubs kept only for backward compatibility. This test locks in
 * that invariant so it can never silently drift:
 *
 *   - every symbol a `net/` stub re-exports must be the EXACT SAME binding as
 *     the canonical `network/twoPlayer` module it points at (strict `toBe` on
 *     the shared reference / value), and
 *   - the stub must not introduce its own implementation.
 *
 * If a stub ever starts carrying its own logic — or repoints anywhere other
 * than `network/twoPlayer/` — these reference-equality checks fail.
 */
import { describe, expect, it } from "vitest";

// Legacy stubs (backward-compat re-exports) — the module under verification.
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
  CORRECTION_SMOOTH_FRAMES as LegacySmooth,
} from "./LocalPlayerPredictor";

// Canonical modules living in network/twoPlayer (the consolidation target).
import {
  TwoPlayerClient,
  TWO_PLAYER_ROOM_NAME,
} from "../network/twoPlayer/TwoPlayerClient";
import {
  InputSender,
  INPUT_BUFFER_SIZE,
} from "../network/twoPlayer/InputSender";
import {
  LocalPlayerPrediction,
  SIMULATION_TICK_SECONDS,
  CORRECTION_SNAP_THRESHOLD,
  CORRECTION_SMOOTH_FRAMES,
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
    expect(LegacySmooth).toBe(CORRECTION_SMOOTH_FRAMES);
  });

  it("exposes the canonical twoPlayer surface through the stubs (single source of truth)", () => {
    // All three stubs resolve to the same underlying module instances that
    // the canonical network/twoPlayer layer exports.
    expect(LegacyTwoPlayerClient).toBe(TwoPlayerClient);
    expect(LegacyInputSender).toBe(InputSender);
    expect(LegacyPrediction).toBe(LocalPlayerPrediction);
  });
});
