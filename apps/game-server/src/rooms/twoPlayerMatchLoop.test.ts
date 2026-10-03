/**
 * Full match lifecycle test for TwoPlayerMovementRoom.
 *
 * Verifies:
 *  1. Room starts in COUNTDOWN; transitions to IN_PROGRESS after countdown.
 *  2. On disconnect during IN_PROGRESS, opponent wins the round.
 *  3. After round end, transitions back to COUNTDOWN (round reset).
 *  4. Scores are tracked correctly in the state.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";
import { MatchPhase } from "@buildshift/protocol";
import { startServer, shutdownServer } from "../server.js";
import type { GameServer } from "../server.js";
import { TWO_PLAYER_MOVEMENT_ROOM } from "./TwoPlayerMovementRoom.js";

async function waitForState(
  room: ClientRoom,
  pred: (s: unknown) => boolean,
  timeoutMs = 8_000,
): Promise<void> {
  const t0 = Date.now();
  if (room.state && pred(room.state)) return;
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 30));
    if (room.state && pred(room.state)) return;
  }
  throw new Error(
    `waitForState timed out; state=${JSON.stringify(room.state)}`,
  );
}

function matchPhase(state: unknown): string {
  return (state as Record<string, unknown>)?.matchPhase as string ?? "";
}

async function teardownRoom(room: ClientRoom | null): Promise<void> {
  if (!room) return;
  room.leave().catch(() => {});
  try {
    room.connection.close();
  } catch {}
}

async function withDeadline<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe("Full match lifecycle", () => {
  let server: GameServer;
  let port: number;

  beforeAll(async () => {
    const started = await withDeadline(startServer(0), 10_000, "startServer");
    server = started.server;
    port = started.port;
  }, 20_000);

  afterAll(async () => {
    await withDeadline(shutdownServer(server), 8_000, "shutdown");
  }, 20_000);

  it("starts in COUNTDOWN and transitions to IN_PROGRESS after countdown", async () => {
    const url = `ws://127.0.0.1:${port}`;
    const roomA = await withDeadline(
      new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM),
      10_000,
      "join A",
    );
    const roomB = await withDeadline(
      new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM),
      10_000,
      "join B",
    );

    try {
      // Wait for both players to be in state.
      await waitForState(roomA, (s) => {
        const p = (s as Record<string, any>)?.players;
        return p && (p.get?.(roomA.sessionId) ?? p[roomA.sessionId]);
      });

      // Initial phase should be COUNTDOWN.
      expect(matchPhase(roomA.state)).toBe(MatchPhase.COUNTDOWN);

      // Wait for countdown to expire and transition to IN_PROGRESS.
      await waitForState(
        roomA,
        (s) => matchPhase(s) === MatchPhase.IN_PROGRESS,
        6_000,
      );
      expect(matchPhase(roomA.state)).toBe(MatchPhase.IN_PROGRESS);

      // Round should be 1.
      const state = roomA.state as Record<string, any>;
      expect(state.currentRound).toBe(1);
    } finally {
      await withDeadline(
        Promise.all([teardownRoom(roomB), teardownRoom(roomA)]),
        5_000,
        "teardown",
      );
    }
  }, 20_000);

  it("disconnect during IN_PROGRESS awards round to opponent", async () => {
    const url = `ws://127.0.0.1:${port}`;
    const roomA = await withDeadline(
      new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM),
      10_000,
      "join A",
    );
    const roomB = await withDeadline(
      new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM),
      10_000,
      "join B",
    );

    try {
      // Wait for IN_PROGRESS.
      await waitForState(
        roomA,
        (s) => matchPhase(s) === MatchPhase.IN_PROGRESS,
        6_000,
      );

      // B disconnects (closes connection without leave).
      try {
        roomB.connection.close();
      } catch {}

      // A should see B removed.
      await waitForState(
        roomA,
        (s) => {
          const p = (s as Record<string, any>)?.players;
          return p && !(p.get?.(roomB.sessionId) ?? p[roomB.sessionId]);
        },
        6_000,
      );

      // Wait for round to end → phase transitions away from IN_PROGRESS.
      await waitForState(
        roomA,
        (s) => matchPhase(s) !== MatchPhase.IN_PROGRESS,
        8_000,
      );

      // A's score should be 1.
      const state = roomA.state as Record<string, any>;
      const scores = state.roundScore;
      const aScore =
        scores?.get?.(roomA.sessionId)?.value ??
        scores?.[roomA.sessionId]?.value ??
        0;
      expect(aScore).toBe(1);
    } finally {
      await withDeadline(teardownRoom(roomA), 5_000, "teardown A");
    }
  }, 20_000);

  it("round reset returns to COUNTDOWN then IN_PROGRESS (round 2)", async () => {
    const url = `ws://127.0.0.1:${port}`;
    const roomA = await withDeadline(
      new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM),
      10_000,
      "join A",
    );
    const roomB = await withDeadline(
      new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM),
      10_000,
      "join B",
    );

    try {
      // Wait for round 1 IN_PROGRESS.
      await waitForState(
        roomA,
        (s) => matchPhase(s) === MatchPhase.IN_PROGRESS,
        6_000,
      );

      // B disconnects → A wins round 1.
      try {
        roomB.connection.close();
      } catch {}

      // Wait for transition to ROUND_ENDED or COUNTDOWN.
      await waitForState(
        roomA,
        (s) =>
          matchPhase(s) === MatchPhase.ROUND_ENDED ||
          matchPhase(s) === MatchPhase.COUNTDOWN,
        8_000,
      );

      // Wait for COUNTDOWN → IN_PROGRESS (round 2).
      await waitForState(
        roomA,
        (s) => matchPhase(s) === MatchPhase.IN_PROGRESS,
        12_000,
      );

      // Round should be 2.
      const state = roomA.state as Record<string, any>;
      expect(state.currentRound).toBe(2);

      // A's score should still be 1.
      const scores = state.roundScore;
      const aScore =
        scores?.get?.(roomA.sessionId)?.value ??
        scores?.[roomA.sessionId]?.value ??
        0;
      expect(aScore).toBe(1);
    } finally {
      await withDeadline(teardownRoom(roomA), 5_000, "teardown A");
    }
  }, 30_000);
});
