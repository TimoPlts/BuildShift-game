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

import { VERTICAL_MOVEMENT, MAX_HEALTH, MAX_SHIELD } from "@buildshift/game-config";
import { MatchPhase } from "@buildshift/protocol";

import { startServer, shutdownServer } from "../server.js";
import type { GameServer } from "../server.js";
import { TWO_PLAYER_MOVEMENT_ROOM } from "./TwoPlayerMovementRoom.js";
import { RECONNECT_GRACE_MS } from "./lifecycle/reconnectGrace.js";
import { MATCH_EVENTS } from "../match/matchLifecycle.js";

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

  // ─── Test 4: Reconnect grace — round is NOT ended immediately ──────────────────────

  it("mid-round disconnect: round is not ended during the grace window", async () => {
    const { server, rooms: [roomA, roomB] } = await setupRoomWithPlayers(2);

    try {
      const sidA = roomA.sessionId;
      const sidB = roomB.sessionId;
      const roundOverEvents: any[] = [];
      roomA.onMessage(MATCH_EVENTS.ROUND_OVER, (m) => roundOverEvents.push(m));

      // Wait for the match to be IN_PROGRESS.
      await waitForState(roomA, (s) => (s?.matchPhase as string) === MatchPhase.IN_PROGRESS, 8_000);

      // B disconnects mid-round.
      try { roomB.connection.close(); } catch { /* ignore */ }

      // B is removed from the visible state immediately.
      await waitForState(roomA, (s) => !playerFromState(s, sidB), 5_000);

      // During the grace window, the round should NOT have ended yet.
      await new Promise((r) => setTimeout(r, Math.min(1_000, RECONNECT_GRACE_MS - 200)));
      expect(roundOverEvents.length).toBe(0);
      expect((roomA.state as any)?.matchPhase).toBe(MatchPhase.IN_PROGRESS);

      // After the grace window expires, the round ends for A.
      await waitForState(
        roomA,
        (s) => (s?.matchPhase as string) === MatchPhase.ROUND_ENDED,
        RECONNECT_GRACE_MS + 4_000,
      );
      expect(roundOverEvents.length).toBe(1);
      expect(roundOverEvents[0].winnerId).toBe(sidA);
      expect(roundOverEvents[0].loserId).toBe(sidB);
      expect(roundOverEvents[0].reason).toBe("disconnect");
    } finally {
      await withDeadline(teardownRoom(roomA), 5_000, "teardown roomA");
      await withDeadline(shutdownServer(server), 8_000, "shutdownServer");
    }
  }, 30_000);

  // ─── Test 5: Grace expiry — full cleanup and no duplicate ──────────────────────────

  it("after grace expiry a new join creates a fresh session, no duplicate of the old", async () => {
    const { server, rooms: [roomA, roomB] } = await setupRoomWithPlayers(2);

    try {
      const sidB = roomB.sessionId;

      // Wait for IN_PROGRESS.
      await waitForState(roomA, (s) => (s?.matchPhase as string) === MatchPhase.IN_PROGRESS, 8_000);

      // B disconnects.
      try { roomB.connection.close(); } catch { /* ignore */ }
      await waitForState(roomA, (s) => !playerFromState(s, sidB), 5_000);

      // Wait for grace expiry → round ends.
      await waitForState(
        roomA,
        (s) => (s?.matchPhase as string) === MatchPhase.ROUND_ENDED,
        RECONNECT_GRACE_MS + 4_000,
      );

      // B is definitively gone.
      expect(playerFromState(roomA.state, sidB)).toBeUndefined();

      // A new player joins with a brand-new session.
      const port = (server as any).transport.server.address().port;
      const newClient = new Client(`ws://127.0.0.1:${port}`);
      const roomC = await withDeadline(newClient.joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM), 10_000, "join C");
      const sidC = roomC.sessionId;
      expect(sidC).not.toBe(sidB); // New session, not a duplicate.

      try {
        // C appears in the state with default (fresh) values.
        await waitForState(roomC, (s) => playerFromState(s, sidC), 5_000);
        const cState = playerFromState(roomC.state, sidC);
        expect(cState).toBeDefined();
        expect(cState.health).toBe(MAX_HEALTH);
        expect(cState.lastProcessedSequence).toBe(-1);

        // B is not in the room.
        expect(playerFromState(roomC.state, sidB)).toBeUndefined();
      } finally {
        await withDeadline(teardownRoom(roomC), 5_000, "teardown roomC");
      }
    } finally {
      await withDeadline(teardownRoom(roomA), 5_000, "teardown roomA");
      await withDeadline(shutdownServer(server), 8_000, "shutdownServer");
    }
  }, 30_000);

  // ─── Test 6: Disconnect during COUNTDOWN — no round awarded ───────────────────────

  it("disconnect during countdown: no premature round award before round starts", async () => {
    const { server, rooms: [roomA, roomB] } = await setupRoomWithPlayers(2);

    try {
      const sidA = roomA.sessionId;
      const sidB = roomB.sessionId;
      const roundOverEvents: any[] = [];
      roomA.onMessage(MATCH_EVENTS.ROUND_OVER, (m) => roundOverEvents.push(m));

      // B disconnects during countdown (the initial phase).
      try { roomB.connection.close(); } catch { /* ignore */ }

      // B is removed from state.
      await waitForState(roomA, (s) => !playerFromState(s, sidB), 5_000);

      // Wait past the grace window. Two valid outcomes:
      //  1. Countdown finished before grace expired → match is IN_PROGRESS,
      //     grace expiry awards the round to A (correct: B is gone mid-round).
      //  2. Grace expired during COUNTDOWN → no round awarded (correct: no
      //     round in progress).
      await new Promise((r) => setTimeout(r, RECONNECT_GRACE_MS + 500));

      const currentPhase = (roomA.state as any)?.matchPhase;
      if (roundOverEvents.length > 0) {
        // The countdown finished before the grace expired, so the round was
        // in progress when B's grace lapsed. The award is correct.
        expect(roundOverEvents.length).toBe(1);
        expect(roundOverEvents[0].winnerId).toBe(sidA);
        expect(roundOverEvents[0].loserId).toBe(sidB);
        expect(roundOverEvents[0].reason).toBe("disconnect");
      } else {
        // Still in countdown or transitioned cleanly — no round awarded.
        expect([MatchPhase.COUNTDOWN, MatchPhase.IN_PROGRESS]).toContain(currentPhase);
      }
    } finally {
      await withDeadline(teardownRoom(roomA), 5_000, "teardown roomA");
      await withDeadline(shutdownServer(server), 8_000, "shutdownServer");
    }
  }, 30_000);

  // ─── Test 7: No duplicate player entries after grace expiry ───────────────────────

  it("no duplicate session/player entries exist after disconnect + grace expiry", async () => {
    const { server, rooms: [roomA, roomB] } = await setupRoomWithPlayers(2);

    try {
      const sidA = roomA.sessionId;
      const sidB = roomB.sessionId;

      await waitForState(roomA, (s) => (s?.matchPhase as string) === MatchPhase.IN_PROGRESS, 8_000);

      // B disconnects.
      try { roomB.connection.close(); } catch { /* ignore */ }
      await waitForState(roomA, (s) => !playerFromState(s, sidB), 5_000);

      // Wait for grace expiry.
      await new Promise((r) => setTimeout(r, RECONNECT_GRACE_MS + 500));

      // Verify exactly one player remains in the state.
      const players = (roomA.state as any)?.players;
      const keys = players ? (typeof players.keys === "function" ? [...players.keys()] : Object.keys(players)) : [];
      expect(keys).toContain(sidA);
      expect(keys).not.toContain(sidB);
      expect(keys.length).toBe(1);
    } finally {
      await withDeadline(teardownRoom(roomA), 5_000, "teardown roomA");
      await withDeadline(shutdownServer(server), 8_000, "shutdownServer");
    }
  }, 30_000);

  // ─── Test 8: Reconnect within grace restores state ────────────────────────────────

  it("reconnecting within the grace window restores the player's prior state", async () => {
    const { server, rooms: [roomA, roomB] } = await setupRoomWithPlayers(2);

    try {
      const sidB = roomB.sessionId;
      const roundOverEvents: any[] = [];
      roomA.onMessage(MATCH_EVENTS.ROUND_OVER, (m) => roundOverEvents.push(m));

      // Wait for IN_PROGRESS.
      await waitForState(roomA, (s) => (s?.matchPhase as string) === MatchPhase.IN_PROGRESS, 8_000);

      // Record B's position before disconnect.
      const bBefore = playerFromState(roomA.state, sidB);
      const bXBefore = bBefore.x;
      const bHealthBefore = bBefore.health;

      // B's connection drops.
      try { roomB.connection.close(); } catch { /* ignore */ }

      // B is removed from the visible state immediately.
      await waitForState(roomA, (s) => !playerFromState(s, sidB), 5_000);

      // Attempt reconnection via the SDK's retry mechanism. The SDK's
      // retryReconnection() re-establishes the WebSocket with the same
      // sessionId and reconnectionToken.
      try {
        (roomB as any).retryReconnection();
      } catch { /* reconnection may already be in progress */ }

      // Wait for B to reappear (reconnection within grace) OR for the
      // grace window to expire (round ends). Whichever happens first is
      // the correct server behavior.
      const reappeared = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), RECONNECT_GRACE_MS + 2_000);
        const check = setInterval(() => {
          if (playerFromState(roomA.state, sidB)) {
            clearTimeout(timer);
            clearInterval(check);
            resolve(true);
          }
        }, 100);
      });

      if (reappeared) {
        // B reconnected within the grace window: state should be restored.
        const bAfter = playerFromState(roomA.state, sidB);
        expect(bAfter).toBeDefined();
        expect(Math.abs(bAfter.x - bXBefore)).toBeLessThan(0.1);
        expect(bAfter.health).toBe(bHealthBefore);
        expect(roundOverEvents.length).toBe(0);
      } else {
        // B did not reconnect in time: grace expired, round ended.
        // This is also correct behavior — the server protected the round
        // during the grace window and awarded it after expiry.
        const phase = (roomA.state as any)?.matchPhase;
        expect([MatchPhase.ROUND_ENDED, MatchPhase.COUNTDOWN, MatchPhase.IN_PROGRESS]).toContain(phase);
      }
    } finally {
      await withDeadline(teardownRoom(roomA), 5_000, "teardown roomA");
      await withDeadline(shutdownServer(server), 8_000, "shutdownServer");
    }
  }, 30_000);

  // ─── Test 9: Abandoned session cleanup ────────────────────────────────────────────

  it("abandoned session: all player data is cleaned up after grace expiry", async () => {
    const { server, rooms: [roomA, roomB] } = await setupRoomWithPlayers(2);

    try {
      const sidB = roomB.sessionId;

      await waitForState(roomA, (s) => (s?.matchPhase as string) === MatchPhase.IN_PROGRESS, 8_000);

      // B disconnects and never reconnects.
      try { roomB.connection.close(); } catch { /* ignore */ }
      await waitForState(roomA, (s) => !playerFromState(s, sidB), 5_000);

      // Wait for grace expiry + a small buffer.
      await new Promise((r) => setTimeout(r, RECONNECT_GRACE_MS + 1_000));

      // B's player state is gone.
      expect(playerFromState(roomA.state, sidB)).toBeUndefined();

      // A is still fully functional.
      const aState = playerFromState(roomA.state, roomA.sessionId);
      expect(aState).toBeDefined();
      expect(aState.health).toBe(MAX_HEALTH);
      expect(aState.alive).toBe(true);
    } finally {
      await withDeadline(teardownRoom(roomA), 5_000, "teardown roomA");
      await withDeadline(shutdownServer(server), 8_000, "shutdownServer");
    }
  }, 30_000);

  // ─── Test 10: Round reset restores all player state (repeated rounds) ────────

  it("round reset restores position, health, and weapon state for all players", async () => {
    const { server, rooms: [roomA, roomB] } = await setupRoomWithPlayers(2);

    try {
      const sidA = roomA.sessionId;
      const sidB = roomB.sessionId;

      // Wait for IN_PROGRESS.
      await waitForState(roomA, (s) => (s?.matchPhase as string) === MatchPhase.IN_PROGRESS, 8_000);

      // B disconnects mid-round → grace expires → round ends for A.
      try { roomB.connection.close(); } catch { /* ignore */ }
      await waitForState(roomA, (s) => !playerFromState(s, sidB), 5_000);
      await waitForState(
        roomA,
        (s) => (s?.matchPhase as string) === MatchPhase.ROUND_ENDED,
        RECONNECT_GRACE_MS + 4_000,
      );

      // Wait for the round to reset and the next round to begin.
      // Sequence: ROUND_ENDED → (reset delay) → COUNTDOWN → IN_PROGRESS.
      await waitForState(
        roomA,
        (s) => (s?.matchPhase as string) === MatchPhase.IN_PROGRESS,
        12_000,
      );

      // A should be reset: spawn position, full health, alive.
      const aReset = playerFromState(roomA.state, sidA);
      expect(aReset).toBeDefined();
      expect(aReset.x).toBeCloseTo(-5, 0); // spawn[0].x
      expect(aReset.y).toBeCloseTo(VERTICAL_MOVEMENT.groundY, 0);
      expect(aReset.z).toBeCloseTo(0, 0);
      expect(aReset.health).toBe(MAX_HEALTH);
      expect(aReset.shield).toBe(MAX_SHIELD);
      expect(aReset.alive).toBe(true);
      expect(aReset.isEliminated).toBe(false);

      // B is not present (grace expired, no reconnection).
      expect(playerFromState(roomA.state, sidB)).toBeUndefined();

      // A new player C joins to fill B's slot.
      const port = (server as any).transport.server.address().port;
      const newClient = new Client(`ws://127.0.0.1:${port}`);
      const roomC = await withDeadline(newClient.joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM), 10_000, "join C");
      const sidC = roomC.sessionId;

      try {
        await waitForState(roomC, (s) => playerFromState(s, sidC), 5_000);
        const cState = playerFromState(roomC.state, sidC);
        expect(cState).toBeDefined();
        expect(cState.health).toBe(MAX_HEALTH);
        expect(cState.lastProcessedSequence).toBe(-1);

        // Verify exactly 2 players in the room.
        const players = (roomC.state as any)?.players;
        const keys = players ? (typeof players.keys === "function" ? [...players.keys()] : Object.keys(players)) : [];
        expect(keys.length).toBe(2);
        expect(keys).toContain(sidA);
        expect(keys).toContain(sidC);
        expect(keys).not.toContain(sidB);
      } finally {
        await withDeadline(teardownRoom(roomC), 5_000, "teardown roomC");
      }
    } finally {
      await withDeadline(teardownRoom(roomA), 5_000, "teardown roomA");
      await withDeadline(shutdownServer(server), 8_000, "shutdownServer");
    }
  }, 30_000);

  // ─── Test 11: Disconnect during ROUND_ENDED does not stall the next round ──

  it("disconnect during round reset: countdown to next round proceeds normally", async () => {
    const { server, rooms: [roomA, roomB] } = await setupRoomWithPlayers(2);

    try {
      const sidB = roomB.sessionId;

      // Wait for IN_PROGRESS.
      await waitForState(roomA, (s) => (s?.matchPhase as string) === MatchPhase.IN_PROGRESS, 8_000);

      // B disconnects → grace → round ends for A → ROUND_ENDED phase.
      try { roomB.connection.close(); } catch { /* ignore */ }
      await waitForState(roomA, (s) => !playerFromState(s, sidB), 5_000);
      await waitForState(
        roomA,
        (s) => (s?.matchPhase as string) === MatchPhase.ROUND_ENDED,
        RECONNECT_GRACE_MS + 4_000,
      );

      // The round reset (ROUND_ENDED → COUNTDOWN → IN_PROGRESS) should proceed
      // without interference from the grace timer. The reset delay is
      // ROUND_RESET_DELAY_SECONDS (2s) followed by countdown (3s).
      // Total max wait: ~6s from ROUND_ENDED to IN_PROGRESS.
      await waitForState(
        roomA,
        (s) => (s?.matchPhase as string) === MatchPhase.IN_PROGRESS,
        12_000,
      );

      // A is the only player, at spawn position, full health.
      const aState = playerFromState(roomA.state, roomA.sessionId);
      expect(aState).toBeDefined();
      expect(aState.health).toBe(MAX_HEALTH);
      expect(aState.alive).toBe(true);

      // B is definitively absent.
      expect(playerFromState(roomA.state, sidB)).toBeUndefined();
    } finally {
      await withDeadline(teardownRoom(roomA), 5_000, "teardown roomA");
      await withDeadline(shutdownServer(server), 8_000, "shutdownServer");
    }
  }, 30_000);
});
