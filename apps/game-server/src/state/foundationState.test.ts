/**
 * Foundation state schema smoke test (Stage P7B-B).
 *
 * A tiny, dependency-free smoke test for the pure `foundationState` module.
 * It exercises ONLY the exported schema definitions (no Rapier WASM, no
 * running server), so it is fast and fully isolated. It proves:
 *   1. the exported values are well-formed (constructible schemas + the
 *      "no sequence acknowledged yet" sentinel); and
 *   2. a freshly constructed room state can hold one player entry that
 *      round-trips through the synchronized `players` map.
 *
 * Behaviour is unchanged: this test imports and observes the module, it does
 * not mutate any runtime code path.
 */
import { describe, expect, it } from "vitest";

import {
  FoundationRoomState,
  NO_SEQUENCE_ACKNOWLEDGED,
  PlayerState,
  PositionState,
} from "./foundationState.js";

describe("foundationState schemas (smoke)", () => {
  it("exports the room state schemas as constructible values", () => {
    expect(typeof FoundationRoomState).toBe("function");
    expect(typeof PlayerState).toBe("function");
    expect(typeof PositionState).toBe("function");
    expect(NO_SEQUENCE_ACKNOWLEDGED).toBe(-1);
  });

  it("round-trips a player entry through the room state players map", () => {
    const state = new FoundationRoomState();

    const player = new PlayerState();
    player.playerId = "session-1";
    player.position.x = 1;
    player.position.y = 2;
    player.position.z = 3;
    player.yaw = 0.5;
    player.acknowledgedSequence = NO_SEQUENCE_ACKNOWLEDGED;
    player.landed = true;

    state.players.set("session-1", player);

    expect(state.players.has("session-1")).toBe(true);
    const retrieved = state.players.get("session-1");
    expect(retrieved).toBe(player);

    // `MapSchema.get` is typed to return `undefined` for a missing key; the
    // assertions above prove it is present, so narrow for the typed reads.
    if (retrieved === undefined) {
      throw new Error("player entry did not round-trip through the players map");
    }

    // The nested `position` ref is a live PositionState instance.
    expect(retrieved.position).toBeInstanceOf(PositionState);
    expect(retrieved.position.x).toBe(1);
    expect(retrieved.position.y).toBe(2);
    expect(retrieved.position.z).toBe(3);
  });
});
