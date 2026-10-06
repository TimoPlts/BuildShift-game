/**
 * Production room registration contract (test-only).
 *
 * This contract exercises the REAL server creation/registration path —
 * `createServer()` (which performs
 * `server.define(ROOMS.TWO_PLAYER_MOVEMENT, TwoPlayerMovementRoom)`) — and
 * proves the canonical Energy Box Fight production transport route:
 *
 *   1. The production server registers the canonical
 *      `ROOMS.TWO_PLAYER_MOVEMENT` / `"two-player-movement"` room, and a real
 *      client can join it (the room's `onCreate` runs and its authoritative
 *      `RoomStateSchema` — e.g. `matchPhase` — becomes live over the wire).
 *   2. No separate "box-fight" TRANSPORT room is registered on the production
 *      server. `box-fight` survives only as the shared game-mode LABEL
 *      (`GAME_MODES.BOX_FIGHT`); attempting to join the retired `box-fight`
 *      transport route is rejected.
 *
 * The contract is deliberately black-box: it drives real `@colyseus/sdk`
 * clients against the server produced by the production `createServer()`, so
 * it validates the ACTUAL registration rather than a re-implementation.
 *
 * All waits are bounded (explicit timeouts) so CI can never hang.
 *
 * NOTE: test-only. This file does NOT modify production server behaviour or
 * any gameplay test; it only asserts on the existing production registration.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";

import { GAME_MODES, ROOMS } from "@buildshift/protocol";

import {
  createServer,
  startServer,
  shutdownServer,
  TWO_PLAYER_ROOM,
  type GameServer,
} from "../server.js";
import { TWO_PLAYER_MOVEMENT_ROOM } from "./TwoPlayerMovementRoom.js";
import { BOX_FIGHT_ROOM } from "./boxFightContract.js";

/** The canonical production transport route name (single source of truth). */
const CANONICAL_ROUTE = ROOMS.TWO_PLAYER_MOVEMENT;

/**
 * Wrap a promise with a hard deadline. Resolves with the inner value, or
 * rejects (timeout error) if the inner promise does not settle in time — so a
 * stuck join cannot hang CI.
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
              `[productionRoomRegistration] timeout: "${label}" did not settle within ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Bounded polling wait on a client room's decoded state. */
async function waitForState(
  room: ClientRoom,
  predicate: (state: unknown) => boolean,
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

/** Bounded teardown of a client room + connection. */
async function teardownRoom(room: ClientRoom | null | undefined): Promise<void> {
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

/**
 * Best-effort release of a `Client`'s underlying connection (used for the
 * rejected box-fight join, where no room handle is available). This SDK
 * version's public `Client` type does not expose `connection`, but the
 * property is present at runtime; access it structurally and defensively.
 */
function releaseClientConnection(client: Client): void {
  try {
    const handle = client as unknown as {
      connection?: { close?: () => void };
    };
    handle.connection?.close?.();
  } catch {
    /* connection already closed — ignore */
  }
}

describe("Production room registration contract (canonical two-player-movement)", () => {
  let server: GameServer;
  let port: number;

  beforeAll(async () => {
    // Exercise the REAL production creation/registration path: `createServer()`
    // is exactly what boots the production server (see index.ts), and it is the
    // function under test here — we do not re-register any room ourselves.
    const created = createServer();
    const started = await withDeadline(startServer(0, created), 10_000, "startServer");
    server = started.server;
    port = started.port;
    expect(port).toBeGreaterThan(0);
  }, 20_000);

  afterAll(async () => {
    await withDeadline(shutdownServer(server), 8_000, "shutdownServer");
  }, 20_000);

  // ─── Contract: the route identifiers are consistent ───────────────────────

  it("registers the canonical route ROOMS.TWO_PLAYER_MOVEMENT == 'two-player-movement'", () => {
    // The protocol constant is the canonical production transport route.
    expect(ROOMS.TWO_PLAYER_MOVEMENT).toBe("two-player-movement");
    expect(CANONICAL_ROUTE).toBe("two-player-movement");

    // The room-local route name and the server's exported alias all agree with
    // the shared protocol constant (one source of truth, no drift).
    expect(TWO_PLAYER_MOVEMENT_ROOM).toBe(ROOMS.TWO_PLAYER_MOVEMENT);
    expect(TWO_PLAYER_ROOM).toBe(ROOMS.TWO_PLAYER_MOVEMENT);

    // "Box Fight" is retained ONLY as the shared game-mode LABEL — it is not a
    // transport-route identifier distinct from the retired room name.
    expect(GAME_MODES.BOX_FIGHT).toBe("box-fight");
    expect(BOX_FIGHT_ROOM).toBe("box-fight");
    // The game-mode label and the retired transport route are different routes
    // from the canonical production route.
    expect(GAME_MODES.BOX_FIGHT).not.toBe(CANONICAL_ROUTE);
  });

  // ─── Contract: the canonical room is registered and joinable ──────────────

  it("a real client can join the registered 'two-player-movement' room (onCreate ran)", async () => {
    const client = new Client(`ws://127.0.0.1:${port}`);
    const room = await withDeadline(
      client.joinOrCreate(CANONICAL_ROUTE),
      10_000,
      "join two-player-movement",
    );

    try {
      // A successful join means the production server has the canonical room
      // registered under this route AND the room was created (onCreate ran,
      // which starts the 30 Hz tick loop).
      expect(room.sessionId).toEqual(expect.any(String));
      expect(room.roomId).toEqual(expect.any(String));

      // The authoritative RoomStateSchema is live over the wire: `matchPhase`
      // is set in `onCreate` and is part of the canonical room's state. This
      // proves the registered room is the canonical TwoPlayerMovementRoom, not
      // an empty stub room merely named 'two-player-movement'.
      await withDeadline(
        waitForState(
          room,
          (s) => {
            const st = s as Record<string, unknown> | null;
            return st != null && typeof st.matchPhase === "string";
          },
          5_000,
        ),
        8_000,
        "waitForState(matchPhase)",
      );
    } finally {
      await withDeadline(teardownRoom(room), 5_000, "teardown canonical room");
    }
  });

  // ─── Contract: NO separate box-fight transport room is registered ─────────

  it("does NOT register a separate 'box-fight' transport room", async () => {
    const client = new Client(`ws://127.0.0.1:${port}`);

    let joined: ClientRoom | undefined;
    let joinError: unknown;
    try {
      // If a 'box-fight' transport room WERE registered, this would resolve to a
      // joined room. Because BoxFightRoom has been retired from the production
      // registration path, the join must fail (unknown/undefined room type).
      joined = await withDeadline(
        client.joinOrCreate(BOX_FIGHT_ROOM),
        5_000,
        "join box-fight",
      );
    } catch (err) {
      joinError = err;
    } finally {
      releaseClientConnection(client);
    }

    // Core contract: the retired box-fight transport route is NOT registered —
    // the join did not produce a live room.
    expect(joined).toBeUndefined();
    expect(joinError).toBeDefined();

    // Document (but do not hard-fail on version-specific wording of) why the
    // retired transport route was rejected.
    const msg =
      joinError instanceof Error ? joinError.message : String(joinError);
    expect(msg.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(
      `[productionRoomRegistration] box-fight transport join rejected as expected: ${msg}`,
    );
  });
});
