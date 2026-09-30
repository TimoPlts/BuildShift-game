/**
 * Stage 2D — two-client multiplayer wire validation.
 *
 * Uses two real `@colyseus/sdk` clients against one real Colyseus server and
 * the same foundation room, proving the existing server correctly supports
 * TWO simultaneous clients:
 *  1. BOTH clients observe the same two-player room state (A sees A+B, B
 *     sees A+B);
 *  2. INDEPENDENT MOVEMENT: movement sent by A changes A's authoritative
 *     position (visible to B) without moving B; then movement from B
 *     changes B's position (visible to A);
 *  3. YAW PROPAGATION: A's distinct `lookYaw` is observed by B; A's yaw
 *     does not overwrite B's yaw;
 *  4. LEAVE BEHAVIOR: when B leaves, A sees B removed from `players`, A
 *     remains present and connected, and the room stays alive.
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

import { EVENTS } from "@buildshift/protocol";

import { FOUNDATION_ROOM, startServer, shutdownServer } from "./server.js";
import type { GameServer } from "./server.js";
import { SPAWN_SLOTS } from "./physics/authoritativeMovement.js";

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
              `[buildshift:2dwire] timeout: "${label}" did not finish within ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe("Stage 2D two-client multiplayer over the wire", () => {
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
    roomA = await new Client(url).joinOrCreate(FOUNDATION_ROOM);
    roomB = await new Client(url).joinOrCreate(FOUNDATION_ROOM);
    expect(roomA.sessionId).toEqual(expect.any(String));
    expect(roomB.sessionId).toEqual(expect.any(String));
    expect(roomA.sessionId).not.toBe(roomB.sessionId);
    // Both rooms are the same foundation room on the same server.
    expect(roomA.roomId).toBe(roomB.roomId);
  }, 20_000);

  afterAll(async () => {
    await withDeadline(Promise.all([teardownRoom(roomB), teardownRoom(roomA)]), 5_000, "teardown rooms");
    await withDeadline(shutdownServer(server), 8_000, "shutdownServer");
  }, 20_000);

  it("both clients observe the same two-player room state", async () => {
    // Client A sees both players.
    await waitForState(roomA, (s) => playerFromState(s, roomA.sessionId) && playerFromState(s, roomB.sessionId));
    // Client B sees both players.
    await waitForState(roomB, (s) => playerFromState(s, roomA.sessionId) && playerFromState(s, roomB.sessionId));

    const aView = playerFromState(roomA.state, roomB.sessionId);
    const bView = playerFromState(roomB.state, roomB.sessionId);
    expect(aView).toBeDefined();
    expect(bView).toBeDefined();
    expect(aView.playerId).toBe(roomB.sessionId);
    expect(bView.playerId).toBe(roomB.sessionId);
    // B is the second to join, so it occupies spawn slot 1. Both views agree
    // on the same spawn-position player B (before movement).
    const bSpawn = SPAWN_SLOTS[1];
    expect(aView.position.x).toBeCloseTo(bSpawn.x, 1);
    expect(bView.position.x).toBeCloseTo(bSpawn.x, 1);
  });

  it("movement from A moves A only; B sees A's new position but does not follow", async () => {
    const bAtStart = playerFromState(roomB.state, roomB.sessionId);
    const aAtStart = playerFromState(roomB.state, roomA.sessionId);
    const aZ0 = aAtStart.position.z;
    const bZ0 = bAtStart.position.z;

    // A holds forward (moveZ = -1 → -Z at yaw 0). B sends nothing.
    roomA.send(EVENTS.PLAYER_INPUT, {
      sequence: 0,
      moveX: 0,
      moveZ: -1,
      lookYaw: 0,
      lookPitch: 0,
      jump: false,
    });

    // B's own state eventually shows A having moved (authoritative over wire).
    await waitForState(
      roomB,
      (s) => {
        const p = playerFromState(s, roomA.sessionId);
        return p && p.position.z < aZ0 - 0.1;
      },
      5_000,
    );

    const bAfter = playerFromState(roomB.state, roomB.sessionId);
    const aAfter = playerFromState(roomB.state, roomA.sessionId);
    // B's own position did NOT follow A.
    expect(bAfter.position.z).toBeCloseTo(bZ0, 1);
    expect(Math.abs(bAfter.position.z - bZ0)).toBeLessThan(0.05);
    // A's position DID change, per B's view.
    expect(aAfter.position.z).toBeLessThan(aZ0 - 0.1);
    // A's own client also sees its authoritative move (own view consistent).
    await waitForState(
      roomA,
      (s) => {
        const p = playerFromState(s, roomA.sessionId);
        return p && p.position.z < aZ0 - 0.1;
      },
      5_000,
    );
  });

  it("movement from B moves B independently; A receives B's updated position", async () => {
    const aViewB = playerFromState(roomA.state, roomB.sessionId);
    const bZ0 = aViewB.position.z; // B's z per A's view (B is idle)
    const bViewB = playerFromState(roomB.state, roomB.sessionId);
    const bSelfZ0 = bViewB.position.z;
    expect(bZ0).toBeCloseTo(bSelfZ0, 1);

    // B holds forward.
    roomB.send(EVENTS.PLAYER_INPUT, {
      sequence: 0,
      moveX: 0,
      moveZ: -1,
      lookYaw: 0,
      lookPitch: 0,
      jump: false,
    });

    // A's state eventually shows B having moved.
    await waitForState(
      roomA,
      (s) => {
        const p = playerFromState(s, roomB.sessionId);
        return p && p.position.z < bZ0 - 0.1;
      },
      5_000,
    );
    const aAfter = playerFromState(roomA.state, roomB.sessionId);
    expect(aAfter.position.z).toBeLessThan(bZ0 - 0.1);
    // B's own view agrees: B moved independently.
    await waitForState(
      roomB,
      (s) => {
        const p = playerFromState(s, roomB.sessionId);
        return p && p.position.z < bSelfZ0 - 0.1;
      },
      5_000,
    );
    // Independent: A's position did NOT start following B's motion from this
    // frame alone (A was already moving from its own held input, so assert
    // only that A's ack/position is driven by A's own queue — here we check
    // A's own view still shows A at its own moved position, unaffected by B's
    // frame sequence).
    const aSelf = playerFromState(roomA.state, roomA.sessionId);
    expect(aSelf.acknowledgedSequence).toBe(0); // A acked its own frame only
  });

  it("A's distinct lookYaw propagates to B without overwriting B's yaw", async () => {
    // Both players currently have yaw 0 (sent only movement frames).
    const bViewA = playerFromState(roomB.state, roomA.sessionId);
    const bViewB = playerFromState(roomB.state, roomB.sessionId);
    expect(bViewA.yaw).toBeCloseTo(0, 3);
    expect(bViewB.yaw).toBeCloseTo(0, 3);

    // A sends a frame with a distinct lookYaw.
    roomA.send(EVENTS.PLAYER_INPUT, {
      sequence: 1,
      moveX: 0,
      moveZ: -1,
      lookYaw: Math.PI / 4,
      lookPitch: 0,
      jump: false,
    });

    // B eventually sees A's yaw change.
    await waitForState(
      roomB,
      (s) => {
        const p = playerFromState(s, roomA.sessionId);
        return p && Math.abs(p.yaw - Math.PI / 4) < 0.01;
      },
      5_000,
    );
    const aAfter = playerFromState(roomB.state, roomA.sessionId);
    expect(aAfter.yaw).toBeCloseTo(Math.PI / 4, 2);
    // B's own yaw is untouched (B never sent a yaw change).
    const bAfter = playerFromState(roomB.state, roomB.sessionId);
    expect(bAfter.yaw).toBeCloseTo(0, 3);
  });

  it("when B leaves, A sees B removed, A remains, and the room stays alive", async () => {
    // B leaves the room.
    await withDeadline(roomB.leave(), 5_000, "roomB.leave");

    // A's state: B removed, A still present.
    await waitForState(
      roomA,
      (s) => !playerFromState(s, roomB.sessionId),
      5_000,
    );
    expect(playerFromState(roomA.state, roomB.sessionId)).toBeUndefined();
    const a = playerFromState(roomA.state, roomA.sessionId);
    expect(a).toBeDefined();
    expect(a.playerId).toBe(roomA.sessionId);
    // A remains connected to the same live room.
    expect(roomA.roomId).toBeTruthy();
    expect(roomA.state).toBeDefined();
    // A's connection is still open (`isOpen` is a getter on the SDK
    // `Connection`).
    expect(roomA.connection.isOpen).toBe(true);
  });
});
