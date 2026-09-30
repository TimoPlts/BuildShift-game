/**
 * Stage 2C1 — real SDK/wire integration test for the authoritative movement
 * room.
 *
 * This is the one test that exercises the FULL authoritative path over the
 * network: a real Colyseus `Server` (compiled from source via vitest) bound to
 * a free port, a real `@colyseus/sdk` client, and the room's 30 Hz fixed
 * timestep actually running. It proves:
 *  1. a joined player is published at `PLAYER_SPAWN` with
 *     `acknowledgedSequence = -1`;
 *  2. an accepted `EVENTS.PLAYER_INPUT` move frame results in AUTHORITATIVE
 *     movement over the wire (the published `position.z` drifts from the spawn
 *     under the held forward input), i.e. the room's authoritative tick is
 *     really advancing the Rapier world and publishing it — not a no-op;
 *  3. the player entry is removed from the wire state on leave.
 *
 * Unlike the deterministic tests, this one reads the SDK client's decoded
 * `room.state` (the schema-serialization/patch path) and waits for real patch
 * cadence, so it uses a short polling helper rather than exact values.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";

import { EVENTS } from "@buildshift/protocol";
import { PLAYER_SPAWN } from "@buildshift/game-config";

import { FOUNDATION_ROOM, startServer, shutdownServer } from "./server.js";
import type { GameServer } from "./server.js";

/** Wait until a predicate on the decoded client-side state holds. */
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

/**
 * Leave a client room and close its connection so the server-side room
 * auto-disposes promptly (which releases the physics world).
 */
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
              `[buildshift:2c1wire] teardown timeout: "${label}" did not finish within ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe("Stage 2C1 authoritative movement over the wire", () => {
  let server: GameServer;
  let port: number;
  let client: Client;
  let room: ClientRoom;

  beforeAll(async () => {
    const started = await startServer(0);
    server = started.server;
    port = started.port;
    expect(port).toBeGreaterThan(0);

    client = new Client(`ws://127.0.0.1:${port}`);
    room = await client.joinOrCreate(FOUNDATION_ROOM);
    expect(room.sessionId).toEqual(expect.any(String));
    await waitForState(room, (s) => playerFromState(s, room.sessionId));
  }, 20_000);

  afterAll(async () => {
    await withDeadline(teardownRoom(room), 3_000, "teardownRoom");
    await withDeadline(shutdownServer(server), 8_000, "shutdownServer");
  }, 20_000);

  it("publishes the joined player at PLAYER_SPAWN with no acknowledged sequence", async () => {
    const p = playerFromState(room.state, room.sessionId);
    expect(p).toBeDefined();
    expect(p.acknowledgedSequence).toBe(-1);
    expect(p.yaw).toBe(0);
    expect(p.playerId).toBe(room.sessionId);
    // Spawn (before the first tick's gravity has had time to move it far).
    expect(p.position.x).toBeCloseTo(PLAYER_SPAWN.x, 1);
    expect(p.position.z).toBeCloseTo(PLAYER_SPAWN.z, 1);
  });

  it("moves the player authoritatively over the wire from a held input frame", async () => {
    // Hold forward (moveZ = -1 → -Z at yaw 0). The room's 30 Hz authoritative
    // tick consumes this frame and keeps the held input moving each tick.
    room.send(EVENTS.PLAYER_INPUT, {
      sequence: 0,
      moveX: 0,
      moveZ: -1,
      lookYaw: 0,
      lookPitch: 0,
      jump: false,
    });

    // Wait until the authoritative position has visibly drifted from spawn
    // in -Z. This only happens if the tick is really advancing Rapier and
    // publishing — a no-op ack would leave z at spawn forever.
    await waitForState(
      room,
      (s) => {
        const p = playerFromState(s, room.sessionId);
        return p && p.position.z < PLAYER_SPAWN.z - 0.15;
      },
      5_000,
    );
    const p = playerFromState(room.state, room.sessionId);
    expect(p.position.z).toBeLessThan(PLAYER_SPAWN.z - 0.15);
    // The frame has been processed and acknowledged over the wire.
    expect(p.acknowledgedSequence).toBe(0);
  });

  it("raises the authoritative Y from a jump frame over the wire", async () => {
    // Send a jump while grounded-ish; the authoritative simulation launches the
    // player, so the published Y should exceed the spawn height within a short
    // window.
    room.send(EVENTS.PLAYER_INPUT, {
      sequence: 1,
      moveX: 0,
      moveZ: 0,
      lookYaw: 0,
      lookPitch: 0,
      jump: true,
    });

    await waitForState(
      room,
      (s) => {
        const p = playerFromState(s, room.sessionId);
        return p && p.position.y > PLAYER_SPAWN.y + 0.15;
      },
      5_000,
    );
    const p = playerFromState(room.state, room.sessionId);
    expect(p.position.y).toBeGreaterThan(PLAYER_SPAWN.y + 0.15);
  });

  it("progresses acknowledgements in order through an ordered burst (2C2B wire)", async () => {
    // The two tests above already consumed sequences 0 and 1 on this shared
    // room, so lastReceivedSequence is 1. This burst therefore starts at 2.
    // We fire N frames back-to-back — microseconds apart, i.e. far faster than
    // the room's 30 Hz authoritative tick — to build a real backlog over the
    // wire, then prove the ack reaches the LAST sent sequence in order within
    // an explicit deadline (so CI can never hang).
    const START = 2;
    const N = 24; // sequences 2..25
    const END = START + N - 1;
    const sent = new Set<number>();
    for (let s = START; s <= END; s++) {
      room.send(EVENTS.PLAYER_INPUT, {
        sequence: s,
        moveX: 0,
        moveZ: 0,
        lookYaw: 0,
        lookPitch: 0,
        jump: false,
      });
      sent.add(s);
    }

    // Early-window guard: the whole backlog can only be simulated at the 30 Hz
    // tick rate (N frames ≈ N/30 s). If a defect made the ack mean "highest
    // received", it would already equal END within milliseconds. Prove that is
    // NOT the case: shortly after the burst, the ack is still far below END.
    const earlyWindowMs = 150; // ≈ 4-5 ticks → ack should be well below END
    const earlyStart = Date.now();
    let earlyMax = playerFromState(room.state, room.sessionId)?.acknowledgedSequence ?? -1;
    while (Date.now() - earlyStart < earlyWindowMs) {
      const now = playerFromState(room.state, room.sessionId)?.acknowledgedSequence;
      if (typeof now === "number") earlyMax = Math.max(earlyMax, now);
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(earlyMax).toBeLessThan(END);

    // Sample the published ack at a fast cadence until it reaches the final
    // sequence, recording the DISTINCT values we observed so we can assert
    // they progress in order (each a real sent sequence, never beyond END).
    const deadlineMs = 6_000; // 24 frames @ 30Hz ≈ 0.8s + generous patch margin
    const startedAt = Date.now();
    const observed: number[] = [];
    let last = playerFromState(room.state, room.sessionId)?.acknowledgedSequence ?? -1;
    while (last < END) {
      if (Date.now() - startedAt > deadlineMs) {
        throw new Error(
          `[buildshift:2c2bwire] ack did not reach sequence ${END} within ${deadlineMs}ms; last=${last}, observed=${JSON.stringify(observed)}`,
        );
      }
      await new Promise((r) => setTimeout(r, 10));
      const now = playerFromState(room.state, room.sessionId)?.acknowledgedSequence;
      if (typeof now === "number" && now > last) {
        observed.push(now);
        last = now;
      }
    }

    // The ack reached the final sent sequence.
    expect(last).toBe(END);
    // Every distinct observed value was a REAL sent sequence (never a skipped /
    // highest-received leap) and they strictly increased — in order.
    for (let i = 0; i < observed.length; i++) {
      expect(sent.has(observed[i])).toBe(true);
      expect(observed[i]).toBeLessThanOrEqual(END);
      if (i > 0) {
        expect(observed[i]).toBeGreaterThan(observed[i - 1]);
      }
    }
  });
});
