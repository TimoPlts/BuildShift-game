/**
 * Verifies that the legacy `net/` re-export shims correctly forward to
 * the canonical `network/twoPlayer/` modules.
 *
 * These tests assert identity (same reference) between the shim exports
 * and the canonical module exports, proving no duplicate implementations
 * exist.
 */
import { describe, expect, it } from "vitest";

// Canonical modules
import {
  TwoPlayerClient,
  InputSender,
  LocalPlayerPrediction,
  RemotePlayerInterpolation,
  TWO_PLAYER_ROOM_NAME,
  INPUT_BUFFER_SIZE,
  SIMULATION_TICK_SECONDS,
} from "../network/twoPlayer";

// Legacy shims
import { ConnectionManager } from "./ConnectionManager";
import { InputSender as LegacyInputSender } from "./InputSender";
import { LocalPlayerPredictor } from "./LocalPlayerPredictor";
import {
  TwoPlayerClient as IndexTwoPlayerClient,
  InputSender as IndexInputSender,
  LocalPlayerPrediction as IndexLocalPlayerPrediction,
  RemotePlayerInterpolation as IndexRemotePlayerInterpolation,
  TWO_PLAYER_ROOM_NAME as IndexRoomName,
  INPUT_BUFFER_SIZE as IndexBufferSize,
  SIMULATION_TICK_SECONDS as IndexTickSeconds,
} from "./index";

describe("net/ legacy re-export shims — identity with canonical modules", () => {
  it("ConnectionManager is the same class as TwoPlayerClient", () => {
    expect(ConnectionManager).toBe(TwoPlayerClient);
  });

  it("InputSender shim is the same class as the canonical InputSender", () => {
    expect(LegacyInputSender).toBe(InputSender);
  });

  it("LocalPlayerPredictor shim is the same class as LocalPlayerPrediction", () => {
    expect(LocalPlayerPredictor).toBe(LocalPlayerPrediction);
  });

  it("index.ts re-exports the same TwoPlayerClient", () => {
    expect(IndexTwoPlayerClient).toBe(TwoPlayerClient);
  });

  it("index.ts re-exports the same InputSender", () => {
    expect(IndexInputSender).toBe(InputSender);
  });

  it("index.ts re-exports the same LocalPlayerPrediction", () => {
    expect(IndexLocalPlayerPrediction).toBe(LocalPlayerPrediction);
  });

  it("index.ts re-exports the same RemotePlayerInterpolation", () => {
    expect(IndexRemotePlayerInterpolation).toBe(RemotePlayerInterpolation);
  });

  it("index.ts re-exports the same constants", () => {
    expect(IndexRoomName).toBe(TWO_PLAYER_ROOM_NAME);
    expect(IndexBufferSize).toBe(INPUT_BUFFER_SIZE);
    expect(IndexTickSeconds).toBe(SIMULATION_TICK_SECONDS);
  });
});
