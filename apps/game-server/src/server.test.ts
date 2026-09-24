/**
 * Stage 2A bootstrap smoke test.
 *
 * Proves, end to end over the wire, that the Colyseus foundation actually
 * works:
 *  1. the server boots on a free (ephemeral) port;
 *  2. the `foundation` room is registered and joinable;
 *  3. a real SDK client joins, and the server-side room cache reflects one
 *     connected client;
 *  4. a second client joins then leaves, and the server-side room cache
 *     reflects the change (2 → 1);
 *  5. our own client leaves, and the server-side cache drops to zero live
 *     clients;
 *  6. the server shuts down cleanly with no thrown errors.
 *
 * The room is stateless (see `FoundationRoom`), so no shared `Schema` /
 * protocol contract is required — keeping this test within the Stage 2A
 * boundary.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";
import { matchMaker, type IRoomCache } from "@colyseus/core";

import { FOUNDATION_ROOM, startServer, shutdownServer } from "./server.js";
import type { GameServer } from "./server.js";

/**
 * Look up a `foundation` room in the server-side matchmaker cache.
 *
 * `matchMaker.driver` is the authoritative source of truth for connected
 * client counts — the room cache entry's `clients` field is updated by the
 * room as clients join/leave, so asserting on it proves the server-side
 * lifecycle actually ran (not merely that the client-side promise
 * resolved).
 */
async function findFoundationRoom(
  roomId?: string,
): Promise<IRoomCache | undefined> {
  const rooms = await matchMaker.driver.query({ name: FOUNDATION_ROOM });
  if (roomId !== undefined) {
    return rooms.find((r) => r.roomId === roomId);
  }
  return rooms[0];
}

describe("Stage 2A Colyseus foundation", () => {
  let server: GameServer;
  let port: number;
  let room: ClientRoom;

  beforeAll(async () => {
    // Port 0 → the OS picks a free port; `startServer` reports the real one.
    const started = await startServer(0);
    server = started.server;
    port = started.port;
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
  }, 20_000);

  afterAll(async () => {
    // `shutdownServer` must resolve without throwing. The server object
    // still exists (we hold the reference); we only assert the graceful
    // shutdown completed.
    await shutdownServer(server);
    expect(server).toBeDefined();
  }, 20_000);

  it("boots and reports a bound port", () => {
    expect(port).toBeGreaterThan(0);
  });

  it("exposes the foundation room and accepts a real client join", async () => {
    const client = new Client(`ws://127.0.0.1:${port}`);
    room = await client.joinOrCreate(FOUNDATION_ROOM);

    // Client-side: we got both a client session id and the room's instance id.
    // (`sessionId` identifies the client connection; `roomId` identifies the
    // server-side room instance — the driver cache keys rooms by `roomId`.)
    expect(room.sessionId).toEqual(expect.any(String));
    expect(room.roomId).toEqual(expect.any(String));

    // Server-side: the room cache lists our `foundation` room, keyed by the
    // same room instance id the client was told, with exactly one client.
    const cache = await findFoundationRoom(room.roomId);
    expect(cache).toBeDefined();
    expect(cache?.name).toBe(FOUNDATION_ROOM);
    expect(cache?.roomId).toBe(room.roomId);
    expect(cache?.clients).toBe(1);
  }, 20_000);

  it("reflects a second client joining, then leaving, on the server", async () => {
    const secondClient = new Client(`ws://127.0.0.1:${port}`);
    const secondRoom = await secondClient.joinOrCreate(FOUNDATION_ROOM);
    expect(secondRoom.sessionId).toEqual(expect.any(String));

    const afterTwo = await findFoundationRoom();
    expect(afterTwo?.clients).toBe(2);

    await secondRoom.leave();
    const afterLeave = await findFoundationRoom();
    expect(afterLeave?.clients).toBe(1);
  }, 20_000);

  it("drops to zero live clients after our own client leaves", async () => {
    await room.leave();

    // The room may still exist (empty, awaiting autoDispose) or already be
    // gone; either way it must have zero live clients.
    const afterOwnLeave = await findFoundationRoom();
    expect(afterOwnLeave?.clients ?? 0).toBe(0);
  }, 20_000);
});
