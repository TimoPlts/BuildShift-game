/**
 * Stage 2D (consolidated) — canonical two-player movement room integration tests.
 *
 * These tests use two real `@colyseus/sdk` clients against one real Colyseus
 * server and the canonical `TwoPlayerMovementRoom`, proving:
 *
 *  1. Two players can join and their states appear in the room state.
 *  2. Sending a valid input updates the player's position after a tick.
 *  3. Sending an out-of-order (lower sequence) input is rejected
 *     (position unchanged).
 *  4. A player leaving removes their state.
 *
 * All waits use bounded polling helpers with explicit timeouts so CI cannot
 * hang.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";

import { VERTICAL_MOVEMENT } from "@buildshift/game-config";
import { MatchPhase } from "@buildshift/protocol";

import { startServer, shutdownServer } from "../server.js";
import type { GameServer } from "../server.js";
import {
  TWO_PLAYER_MOVEMENT_ROOM,
  TWO_PLAYER_MOVEMENT_INPUT,
} from "./TwoPlayerMovementRoom.js";

/** Bounded polling wait: resolves when the predicate holds or the deadline
 *  passes (explicit timeout → CI can never hang). */
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

/** Wait a fixed duration (for letting ticks elapse). */
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

function matchPhase(state: unknown): string {
  return (state as Record<string, any>)?.matchPhase as string ?? "";
}

/** Wait until the room has left its pre-round COUNTDOWN and is IN_PROGRESS,
 *  i.e. the round in which movement inputs are authoritatively processed. */
async function waitForPlaying(
  room: ClientRoom,
  timeoutMs = 8_000,
): Promise<void> {
  await waitForState(
    room,
    (s) => matchPhase(s) === MatchPhase.IN_PROGRESS,
    timeoutMs,
  );
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
              `[two-player-movement-test] timeout: "${label}" did not finish within ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe("Stage 2D canonical two-player movement room", () => {
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
    expect(roomA.sessionId).toEqual(expect.any(String));
    expect(roomB.sessionId).toEqual(expect.any(String));
    expect(roomA.sessionId).not.toBe(roomB.sessionId);
    // Both rooms are the same room instance.
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

  // ─── Test 1: Two players can join and their states appear ────────────────────

  it("two players can join and their states appear in the room state", async () => {
    // Wait until both players are visible in both clients' state.
    await waitForState(
      roomA,
      (s) => playerFromState(s, roomA.sessionId) && playerFromState(s, roomB.sessionId),
    );
    await waitForState(
      roomB,
      (s) => playerFromState(s, roomA.sessionId) && playerFromState(s, roomB.sessionId),
    );

    // Verify spawn positions:
    // Player A (first to join) at x = -5.
    const playerA = playerFromState(roomA.state, roomA.sessionId);
    expect(playerA).toBeDefined();
    expect(playerA.x).toBeCloseTo(-5, 1);
    expect(playerA.y).toBeCloseTo(VERTICAL_MOVEMENT.groundY, 1);
    expect(playerA.z).toBeCloseTo(0, 1);

    // Player B (second to join) at x = +5.
    const playerB = playerFromState(roomA.state, roomB.sessionId);
    expect(playerB).toBeDefined();
    expect(playerB.x).toBeCloseTo(5, 1);
    expect(playerB.y).toBeCloseTo(VERTICAL_MOVEMENT.groundY, 1);
    expect(playerB.z).toBeCloseTo(0, 1);

    // Both players are grounded with zero velocity.
    expect(playerA.grounded).toBe(true);
    expect(playerA.velocityY).toBeCloseTo(0, 2);
    expect(playerB.grounded).toBe(true);
    expect(playerB.velocityY).toBeCloseTo(0, 2);
  });

  // ─── Test 2: Sending a valid input updates position after a tick ────────────

  it("sending a valid input updates the player's position after a tick", async () => {
    // Wait for the pre-round countdown to finish; movement inputs are only
    // processed while the round is IN_PROGRESS.
    await waitForPlaying(roomA);

    // Record A's current position.
    const aBefore = playerFromState(roomA.state, roomA.sessionId);
    const xBefore = aBefore.x;
    const zBefore = aBefore.z;

    // Send a valid forward-movement input (moveZ = -1 → forward at yaw 0).
    roomA.send(TWO_PLAYER_MOVEMENT_INPUT, {
      sequence: 0,
      moveX: 0,
      moveZ: -1,
      lookYaw: 0,
      lookPitch: 0,
      jump: false,
      sprint: false,
      crouch: false,
      primaryFire: false,
      secondaryFire: false,
    });

    // Wait for the position to change (one or more 30 Hz ticks).
    await waitForState(
      roomA,
      (s) => {
        const p = playerFromState(s, roomA.sessionId);
        return p && (p.z < zBefore - 0.01 || p.x !== xBefore);
      },
      3_000,
    );

    const aAfter = playerFromState(roomA.state, roomA.sessionId);
    // Player moved forward (negative Z direction at yaw 0).
    // `movementInputToWorld({x:0, z:-1}, 0)` → {x:0, z:-1} (world -Z).
    // So z should decrease.
    expect(aAfter.z).toBeLessThan(zBefore);
    // The player's sequence was updated.
    expect(aAfter.lastProcessedSequence).toBe(0);

    // Player B's position did NOT change (B sent nothing).
    const bAfter = playerFromState(roomA.state, roomB.sessionId);
    expect(bAfter.x).toBeCloseTo(5, 1);
    expect(bAfter.z).toBeCloseTo(0, 1);
  });

  // ─── Test 3: Out-of-order (lower sequence) input is rejected ────────────────

  it("sending an out-of-order (lower sequence) input is rejected (position unchanged)", async () => {
    // The round is IN_PROGRESS (established by the previous test).
    await waitForPlaying(roomA);

    // First, send a valid input with sequence 1 to advance A's position.
    roomA.send(TWO_PLAYER_MOVEMENT_INPUT, {
      sequence: 1,
      moveX: 0,
      moveZ: -1,
      lookYaw: 0,
      lookPitch: 0,
      jump: false,
      sprint: false,
      crouch: false,
      primaryFire: false,
      secondaryFire: false,
    });

    // Wait for sequence 1 to be processed.
    await waitForState(
      roomA,
      (s) => {
        const p = playerFromState(s, roomA.sessionId);
        return p && p.lastProcessedSequence >= 1;
      },
      3_000,
    );

    // Record position after sequence 1 is processed.
    // Let a few more ticks elapse so position is stable for the next check.
    await waitMs(100);
    const aAfterSeq1 = playerFromState(roomA.state, roomA.sessionId);
    const xAtSeq1 = aAfterSeq1.x;
    const zAtSeq1 = aAfterSeq1.z;

    // Now send an OUT-OF-ORDER input with sequence 0 (lower than last processed).
    roomA.send(TWO_PLAYER_MOVEMENT_INPUT, {
      sequence: 0,
      moveX: 1,
      moveZ: 1,
      lookYaw: 0,
      lookPitch: 0,
      jump: false,
      sprint: false,
      crouch: false,
      primaryFire: false,
      secondaryFire: false,
    });

    // Wait a few ticks to ensure the rejected input had a chance to be processed.
    await waitMs(200);

    // The player's lastProcessedSequence should still be 1 (not rolled back to 0).
    const aAfterRejected = playerFromState(roomA.state, roomA.sessionId);
    expect(aAfterRejected.lastProcessedSequence).toBe(1);

    // Position should be nearly the same as when sequence 1 was processed.
    // (The neutral-input ticks between the seq-1 tick and now advance the
    // player slightly due to no-movement + gravity, but the horizontal
    // position should be essentially unchanged since moveX/moveZ are 0 in
    // neutral ticks.)
    expect(Math.abs(aAfterRejected.x - xAtSeq1)).toBeLessThan(0.1);
    expect(Math.abs(aAfterRejected.z - zAtSeq1)).toBeLessThan(0.1);
  });

  // ─── Test 4: A player leaving removes their state ───────────────────────────

  it("a player leaving removes their state", async () => {
    // Ensure we are in the active round before the leave so the round-end
    // handling (opponent wins) is exercised deterministically.
    await waitForPlaying(roomA);

    // Before B leaves, A should see both players.
    expect(playerFromState(roomA.state, roomB.sessionId)).toBeDefined();

    // B leaves the room.
    await withDeadline(roomB.leave(), 5_000, "roomB.leave");

    // A's state should now NOT include B.
    await waitForState(
      roomA,
      (s) => !playerFromState(s, roomB.sessionId),
      5_000,
    );
    expect(playerFromState(roomA.state, roomB.sessionId)).toBeUndefined();

    // A is still present.
    const a = playerFromState(roomA.state, roomA.sessionId);
    expect(a).toBeDefined();
    // A's connection is still open.
    expect(roomA.connection.isOpen).toBe(true);
  });
});
