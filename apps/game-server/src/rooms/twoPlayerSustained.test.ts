/**
 * Stage 2D — sustained two-peer integration test (60+ frames).
 *
 * Simulates two peers driving the canonical `TwoPlayerMovementRoom` over
 * 75 frames (2.5 s at 30 Hz). Verifies:
 *  1. SUSTAINED MOVEMENT (prediction): positions advance monotonically.
 *  2. RECONCILIATION: lastProcessedSequence tracks each frame.
 *  3. INDEPENDENCE (interpolation): both clients observe consistent state.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";
import { PLAYER_MOVEMENT, VERTICAL_MOVEMENT } from "@buildshift/game-config";
import { startServer, shutdownServer } from "../server.js";
import type { GameServer } from "../server.js";
import {
  TWO_PLAYER_MOVEMENT_ROOM,
  TWO_PLAYER_MOVEMENT_INPUT,
} from "./TwoPlayerMovementRoom.js";

const TICK_RATE_HZ = 30;
const MIN_FRAMES = 75;
const DISPLACEMENT_PER_TICK = PLAYER_MOVEMENT.moveSpeed / TICK_RATE_HZ;

async function waitForState(
  room: ClientRoom,
  predicate: (state: unknown) => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const startedAt = Date.now();
  if (room.state && predicate(room.state)) return;
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((r) => setTimeout(r, 20));
    if (room.state && predicate(room.state)) return;
  }
  throw new Error(
    `waitForState timed out after ${timeoutMs}ms; last state=${JSON.stringify(room.state)}`,
  );
}

function waitMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function playerFromState(state: unknown, sessionId: string): any {
  const s = state as Record<string, any>;
  const players = s?.players;
  if (!players) return undefined;
  if (typeof players.get === "function") return players.get(sessionId);
  return players[sessionId];
}

async function teardownRoom(room: ClientRoom | null): Promise<void> {
  if (!room) return;
  room.leave().catch(() => {});
  try {
    room.connection.close();
  } catch {}
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
        timer = setTimeout(
          () => reject(new Error(`[sustained] timeout: "${label}" ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sendInput(room: ClientRoom, seq: number, moveX: number, moveZ: number): void {
  room.send(TWO_PLAYER_MOVEMENT_INPUT, {
    sequence: seq, moveX, moveZ, lookYaw: 0, lookPitch: 0,
    jump: false, sprint: false, crouch: false, primaryFire: false, secondaryFire: false,
  });
}

describe("TwoPlayerMovementRoom sustained 60+ frame simulation", () => {
  let server: GameServer;
  let port: number;
  let roomA: ClientRoom;
  let roomB: ClientRoom;

  beforeAll(async () => {
    const started = await withDeadline(startServer(0), 10_000, "startServer");
    server = started.server;
    port = started.port;
    const url = `ws://127.0.0.1:${port}`;
    roomA = await withDeadline(new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM), 10_000, "join A");
    roomB = await withDeadline(new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM), 10_000, "join B");
    expect(roomA.sessionId).not.toBe(roomB.sessionId);
    expect(roomA.roomId).toBe(roomB.roomId);
  }, 30_000);

  afterAll(async () => {
    await withDeadline(Promise.all([teardownRoom(roomB), teardownRoom(roomA)]), 5_000, "teardown");
    await withDeadline(shutdownServer(server), 8_000, "shutdown");
  }, 30_000);

  it("drives both peers over 75 frames: movement, reconciliation, independence", async () => {
    // Wait for both players to be visible.
    await waitForState(roomA, (s) => playerFromState(s, roomA.sessionId) && playerFromState(s, roomB.sessionId));
    await waitForState(roomB, (s) => playerFromState(s, roomA.sessionId) && playerFromState(s, roomB.sessionId));

    // Record spawn positions.
    const a0 = playerFromState(roomA.state, roomA.sessionId);
    const b0 = playerFromState(roomA.state, roomB.sessionId);
    expect(Math.abs(a0.x - (-5))).toBeLessThan(0.5);
    expect(Math.abs(a0.z)).toBeLessThan(0.5);
    expect(Math.abs(b0.x - 5)).toBeLessThan(0.5);
    expect(Math.abs(b0.z)).toBeLessThan(0.5);

    // Send 75 frames: A forward (moveZ=-1), B right (moveX=+1).
    const tickMs = Math.ceil(1000 / TICK_RATE_HZ);
    for (let f = 0; f < MIN_FRAMES; f++) {
      sendInput(roomA, f, 0, -1);
      sendInput(roomB, f, 1, 0);
      await waitMs(tickMs);
    }

    // Wait for final sequence to be processed.
    const finalSeq = MIN_FRAMES - 1;
    await waitForState(roomA, (s) => playerFromState(s, roomA.sessionId)?.lastProcessedSequence >= finalSeq, 5_000);
    await waitForState(roomB, (s) => playerFromState(s, roomB.sessionId)?.lastProcessedSequence >= finalSeq, 5_000);
    await waitMs(100);

    // Read final state.
    const af = playerFromState(roomA.state, roomA.sessionId);
    const bf = playerFromState(roomB.state, roomB.sessionId);

    // PREDICTION: sustained displacement in correct direction.
    expect(af.z).toBeLessThan(0); // A moved forward (−Z)
    expect(af.z - a0.z).toBeLessThan(-(MIN_FRAMES / 4) * DISPLACEMENT_PER_TICK);
    expect(bf.x).toBeLessThan(5); // B moved right (−X from +5)
    expect(b0.x - bf.x).toBeGreaterThan((MIN_FRAMES / 4) * DISPLACEMENT_PER_TICK);

    // RECONCILIATION: sequences tracked correctly.
    expect(af.lastProcessedSequence).toBeGreaterThanOrEqual(finalSeq);
    expect(bf.lastProcessedSequence).toBeGreaterThanOrEqual(finalSeq);

    // INDEPENDENCE: A's x unchanged, B's z unchanged.
    expect(Math.abs(af.x - a0.x)).toBeLessThan(0.5);
    expect(Math.abs(bf.z - b0.z)).toBeLessThan(0.5);

    // INTERPOLATION: both clients observe consistent state.
    const aInB = playerFromState(roomB.state, roomA.sessionId);
    const bInA = playerFromState(roomA.state, roomB.sessionId);
    expect(aInB.x).toBeCloseTo(af.x, 1);
    expect(aInB.z).toBeCloseTo(af.z, 1);
    expect(bInA.x).toBeCloseTo(bf.x, 1);
    expect(bInA.z).toBeCloseTo(bf.z, 1);

    // Grounded (no jump sent).
    expect(af.grounded).toBe(true);
    expect(bf.grounded).toBe(true);
    expect(af.y).toBeCloseTo(VERTICAL_MOVEMENT.groundY, 1);
  }, 30_000);

  it("out-of-order input after sustained session is rejected; next sequence accepted", async () => {
    const a = playerFromState(roomA.state, roomA.sessionId);
    const seqBefore = a.lastProcessedSequence;

    // Send a LOWER (out-of-order) sequence — should be rejected.
    sendInput(roomA, 0, 0, -1); // seq 0 < seqBefore
    await waitMs(200);

    const aAfter = playerFromState(roomA.state, roomA.sessionId);
    expect(aAfter.lastProcessedSequence).toBe(seqBefore);

    // Send the NEXT higher sequence — should be accepted.
    sendInput(roomA, seqBefore + 1, 0, -1);
    await waitForState(
      roomA,
      (s) => playerFromState(s, roomA.sessionId)?.lastProcessedSequence >= seqBefore + 1,
      5_000,
    );
    expect(playerFromState(roomA.state, roomA.sessionId).lastProcessedSequence).toBeGreaterThanOrEqual(seqBefore + 1);
  }, 15_000);
});
