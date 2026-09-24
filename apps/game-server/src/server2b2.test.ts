/**
 * Stage 2B2 smoke test — stateful room + input handling.
 *
 * Proves, end to end over the wire, that:
 *  1. the foundation room is now STATEFUL (client decodes a `players` map);
 *  2. on join, a player entry appears at the neutral bootstrap spawn with
 *     `acknowledgedSequence = -1` and `yaw = 0`;
 *  3. `EVENTS.PLAYER_INPUT` with a valid frame advances
 *     `acknowledgedSequence` and updates `yaw`;
 *  4. duplicate / lower / non-monotonic sequences are IGNORED
 *     (no state change);
 *  5. malformed payloads are IGNORED (no state change, no server crash);
 *  6. on leave, the player entry is REMOVED from state.
 *
 * We read the state from the SDK client's decoded `room.state` — this
 * exercises the full schema-serialization/patch path (Colyseus server-side
 * `SchemaSerializer` → wire patch → client-side `SchemaSerializer`), which
 * is the core behaviour of Stage 2B2.
 *
 * This file complements `server.test.ts` (which focuses on the lifecycle
 * boot + client counts) and does not depend on it.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";

import {
  EVENTS,
  ROOMS,
  type PlayerInputFrame,
} from "@buildshift/protocol";

import { FOUNDATION_ROOM, startServer, shutdownServer } from "./server.js";
import type { GameServer } from "./server.js";

/** Wait until a predicate on the decoded client-side state holds. */
async function waitForState(
  room: ClientRoom,
  predicate: (state: any) => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const startedAt = Date.now();
  // Check the current state first — patches may already have arrived.
  if (room.state && predicate(room.state)) {
    return;
  }
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((r) => setTimeout(r, 25));
    if (room.state && predicate(room.state)) {
      return;
    }
  }
  throw new Error(
    `waitForState timed out after ${timeoutMs}ms; last state=${JSON.stringify(
      room.state,
    )}`,
  );
}

/**
 * Read the server-side player entry from the client-decoded state.
 *
 * The SDK decodes `players` as a live `MapSchema`, so access goes through
 * `.get(...)` (a `MapSchema` has no bracket indexer). The defensive
 * bracket-access fallback keeps the helper honest if a future decode path
 * returns a plain object.
 */
function playerFromState(state: any, sessionId: string): any {
  const players = state?.players;
  if (!players) return undefined;
  if (typeof players.get === "function") return players.get(sessionId);
  return players[sessionId];
}

function makeFrame(partial: Partial<PlayerInputFrame>): PlayerInputFrame {
  return {
    sequence: 0,
    moveX: 0,
    moveZ: 0,
    lookYaw: 0,
    lookPitch: 0,
    jump: false,
    ...partial,
  };
}

/**
 * Leave a client room and close its underlying connection.
 *
 * The SDK's `room.leave()` only instructs the server to remove the client
 * from the room; the WebSocket itself stays open, which keeps the server-side
 * room (and therefore `gracefullyShutdown`) alive. Closing the connection
 * lets the server-side room autoDispose promptly.
 */
async function teardownRoom(room: ClientRoom | null): Promise<void> {
  if (!room) return;
  // Ask the server to drop us from the room, but do NOT block on the ack —
  // under load that ack can be slow, and it is not what releases the socket.
  room.leave().catch(() => {
    /* already gone / not joined — ignore */
  });
  // Closing the connection is what actually tears down the server-side room
  // (and lets `gracefullyShutdown` proceed); it must run even if leave() is
  // still pending.
  try {
    room.connection.close();
  } catch {
    /* connection already closed — ignore */
  }
}

/**
 * Race `promise` against a deadline.
 *
 * Resolves/rejects when `promise` settles. If the deadline elapses first, the
 * promise REJECTS with a descriptive error so a genuine teardown/shutdown
 * timeout FAILS the suite instead of silently passing. (A timeout during
 * `afterAll` therefore surfaces as a test failure, never as a swallowed
 * `undefined`.) The explicit connection-close in `teardownRoom` keeps the
 * teardown fast and deterministic, so this guard is a safety net, not the
 * normal path.
 */
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
              `[buildshift:2b2] teardown timeout: "${label}" did not finish within ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe("Stage 2B2 stateful foundation room + input handling", () => {
  let server: GameServer;
  let port: number;
  let client: Client;
  let room: ClientRoom;
  let secondClient: Client | null = null;
  let secondRoom: ClientRoom | null = null;

  beforeAll(async () => {
    const started = await startServer(0);
    server = started.server;
    port = started.port;
    expect(port).toBeGreaterThan(0);

    client = new Client(`ws://127.0.0.1:${port}`);
    room = await client.joinOrCreate(FOUNDATION_ROOM);
    expect(room.sessionId).toEqual(expect.any(String));

    // Wait for the initial full-state to arrive with our player entry.
    await waitForState(room, (s) => playerFromState(s, room.sessionId));
  }, 20_000);

  afterAll(async () => {
    // Tear down any rooms we still hold. Each phase runs under a deadline that
    // REJECTS (fails the suite) if it does not finish in time — a teardown or
    // shutdown hang must surface as a failure, never a silent pass. `teardownRoom`
    // closes the SDK connections explicitly, which is what makes the teardown
    // fast and deterministic, so these are safety nets. Worst-case total:
    // 3 + 3 + 8 = 14s, leaving headroom under the hook's 20s budget even under
    // parallel-load timer skew.
    await withDeadline(teardownRoom(secondRoom), 3_000, "teardownRoom(second)");
    await withDeadline(teardownRoom(room), 3_000, "teardownRoom(primary)");
    await withDeadline(shutdownServer(server), 8_000, "shutdownServer");
    expect(server).toBeDefined();
  }, 20_000);

  it("registers the room under the protocol name ROOMS.FOUNDATION", () => {
    expect(FOUNDATION_ROOM).toBe(ROOMS.FOUNDATION);
  });

  it("creates the player at the neutral bootstrap spawn on join", async () => {
    const p = playerFromState(room.state, room.sessionId);
    expect(p).toBeDefined();
    // Neutral bootstrap spawn (documented, non-gameplay) — read via the
    // NESTED `position` ref so the test proves the nested shape survives
    // real Colyseus serialization/patching on the wire.
    expect(p.position).toBeDefined();
    expect(p.position.x).toBe(0);
    expect(p.position.y).toBe(0);
    expect(p.position.z).toBe(0);
    // No input processed yet.
    expect(p.acknowledgedSequence).toBe(-1);
    // Initial yaw.
    expect(p.yaw).toBe(0);
    // Stable id = the Colyseus client sessionId.
    expect(p.playerId).toBe(room.sessionId);
  });

  it("processes a valid PLAYER_INPUT frame and advances acknowledgedSequence", async () => {
    const frame = makeFrame({
      sequence: 0,
      moveX: 0.3,
      moveZ: -0.2,
      lookYaw: 1.23,
      lookPitch: -0.1,
      jump: false,
    });
    room.send(EVENTS.PLAYER_INPUT, frame);

    await waitForState(
      room,
      (s) => playerFromState(s, room.sessionId)?.acknowledgedSequence === 0,
    );

    const p = playerFromState(room.state, room.sessionId);
    expect(p.acknowledgedSequence).toBe(0);
    expect(p.yaw).toBeCloseTo(1.23, 6);
    // Movement is acknowledged but not integrated yet (Stage 2C) — the nested
    // position is still the neutral bootstrap spawn.
    expect(p.position.x).toBe(0);
    expect(p.position.y).toBe(0);
    expect(p.position.z).toBe(0);
  });

  it("advances acknowledgedSequence for a strictly-higher sequence", async () => {
    const frame = makeFrame({ sequence: 1, lookYaw: 0.5, jump: true });
    room.send(EVENTS.PLAYER_INPUT, frame);

    await waitForState(
      room,
      (s) => playerFromState(s, room.sessionId)?.acknowledgedSequence === 1,
    );
    const p = playerFromState(room.state, room.sessionId);
    expect(p.acknowledgedSequence).toBe(1);
    expect(p.yaw).toBeCloseTo(0.5, 6);
  });

  it("skips ahead for a larger higher sequence", async () => {
    const frame = makeFrame({ sequence: 42, lookYaw: -2.1 });
    room.send(EVENTS.PLAYER_INPUT, frame);

    await waitForState(
      room,
      (s) => playerFromState(s, room.sessionId)?.acknowledgedSequence === 42,
    );
    const p = playerFromState(room.state, room.sessionId);
    expect(p.acknowledgedSequence).toBe(42);
    expect(p.yaw).toBeCloseTo(-2.1, 6);
  });

  it("ignores a DUPLICATE (equal) sequence — no state change", async () => {
    const before = playerFromState(room.state, room.sessionId);
    expect(before.acknowledgedSequence).toBe(42);
    const yawBefore = before.yaw;

    // Re-send the same sequence that was just accepted.
    const frame = makeFrame({ sequence: 42, lookYaw: 9.99 });
    room.send(EVENTS.PLAYER_INPUT, frame);

    // Give the server a tick to process it (and NOT change anything).
    await new Promise((r) => setTimeout(r, 150));

    const after = playerFromState(room.state, room.sessionId);
    expect(after.acknowledgedSequence).toBe(42);
    expect(after.yaw).toBeCloseTo(yawBefore, 6);
  });

  it("ignores a LOWER (out-of-order) sequence — no state change", async () => {
    const before = playerFromState(room.state, room.sessionId);
    expect(before.acknowledgedSequence).toBe(42);
    const yawBefore = before.yaw;

    // A lower sequence than the one already acknowledged.
    const frame = makeFrame({ sequence: 7, lookYaw: 3.14 });
    room.send(EVENTS.PLAYER_INPUT, frame);

    await new Promise((r) => setTimeout(r, 150));

    const after = playerFromState(room.state, room.sessionId);
    expect(after.acknowledgedSequence).toBe(42);
    expect(after.yaw).toBeCloseTo(yawBefore, 6);
  });

  // A structurally-valid frame at sequence 99, used as the base that each
  // single-field structural-violation case corrupts.
  //
  // IMPORTANT: the whole payload is sent VERBATIM. For the shape-violation
  // cases (array / null) we must NOT spread into a valid base — spreading an
  // array yields index-keyed properties and spreading null yields nothing,
  // both of which would accidentally form a valid frame at sequence 99.
  const malformedBase = makeFrame({ sequence: 99 });

  it.each([
    // Structural (single-field) failures caught by the protocol validator:
    ["negative sequence", { ...malformedBase, sequence: -1 }],
    ["moveX out of [-1, 1]", { ...malformedBase, moveX: 1.5 }],
    ["moveZ out of [-1, 1]", { ...malformedBase, moveZ: -2 }],
    ["non-finite moveX", { ...malformedBase, moveX: Number.NaN }],
    [
      "out-of-range lookPitch (> π)",
      { ...malformedBase, lookPitch: Math.PI + 0.5 },
    ],
    [
      "out-of-range lookPitch (< -π)",
      { ...malformedBase, lookPitch: -Math.PI - 0.5 },
    ],
    ["non-boolean jump", { ...malformedBase, jump: "nope" }],
    // Whole-payload shape violations — sent raw, not merged:
    ["wrong shape (array)", [1, 2, 3]],
    ["wrong shape (null)", null],
  ])(
    "ignores a malformed frame: %s",
    async (_label, payload) => {
      const before = playerFromState(room.state, room.sessionId);
      const ackBefore = before.acknowledgedSequence;
      const yawBefore = before.yaw;

      room.send(EVENTS.PLAYER_INPUT, payload);

      // Give the server a tick to process it (and NOT change anything).
      await new Promise((r) => setTimeout(r, 150));

      const after = playerFromState(room.state, room.sessionId);
      // State is untouched.
      expect(after.acknowledgedSequence).toBe(ackBefore);
      expect(after.yaw).toBeCloseTo(yawBefore, 6);
    },
  );

  it("still accepts a higher sequence AFTER malformed frames", async () => {
    const frame = makeFrame({ sequence: 99, lookYaw: 0.75 });
    room.send(EVENTS.PLAYER_INPUT, frame);

    await waitForState(
      room,
      (s) => playerFromState(s, room.sessionId)?.acknowledgedSequence === 99,
    );
    const p = playerFromState(room.state, room.sessionId);
    expect(p.acknowledgedSequence).toBe(99);
    expect(p.yaw).toBeCloseTo(0.75, 6);
  });

  it("removes the player from state when that client leaves", async () => {
    // Use a SECOND client for the leave test so the primary room (used by the
    // input tests) stays alive; we directly observe the second player's entry
    // appear on the primary client's decoded state, then vanish on leave.
    secondClient = new Client(`ws://127.0.0.1:${port}`);
    secondRoom = await secondClient.joinOrCreate(FOUNDATION_ROOM);
    const secondSessionId = secondRoom.sessionId;
    expect(secondSessionId).not.toBe(room.sessionId);

    // The primary client's decoded state should now include the second player.
    await waitForState(
      room,
      (s) => playerFromState(s, secondSessionId),
    );
    expect(playerFromState(room.state, secondSessionId)).toBeDefined();

    await secondRoom.leave();

    // The removal patch should propagate to the primary client's state.
    await waitForState(
      room,
      (s) => playerFromState(s, secondSessionId) === undefined,
    );
    expect(playerFromState(room.state, secondSessionId)).toBeUndefined();

    // The primary player is unaffected.
    expect(
      playerFromState(room.state, room.sessionId),
    ).toBeDefined();
  });
});
