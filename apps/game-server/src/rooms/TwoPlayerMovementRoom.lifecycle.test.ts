/**
 * TwoPlayerMovementRoom lifecycle tests.
 *
 * Verifies the player join / leave / disconnect lifecycle of the canonical
 * two-player authoritative movement room using real Colyseus SDK clients
 * against a real in-process server.
 *
 * Covers:
 *  1. Join: Two players join the room. Both appear in the room state with
 *     default player values (spawn position, grounded, lastProcessedSequence
 *     initialised to the "no input processed yet" sentinel).
 *  2. Leave: One player leaves the room. The room state reflects the removal
 *     (player count decreases, the departed player's state is absent, the
 *     remaining player is unaffected).
 *  3. Disconnect: One player's connection drops (simulated by closing the
 *     WebSocket without a leave message). The room handles the disconnect
 *     gracefully — the player is removed from state, the remaining player's
 *     state is unaffected, and no unhandled errors are thrown.
 *
 * Each test uses a fresh server instance so tests are independent and
 * deterministic.
 */
import { describe, expect, it } from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";

import { VERTICAL_MOVEMENT } from "@buildshift/game-config";

import { startServer, shutdownServer } from "../server.js";
import type { GameServer } from "../server.js";
import { TWO_PLAYER_MOVEMENT_ROOM } from "./TwoPlayerMovementRoom.js";

// ─── Helpers (same bounded-polling patterns as twoPlayerMovementRoom.test.ts) ───

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
              `[lifecycle-test] timeout: "${label}" did not finish within ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Start a fresh server, have `count` clients join the two-player movement
 * room, and return the server + client rooms. The caller is responsible for
 * tearing down the rooms and shutting down the server.
 */
async function setupRoomWithPlayers(count: number): Promise<{
  server: GameServer;
  rooms: ClientRoom[];
}> {
  const { server, port } = await withDeadline(startServer(0), 10_000, "startServer");
  const url = `ws://127.0.0.1:${port}`;
  const rooms: ClientRoom[] = [];
  for (let i = 0; i < count; i++) {
    const room = await withDeadline(
      new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM),
      10_000,
      `join player ${i}`,
    );
    rooms.push(room);
  }
  return { server, rooms };
}

// ─── Tests ───

describe("TwoPlayerMovementRoom lifecycle", () => {
  // ─── Test 1: Join ───────────────────────────────────────────────────────────

  it("two players join and both appear in the room state with default values", async () => {
    const { server, rooms: [roomA, roomB] } = await setupRoomWithPlayers(2);

    try {
      // Verify distinct session IDs and same room.
      expect(roomA.sessionId).toEqual(expect.any(String));
      expect(roomB.sessionId).toEqual(expect.any(String));
      expect(roomA.sessionId).not.toBe(roomB.sessionId);
      expect(roomA.roomId).toBe(roomB.roomId);

      // Wait until both players are visible in both clients' state.
      await waitForState(
        roomA,
        (s) => playerFromState(s, roomA.sessionId) && playerFromState(s, roomB.sessionId),
      );
      await waitForState(
        roomB,
        (s) => playerFromState(s, roomA.sessionId) && playerFromState(s, roomB.sessionId),
      );

      // Player A (first to join) at x = -5, ground level, z = 0.
      const playerA = playerFromState(roomA.state, roomA.sessionId);
      expect(playerA).toBeDefined();
      expect(playerA.x).toBeCloseTo(-5, 1);
      expect(playerA.y).toBeCloseTo(VERTICAL_MOVEMENT.groundY, 1);
      expect(playerA.z).toBeCloseTo(0, 1);
      expect(playerA.yaw).toBeCloseTo(0, 2);
      expect(playerA.velocityY).toBeCloseTo(0, 2);
      expect(playerA.grounded).toBe(true);
      // No input processed yet — the sentinel value is -1.
      expect(playerA.lastProcessedSequence).toBe(-1);

      // Player B (second to join) at x = +5, ground level, z = 0.
      const playerB = playerFromState(roomA.state, roomB.sessionId);
      expect(playerB).toBeDefined();
      expect(playerB.x).toBeCloseTo(5, 1);
      expect(playerB.y).toBeCloseTo(VERTICAL_MOVEMENT.groundY, 1);
      expect(playerB.z).toBeCloseTo(0, 1);
      expect(playerB.yaw).toBeCloseTo(0, 2);
      expect(playerB.velocityY).toBeCloseTo(0, 2);
      expect(playerB.grounded).toBe(true);
      expect(playerB.lastProcessedSequence).toBe(-1);

      // Both players are also visible to client B.
      const playerAInB = playerFromState(roomB.state, roomA.sessionId);
      const playerBInB = playerFromState(roomB.state, roomB.sessionId);
      expect(playerAInB).toBeDefined();
      expect(playerBInB).toBeDefined();
      expect(playerAInB.x).toBeCloseTo(-5, 1);
      expect(playerBInB.x).toBeCloseTo(5, 1);
    } finally {
      await withDeadline(
        Promise.all([teardownRoom(roomB), teardownRoom(roomA)]),
        5_000,
        "teardown rooms",
      );
      await withDeadline(shutdownServer(server), 8_000, "shutdownServer");
    }
  });

  // ─── Test 2: Leave ─────────────────────────────────────────────────────────

  it("a player leaving removes their state; the remaining player is unaffected", async () => {
    const { server, rooms: [roomA, roomB] } = await setupRoomWithPlayers(2);

    try {
      // Wait until both players are visible.
      await waitForState(
        roomA,
        (s) => playerFromState(s, roomA.sessionId) && playerFromState(s, roomB.sessionId),
      );

      // Record A's position before B leaves (baseline for "unaffected").
      const aBefore = playerFromState(roomA.state, roomA.sessionId);
      const aXBefore = aBefore.x;
      const aYBefore = aBefore.y;
      const aZBefore = aBefore.z;

      // B explicitly leaves the room.
      await withDeadline(roomB.leave(), 5_000, "roomB.leave");

      // A's state should now NOT include B.
      await waitForState(
        roomA,
        (s) => !playerFromState(s, roomB.sessionId),
        5_000,
      );
      expect(playerFromState(roomA.state, roomB.sessionId)).toBeUndefined();

      // A is still present with its state intact.
      const aAfter = playerFromState(roomA.state, roomA.sessionId);
      expect(aAfter).toBeDefined();
      // A's position is essentially unchanged (only neutral ticks between
      // the observation points; no movement input was sent).
      expect(Math.abs(aAfter.x - aXBefore)).toBeLessThan(0.1);
      expect(Math.abs(aAfter.y - aYBefore)).toBeLessThan(0.1);
      expect(Math.abs(aAfter.z - aZBefore)).toBeLessThan(0.1);
      expect(aAfter.grounded).toBe(true);

      // A's connection is still open.
      expect(roomA.connection.isOpen).toBe(true);
    } finally {
      await withDeadline(teardownRoom(roomA), 5_000, "teardown roomA");
      await withDeadline(shutdownServer(server), 8_000, "shutdownServer");
    }
  });

  // ─── Test 3: Disconnect ────────────────────────────────────────────────────

  it("a player disconnect is handled gracefully; the remaining player is unaffected", async () => {
    const { server, rooms: [roomA, roomB] } = await setupRoomWithPlayers(2);

    try {
      // Wait until both players are visible.
      await waitForState(
        roomA,
        (s) => playerFromState(s, roomA.sessionId) && playerFromState(s, roomB.sessionId),
      );

      // Record A's position before B disconnects (baseline).
      const aBefore = playerFromState(roomA.state, roomA.sessionId);
      const aXBefore = aBefore.x;
      const aYBefore = aBefore.y;
      const aZBefore = aBefore.z;

      // Simulate a network disconnect: close B's WebSocket connection
      // WITHOUT calling leave(). This simulates a sudden network drop.
      // The server should detect the closed connection and remove B from
      // the room state.
      try {
        roomB.connection.close();
      } catch {
        /* connection may already be closed — ignore */
      }

      // Wait for A's state to reflect B's removal (the server detects the
      // dropped connection and removes B's player entry).
      await waitForState(
        roomA,
        (s) => !playerFromState(s, roomB.sessionId),
        8_000,
      );
      expect(playerFromState(roomA.state, roomB.sessionId)).toBeUndefined();

      // A is still present with its state intact.
      const aAfter = playerFromState(roomA.state, roomA.sessionId);
      expect(aAfter).toBeDefined();
      // A's position is essentially unchanged.
      expect(Math.abs(aAfter.x - aXBefore)).toBeLessThan(0.1);
      expect(Math.abs(aAfter.y - aYBefore)).toBeLessThan(0.1);
      expect(Math.abs(aAfter.z - aZBefore)).toBeLessThan(0.1);
      expect(aAfter.grounded).toBe(true);

      // A's connection is still open and the room is still alive.
      expect(roomA.connection.isOpen).toBe(true);
      expect(roomA.roomId).toBeTruthy();
    } finally {
      await withDeadline(teardownRoom(roomA), 5_000, "teardown roomA");
      await withDeadline(shutdownServer(server), 8_000, "shutdownServer");
    }
  });
});
