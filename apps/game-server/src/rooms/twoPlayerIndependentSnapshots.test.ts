/**
 * Colyseus integration test: two mock clients send distinct movement inputs
 * and verify that each client's received state snapshot reflects its own
 * independent position.
 *
 * Scenario:
 *  1. An in-process Colyseus server is started and two real `@colyseus/sdk`
 *     client sessions join the canonical `TwoPlayerMovementRoom`.
 *  2. Client A sends a "move forward" input (moveZ = -1, yaw 0 → world -Z).
 *  3. Client B sends a "move right" input (moveX = 1, yaw 0 → world -X).
 *  4. We wait (via bounded polling on `lastProcessedSequence`) until both inputs
 *     have been authoritatively processed.
 *  5. We assert that each client's state snapshot shows the correct
 *     independent displacement:
 *        - A's Z decreased (moved forward); A's X is unchanged.
 *        - B's X decreased (moved right); B's Z is unchanged.
 *        - A's full position differs from B's full position (independence).
 *  6. Cleanup: both clients leave, server is shut down.
 *
 * Determinism:
 *  - We await the `lastProcessedSequence` field reaching the expected value
 *    (proving the server tick consumed the input) rather than sleeping for
 *    a fixed wall-clock duration.
 *  - A short additional bounded wait allows the state patch to propagate
 *    from the server's schema to each client's decoded state.
 *  - All waits have explicit deadlines so CI cannot hang.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";

import { VERTICAL_MOVEMENT, PLAYER_MOVEMENT } from "@buildshift/game-config";

import { startServer, shutdownServer } from "../server.js";
import type { GameServer } from "../server.js";
import {
  TWO_PLAYER_MOVEMENT_ROOM,
  TWO_PLAYER_MOVEMENT_INPUT,
} from "./TwoPlayerMovementRoom.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (same bounded-polling patterns as twoPlayerMovementRoom.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bounded polling wait: resolves when the predicate holds or the deadline
 * passes (explicit timeout → CI can never hang).
 */
async function waitForState(
  room: ClientRoom,
  predicate: (state: any) => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const startedAt = Date.now();
  if (room.state && predicate(room.state)) return;
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((r) => setTimeout(r, 25));
    if (room.state && predicate(room.state)) return;
  }
  throw new Error(
    `waitForState timed out after ${timeoutMs}ms; last state=${JSON.stringify(
      room.state,
    )}`,
  );
}

/** Wait a fixed duration. */
function waitMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Read the server-side player entry from the client-decoded state. */
function playerFromState(state: any, sessionId: string): any {
  const players = state?.players;
  if (!players) return undefined;
  if (typeof players.get === "function") return players.get(sessionId);
  return players[sessionId];
}

/** Bounded teardown of a client room + connection. */
async function teardownRoom(room: ClientRoom | null): Promise<void> {
  if (!room) return;
  room.leave().catch(() => {
    /* already gone — ignore */
  });
  try {
    room.connection.close();
  } catch {
    /* connection already closed — ignore */
  }
}

/** Wrap a promise with a deadline. */
async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `[two-player-snapshots-test] timeout: "${label}" did not finish within ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test fixture
// ─────────────────────────────────────────────────────────────────────────────

/** The expected per-tick displacement magnitude at 30 Hz with moveSpeed 6. */
const DISPLACEMENT_PER_TICK = PLAYER_MOVEMENT.moveSpeed * (1 / 30); // 0.2 m

describe("Colyseus integration: two mock clients verify independent state snapshots", () => {
  let server: GameServer;
  let port: number;
  let roomA: ClientRoom;
  let roomB: ClientRoom;

  beforeAll(async () => {
    const started = await startServer(0);
    server = started.server;
    port = started.port;
    expect(port).toBeGreaterThan(0);

    const url = `ws://127.0.0.1:${port}`;

    // Join two client sessions to the same room.
    roomA = await withDeadline(
      new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM),
      10_000,
      "join room A",
    );
    roomB = await withDeadline(
      new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM),
      10_000,
      "join room B",
    );

    // Both clients are in the same room with distinct session ids.
    expect(roomA.sessionId).toEqual(expect.any(String));
    expect(roomB.sessionId).toEqual(expect.any(String));
    expect(roomA.sessionId).not.toBe(roomB.sessionId);
    expect(roomA.roomId).toBe(roomB.roomId);
  }, 20_000);

  afterAll(async () => {
    await withDeadline(
      Promise.all([teardownRoom(roomB), teardownRoom(roomA)]),
      5_000,
      "teardown rooms",
    );
    await withDeadline(shutdownServer(server), 8_000, "shutdownServer");
  }, 20_000);

  // ─────────────────────────────────────────────────────────────────────────────
  // Setup: wait until both players are visible in both clients' state
  // ─────────────────────────────────────────────────────────────────────────────

  it("setup: both players appear in the room state at their spawn positions", async () => {
    // Wait until both players are visible in both clients' state.
    await waitForState(
      roomA,
      (s) =>
        playerFromState(s, roomA.sessionId) &&
        playerFromState(s, roomB.sessionId),
    );
    await waitForState(
      roomB,
      (s) =>
        playerFromState(s, roomA.sessionId) &&
        playerFromState(s, roomB.sessionId),
    );

    // Verify spawn positions:
    // Player A (first to join) at x = -5, y = ground, z = 0.
    const playerA = playerFromState(roomA.state, roomA.sessionId);
    expect(playerA).toBeDefined();
    expect(playerA.x).toBeCloseTo(-5, 1);
    expect(playerA.y).toBeCloseTo(VERTICAL_MOVEMENT.groundY, 1);
    expect(playerA.z).toBeCloseTo(0, 1);
    expect(playerA.grounded).toBe(true);

    // Player B (second to join) at x = +5, y = ground, z = 0.
    const playerB = playerFromState(roomB.state, roomB.sessionId);
    expect(playerB).toBeDefined();
    expect(playerB.x).toBeCloseTo(5, 1);
    expect(playerB.y).toBeCloseTo(VERTICAL_MOVEMENT.groundY, 1);
    expect(playerB.z).toBeCloseTo(0, 1);
    expect(playerB.grounded).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Core test: both clients send distinct movement inputs simultaneously
  // ─────────────────────────────────────────────────────────────────────────────

  it("each client receives an independent state snapshot reflecting its own movement", async () => {
    // ── Send distinct movement inputs ───────────────────────────────────────────
    //
    // Client A: "move forward" → moveZ = -1, lookYaw = 0
    //   World-space direction: (0, -1) → displacement in -Z
    //
    // Client B: "move right" → moveX = 1, lookYaw = 0
    //   World-space direction: (-1, 0) → displacement in -X
    //
    // Both use sequence 0 (first input; lastProcessedSequence starts at -1).

    roomA.send(TWO_PLAYER_MOVEMENT_INPUT, {
      sequence: 0,
      moveX: 0,
      moveZ: -1, // forward (yaw 0 → -Z world)
      lookYaw: 0,
      lookPitch: 0,
      jump: false,
      sprint: false,
      crouch: false,
      primaryFire: false,
      secondaryFire: false,
    });

    roomB.send(TWO_PLAYER_MOVEMENT_INPUT, {
      sequence: 0,
      moveX: 1, // right (yaw 0 → -X world)
      moveZ: 0,
      lookYaw: 0,
      lookPitch: 0,
      jump: false,
      sprint: false,
      crouch: false,
      primaryFire: false,
      secondaryFire: false,
    });

    // ── Wait until both inputs have been authoritatively processed ──────────────
    //
    // `lastProcessedSequence` is written to the wire schema on the tick that
    // consumes the input. When both reach 0, the server has stepped both
    // players with their respective movement inputs.

    await waitForState(
      roomA,
      (s) => {
        const p = playerFromState(s, roomA.sessionId);
        return p && p.lastProcessedSequence >= 0;
      },
      5_000,
    );
    await waitForState(
      roomB,
      (s) => {
        const p = playerFromState(s, roomB.sessionId);
        return p && p.lastProcessedSequence >= 0;
      },
      5_000,
    );

    // ── Allow one additional patch cycle for positions to settle ────────────────
    //
    // The `lastProcessedSequence` is updated in the same tick as the position,
    // but the Colyseus state patch carrying the position change may arrive
    // one micro-tick after the one carrying the sequence update. A short
    // bounded wait ensures both fields are consistently visible.
    await waitMs(100);

    // ── Assert independent state snapshots ─────────────────────────────────────

    // Read each client's view of the room state.
    const aInAState = playerFromState(roomA.state, roomA.sessionId);
    const bInAState = playerFromState(roomA.state, roomB.sessionId);
    const aInBState = playerFromState(roomB.state, roomA.sessionId);
    const bInBState = playerFromState(roomB.state, roomB.sessionId);

    // ── Client A's own snapshot: moved forward in -Z, X unchanged ──────────────
    expect(aInAState).toBeDefined();
    expect(aInAState.lastProcessedSequence).toBe(0);

    // A moved forward: z decreased by approximately DISPLACEMENT_PER_TICK.
    // The exact value depends on how many ticks the server ran between
    // joining and sending input (during which neutral ticks keep z at 0),
    // so we assert the DIRECTION and a reasonable BOUND rather than an
    // exact displacement.
    expect(aInAState.z).toBeLessThan(0);
    // At most a few ticks' worth of forward movement (the input is consumed
    // on the next tick after send; no further forward movement occurs after
    // that because subsequent ticks use neutral input).
    expect(aInAState.z).toBeGreaterThan(-DISPLACEMENT_PER_TICK * 3);

    // A did NOT move in the X direction (its input had moveX=0).
    expect(Math.abs(aInAState.x - (-5))).toBeLessThan(0.1);

    // ── Client B's own snapshot: moved right in -X, Z unchanged ────────────────
    expect(bInBState).toBeDefined();
    expect(bInBState.lastProcessedSequence).toBe(0);

    // B moved right: x decreased (toward 0) by approximately
    // DISPLACEMENT_PER_TICK per tick of input.
    expect(bInBState.x).toBeLessThan(5);
    expect(bInBState.x).toBeGreaterThan(5 - DISPLACEMENT_PER_TICK * 3);

    // B did NOT move in the Z direction (its input had moveZ=0).
    expect(Math.abs(bInBState.z)).toBeLessThan(0.1);

    // ── Both clients see the same authoritative state (consistency) ────────────
    //
    // Client A's view of player A should match client B's view of player A,
    // and vice versa. Both clients receive the same Colyseus state patch.

    expect(aInAState.x).toBeCloseTo(aInBState.x, 2);
    expect(aInAState.z).toBeCloseTo(aInBState.z, 2);
    expect(bInAState.x).toBeCloseTo(bInBState.x, 2);
    expect(bInAState.z).toBeCloseTo(bInBState.z, 2);

    // ── Independence: A's position ≠ B's position ──────────────────────────────
    //
    // The two players occupy distinct positions, proving the server
    // tracked them independently and the snapshots are per-player.

    const aPosKey = `${aInAState.x.toFixed(2)},${aInAState.y.toFixed(2)},${aInAState.z.toFixed(2)}`;
    const bPosKey = `${bInBState.x.toFixed(2)},${bInBState.y.toFixed(2)},${bInBState.z.toFixed(2)}`;
    expect(aPosKey).not.toBe(bPosKey);

    // A is still near x=-5; B moved away from x=+5 toward the center.
    // Their X positions should differ significantly.
    expect(Math.abs(aInAState.x - bInBState.x)).toBeGreaterThan(2);
  });
});
