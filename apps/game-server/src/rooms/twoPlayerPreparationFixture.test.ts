/**
 * Trusted test-fixture preparation control (QA R1 positive control).
 *
 * Proves the observation method used by `twoPlayerPreparationGuard.test.ts`
 * actually detects a shortened preparation: a server CONSTRUCTED with the
 * server-owned override (`createServer({}, { testPreparationSeconds })` via the
 * test fixture) really does run the short countdown, both clients see it, and the
 * fight opens immediately afterwards. A client on that same server still cannot
 * pick its own duration — the token/duration is pinned in the registration.
 *
 * Kept in its own file because Colyseus holds its room-type registry in a
 * process-global matchMaker: this file's server is the only registration in this
 * process, so nothing here can leak a short preparation into the production case.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";

import { MatchPhase, ROOMS } from "@buildshift/protocol";

import { shutdownServer, type GameServer } from "../server.js";
import { startTestServer } from "../test/testServerFixture.js";
import { TEST_PREPARATION_TOKEN_OPTION } from "./testPreparationOverride.js";
import { MATCH_EVENTS } from "../match/matchLifecycle.js";

/** Server-pinned test preparation: 0.4 s → 12 ticks @ 30 Hz. */
const PINNED_SECONDS = 0.4;
const PINNED_TICKS = Math.round(PINNED_SECONDS * 30);
/** Something a client would try on a test server: 0.02 s → 1 tick. */
const SPOOF_TICKS = 1;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function deadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`[prep-fixture] "${label}" timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForPhase(room: ClientRoom, phase: MatchPhase, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if ((room.state as Record<string, unknown>)?.matchPhase === phase) return;
    await wait(20);
  }
  throw new Error(`waitForPhase(${phase}) timed out after ${timeoutMs}ms`);
}

describe("trusted test-fixture preparation (server-pinned override)", () => {
  let server: GameServer;
  let url: string;
  const rooms: ClientRoom[] = [];

  beforeAll(async () => {
    const started = await deadline(startTestServer(0, { testPreparationSeconds: PINNED_SECONDS }), 20_000, "startTestServer");
    server = started.server;
    url = `ws://127.0.0.1:${started.port}`;
  }, 40_000);

  afterAll(async () => {
    for (const room of rooms) {
      room.leave().catch(() => undefined);
      try {
        room.connection.close();
      } catch {
        /* already closed */
      }
    }
    await deadline(shutdownServer(server), 8_000, "shutdownServer").catch(() => undefined);
  }, 30_000);

  const join = async (options?: Record<string, unknown>) => {
    const totals: number[] = [];
    const room = await deadline(new Client(url).joinOrCreate(ROOMS.TWO_PLAYER_MOVEMENT, options), 10_000, "join");
    rooms.push(room);
    room.onMessage(MATCH_EVENTS.COUNTDOWN_TICK, (payload: { totalTicks?: number }) => {
      if (typeof payload?.totalTicks === "number") totals.push(payload.totalTicks);
    });
    return { room, totals };
  };

  it("both clients observe the server-pinned short preparation, then the fight opens", async () => {
    const a = await join();
    const b = await join();
    await deadline(wait(60), 5_000, "collect ticks");
    expect(a.totals.length).toBeGreaterThan(0);
    expect(b.totals.length).toBeGreaterThan(0);
    expect(new Set([...a.totals, ...b.totals])).toEqual(new Set([PINNED_TICKS]));
    // The short preparation really ends: the same probe on the production server
    // would have been stuck in COUNTDOWN for 8 s.
    await deadline(waitForPhase(a.room, MatchPhase.IN_PROGRESS, 5_000), 6_000, "fight opens");
    expect((a.room.state as Record<string, unknown>).preparationActive).toBe(false);
  }, 30_000);

  it("a client on the test server still cannot pick its own duration", async () => {
    const a = await join({
      [TEST_PREPARATION_TOKEN_OPTION]: "attacker-token",
      testPreparationSeconds: 0.02,
      testPreparationEnabled: true,
    });
    const b = await join({ testPreparationSeconds: 0.02 });
    await deadline(wait(60), 5_000, "collect ticks");
    expect(new Set([...a.totals, ...b.totals])).toEqual(new Set([PINNED_TICKS]));
    expect([...a.totals, ...b.totals]).not.toContain(SPOOF_TICKS);
  }, 30_000);
});
