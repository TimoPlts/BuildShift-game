/**
 * Smoke test for the protocol package's public export surface.
 *
 * This verifies that every canonical public export can be imported and is
 * correctly shaped. It acts as the **typecheck gate** for the protocol
 * package: if a future refactor accidentally removes or renames an export,
 * this test will fail at both the type level (import error) and the runtime
 * level (undefined export).
 *
 * It intentionally does not exercise behavior — only the identity and
 * shape of the public surface.
 */
import { describe, expect, it } from "vitest";
import {
  // ─── Constants ─────────────────────────────────────────────────────────────────────
  PROTOCOL_VERSION,
  PLAYER_INPUT_LIMITS,
  PLAYER_NETWORK_INPUT_LIMITS,
  ROOMS,
  EVENTS,
  GAME_MODES,
  GAME_MODE_IDS,
  PlayerPositionSemantic,

  // ─── Functions ─────────────────────────────────────────────────────────────────────
  validatePlayerInputFrame,
  validatePlayerNetworkInput,

  // ─── Schema classes ──────────────────────────────────────────────────────────────────
  PlayerStateSchema,
  RoomStateSchema,

  // ─── Types (compile-time only — imported to verify they resolve) ───
  type PlayerInputFrame,
  type PlayerNetworkInput,
  type AuthoritativePlayerState,
  type RoomType,
  type EventName,
  type GameMode,
  type GameModeId,
  type ProtocolValidation,
  type PlayerStateSchemaInstance,
  type RoomStateSchemaInstance,
  type MovementInput,
  type PlayerNetworkState,
  type GameStateSchema,
} from "./index.js";

// ─── Compile-time type assertions ─────────────────────────────────────────────────────
//
// These are no-op assignments that the compiler checks. If any of the
// imported types were removed or mistyped, `tsc` would emit an error
// here, even though the runtime values are not exercised.

/** Verifies PlayerInputFrame is a structurally correct object type. */
function _assertPlayerInputFrame(frame: PlayerInputFrame): number {
  return frame.sequence;
}

/** Verifies PlayerNetworkInput is a structurally correct object type. */
function _assertPlayerNetworkInput(input: PlayerNetworkInput): number {
  return input.sequence;
}

/** Verifies AuthoritativePlayerState has the expected shape. */
function _assertAuthoritativePlayerState(state: AuthoritativePlayerState): string {
  return state.playerId;
}

/** Verifies RoomType is a string literal union. */
function _assertRoomType(room: RoomType): string {
  return room;
}

/** Verifies EventName is a string literal union. */
function _assertEventName(event: EventName): string {
  return event;
}

/** Verifies GameModeId is a string literal union derived from GAME_MODES. */
function _assertGameModeId(mode: GameModeId): string {
  return mode;
}

/** Verifies GameMode (legacy) is a string literal union. */
function _assertGameMode(mode: GameMode): string {
  return mode;
}

/** Verifies ProtocolValidation<T> is a discriminated union. */
function _assertProtocolValidation<T>(result: ProtocolValidation<T>): boolean {
  return result.ok;
}

/** Verifies PlayerStateSchemaInstance has the expected numeric fields. */
function _assertPlayerStateSchemaInstance(p: PlayerStateSchemaInstance): number {
  return p.x;
}

/** Verifies RoomStateSchemaInstance has a players map. */
function _assertRoomStateSchemaInstance(r: RoomStateSchemaInstance): unknown {
  return r.players;
}

/** Verifies MovementInput is a structurally correct object type. */
function _assertMovementInput(input: MovementInput): number {
  return input.sequence;
}

/** Verifies PlayerNetworkState is a structurally correct object type. */
function _assertPlayerNetworkState(state: PlayerNetworkState): number {
  return state.x;
}

/** Verifies GameStateSchema is a structurally correct object type. */
function _assertGameStateSchema(s: GameStateSchema): Record<string, PlayerNetworkState> {
  return s.players;
}

describe("protocol public exports — constants", () => {
  it("exposes PROTOCOL_VERSION as a string", () => {
    expect(typeof PROTOCOL_VERSION).toBe("string");
    expect(PROTOCOL_VERSION.length).toBeGreaterThan(0);
  });

  it("exposes PLAYER_INPUT_LIMITS with the expected bounds", () => {
    expect(PLAYER_INPUT_LIMITS.sequenceMin).toBe(0);
    expect(PLAYER_INPUT_LIMITS.movementMin).toBe(-1);
    expect(PLAYER_INPUT_LIMITS.movementMax).toBe(1);
    expect(PLAYER_INPUT_LIMITS.pitchMin).toBeCloseTo(-Math.PI);
    expect(PLAYER_INPUT_LIMITS.pitchMax).toBeCloseTo(Math.PI);
  });

  it("exposes PLAYER_NETWORK_INPUT_LIMITS with the expected bounds", () => {
    expect(PLAYER_NETWORK_INPUT_LIMITS.sequenceMin).toBe(0);
    expect(PLAYER_NETWORK_INPUT_LIMITS.movementMin).toBe(-1);
    expect(PLAYER_NETWORK_INPUT_LIMITS.movementMax).toBe(1);
    expect(PLAYER_NETWORK_INPUT_LIMITS.pitchMin).toBeCloseTo(-Math.PI);
    expect(PLAYER_NETWORK_INPUT_LIMITS.pitchMax).toBeCloseTo(Math.PI);
  });

  it("exposes ROOMS with the foundation room identifier", () => {
    expect(ROOMS.FOUNDATION).toBe("foundation");
  });

  it("exposes EVENTS with the player-input event identifier", () => {
    expect(EVENTS.PLAYER_INPUT).toBe("player:input");
  });

  it("exposes GAME_MODES with the box-fight identifier", () => {
    expect(GAME_MODES.BOX_FIGHT).toBe("box-fight");
  });

  it("exposes GAME_MODE_IDS as a tuple of all valid mode identifiers", () => {
    expect(Array.isArray(GAME_MODE_IDS)).toBe(true);
    expect(GAME_MODE_IDS).toContain("box-fight");
    expect(GAME_MODE_IDS).toContain("king-of-the-tower");
  });

  it("exposes PlayerPositionSemantic with the capsule-center kind", () => {
    expect(PlayerPositionSemantic.kind).toBe("capsule-center");
  });
});

describe("protocol public exports — functions", () => {
  it("exposes validatePlayerInputFrame as a function", () => {
    expect(typeof validatePlayerInputFrame).toBe("function");
  });

  it("exposes validatePlayerNetworkInput as a function", () => {
    expect(typeof validatePlayerNetworkInput).toBe("function");
  });
});

describe("protocol public exports — Colyseus schema classes", () => {
  it("exposes PlayerStateSchema as a constructible class", () => {
    expect(typeof PlayerStateSchema).toBe("function");
  });

  it("exposes RoomStateSchema as a constructible class", () => {
    expect(typeof RoomStateSchema).toBe("function");
  });
});

describe("protocol public exports — compile-time type gate", () => {
  it("all type-level assertions compile without error (this test proves the imports resolve)", () => {
    // These functions exist only to be type-checked. They are intentionally
    // not called — the mere presence of their typed parameters is the gate.
    // If any imported type were missing or mistyped, `tsc` would fail before
    // this test even runs.
    expect(_assertPlayerInputFrame).toBeTypeOf("function");
    expect(_assertPlayerNetworkInput).toBeTypeOf("function");
    expect(_assertAuthoritativePlayerState).toBeTypeOf("function");
    expect(_assertRoomType).toBeTypeOf("function");
    expect(_assertEventName).toBeTypeOf("function");
    expect(_assertGameModeId).toBeTypeOf("function");
    expect(_assertGameMode).toBeTypeOf("function");
    expect(_assertProtocolValidation).toBeTypeOf("function");
    expect(_assertPlayerStateSchemaInstance).toBeTypeOf("function");
    expect(_assertRoomStateSchemaInstance).toBeTypeOf("function");
    expect(_assertMovementInput).toBeTypeOf("function");
    expect(_assertPlayerNetworkState).toBeTypeOf("function");
    expect(_assertGameStateSchema).toBeTypeOf("function");
  });
});
