/**
 * Integration contract test for the canonical gameplay path.
 *
 * Validates the end-to-end server-authoritative correctness of the single
 * canonical `TwoPlayerMovementRoom`:
 *
 *   1. Two real Colyseus clients join the room and receive distinct spawn
 *      positions from the authoritative state.
 *   2. Client A sends a primary-fire input using the `@buildshift/protocol`
 *      `PlayerNetworkInput` schema.
 *   3. Client B's health (via shield absorption then health) decrements in the
 *      authoritative state — proving server-authoritative damage.
 *   4. The client-facing state (what a HealthHud would read) reflects both
 *      players' health correctly.
 *
 * No mocks are used for the room, protocol schemas, or simulation. Only the
 * network transport (Colyseus WebSocket) is the real thing — the test
 * exercises the full canonical stack: server → room → simulation → state
 * → client patches.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";

import { MAX_HEALTH, MAX_SHIELD, ASSAULT_RIFLE } from "@buildshift/game-config";
import { MatchPhase, type PlayerNetworkInput } from "@buildshift/protocol";

import { startServer, shutdownServer } from "../server.js";
import type { GameServer } from "../server.js";
import {
  TWO_PLAYER_MOVEMENT_ROOM,
  TWO_PLAYER_MOVEMENT_INPUT,
} from "./TwoPlayerMovementRoom.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitForState(
  room: ClientRoom,
  pred: (s: unknown) => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const t0 = Date.now();
  if (room.state && pred(room.state)) return;
  while (Date.now() - t0 < timeoutMs) {
    await wait(25);
    if (room.state && pred(room.state)) return;
  }
  throw new Error(
    `waitForState timed out after ${timeoutMs}ms; last state=${JSON.stringify(
      room.state,
    )}`,
  );
}

/**
 * Extract a player's state entry by sessionId from the decoded client state.
 * Returns a plain snapshot of the fields a HealthHud would read.
 */
function getPlayer(
  state: unknown,
  sessionId: string,
): {
  x: number;
  y: number;
  z: number;
  health: number;
  shield: number;
  ammo: number;
  alive: boolean;
  isEliminated: boolean;
  lastProcessedSequence: number;
  lastFireSequence: number;
} | undefined {
  const s = state as Record<string, any> | undefined;
  const players = s?.players;
  if (!players) return undefined;
  const p =
    typeof players.get === "function" ? players.get(sessionId) : players[sessionId];
  if (!p) return undefined;
  return {
    x: p.x,
    y: p.y,
    z: p.z,
    health: p.health,
    shield: p.shield,
    ammo: p.ammo,
    alive: p.alive,
    isEliminated: p.isEliminated,
    lastProcessedSequence: p.lastProcessedSequence,
    lastFireSequence: p.lastFireSequence,
  };
}

/** Check whether a player entry is present in the state. */
function hasPlayer(state: unknown, sessionId: string): boolean {
  return getPlayer(state, sessionId) !== undefined;
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
          () => reject(new Error(`[contract] timeout: "${label}" ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Build a valid `PlayerNetworkInput` (the protocol input schema) for a
 * primary-fire event aimed at the +X axis (yaw = π/2), which faces Player A
 * (x=-5) toward Player B (x=+5).
 */
function makeFireInput(sequence: number): PlayerNetworkInput {
  return {
    sequence,
    moveX: 0,
    moveZ: 0,
    lookYaw: Math.PI / 2, // face +X (toward player B)
    lookPitch: 0,
    jump: false,
    sprint: false,
    crouch: false,
    primaryFire: true,
    secondaryFire: false,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("Canonical gameplay path — integration contract", () => {
  let server: GameServer;
  let port: number;
  let roomA: ClientRoom;
  let roomB: ClientRoom;

  beforeAll(async () => {
    const started = await withDeadline(startServer(0), 10_000, "startServer");
    server = started.server;
    port = started.port;
    expect(port).toBeGreaterThan(0);

    const url = `ws://127.0.0.1:${port}`;
    roomA = await withDeadline(
      new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM),
      10_000,
      "join A",
    );
    roomB = await withDeadline(
      new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM),
      10_000,
      "join B",
    );

    expect(roomA.sessionId).toEqual(expect.any(String));
    expect(roomB.sessionId).toEqual(expect.any(String));
    expect(roomA.sessionId).not.toBe(roomB.sessionId);
    expect(roomA.roomId).toBe(roomB.roomId);

    // Wait until both players are visible in both clients' state.
    await waitForState(
      roomA,
      (s) => hasPlayer(s, roomA.sessionId) && hasPlayer(s, roomB.sessionId),
    );
    await waitForState(
      roomB,
      (s) => hasPlayer(s, roomA.sessionId) && hasPlayer(s, roomB.sessionId),
    );

    // The room runs a pre-round COUNTDOWN before combat is allowed. Wait for
    // the round to be IN_PROGRESS so fire inputs are processed.
    await waitForState(
      roomA,
      (s) => (s as Record<string, any>)?.matchPhase === MatchPhase.IN_PROGRESS,
      8000,
    );
  }, 20_000);

  afterAll(async () => {
    await withDeadline(
      Promise.all([teardownRoom(roomB), teardownRoom(roomA)]),
      5_000,
      "teardown",
    );
    await withDeadline(shutdownServer(server), 8_000, "shutdown");
  }, 20_000);

  // ─── 1. Distinct spawn positions ────────────────────────────────────────────

  it("both clients receive distinct spawn positions from the authoritative state", () => {
    const a = getPlayer(roomA.state, roomA.sessionId)!;
    const b = getPlayer(roomA.state, roomB.sessionId)!;

    expect(a).toBeDefined();
    expect(b).toBeDefined();

    // Player A (first to join) spawns at x ≈ -5.
    expect(a.x).toBeCloseTo(-5, 0);
    // Player B (second to join) spawns at x ≈ +5.
    expect(b.x).toBeCloseTo(5, 0);

    // They are distinct (not the same position).
    expect(a.x).not.toBeCloseTo(b.x, 0);

    // Both grounded at ground level (y = 0).
    expect(a.y).toBeCloseTo(0, 1);
    expect(b.y).toBeCloseTo(0, 1);

    // Both start at full health and shield.
    expect(a.health).toBe(MAX_HEALTH);
    expect(a.shield).toBe(MAX_SHIELD);
    expect(b.health).toBe(MAX_HEALTH);
    expect(b.shield).toBe(MAX_SHIELD);

    // Both alive and not eliminated.
    expect(a.alive).toBe(true);
    expect(a.isEliminated).toBe(false);
    expect(b.alive).toBe(true);
    expect(b.isEliminated).toBe(false);

    // Both clients see the same state (consistency).
    const aInB = getPlayer(roomB.state, roomA.sessionId)!;
    const bInB = getPlayer(roomB.state, roomB.sessionId)!;
    expect(aInB.x).toBeCloseTo(a.x, 1);
    expect(bInB.x).toBeCloseTo(b.x, 1);
    expect(aInB.health).toBe(a.health);
    expect(bInB.health).toBe(b.health);
  });

  // ─── 2. Primary-fire input causes server-authoritative damage ───────────────

  it("client A's primary-fire input decrements client B's health in the authoritative state", async () => {
    // Record B's initial combat state.
    const bBefore = getPlayer(roomA.state, roomB.sessionId)!;
    expect(bBefore.health).toBe(MAX_HEALTH);
    expect(bBefore.shield).toBe(MAX_SHIELD);

    // Fire 5 shots (sequence 10, 20, 30, 40, 50 — each gap of 10 >
    // fireIntervalTicks=8, so all pass the canFire gate).
    //
    // Damage model: shield (50) absorbs before health (100).
    //   Shot 1: shield 50→30
    //   Shot 2: shield 30→10
    //   Shot 3: shield 10→0, health 100→90
    //   Shot 4: health 90→70
    //   Shot 5: health 70→50
    const sequences = [10, 20, 30, 40, 50];
    for (const seq of sequences) {
      const input: PlayerNetworkInput = makeFireInput(seq);
      roomA.send(TWO_PLAYER_MOVEMENT_INPUT, input);
      // Wait for this shot to be processed (shield or health change).
      await wait(350); // > 8 ticks at 30 Hz (8 ticks ≈ 267ms)
    }

    // Wait until B's health has dropped below MAX_HEALTH.
    await waitForState(
      roomA,
      (s) => {
        const b = getPlayer(s, roomB.sessionId);
        return b !== undefined && b.health < MAX_HEALTH;
      },
      5_000,
    );

    const bAfter = getPlayer(roomA.state, roomB.sessionId)!;

    // Shield is fully depleted.
    expect(bAfter.shield).toBe(0);

    // Health has decremented: total damage = 5×20 = 100.
    // Shield absorbs 50. Health takes the remaining 50.
    const expectedHealth = MAX_HEALTH - (5 * ASSAULT_RIFLE.damage - MAX_SHIELD);
    expect(bAfter.health).toBe(expectedHealth);
    expect(bAfter.health).toBeLessThan(MAX_HEALTH);

    // B is still alive (health > 0).
    expect(bAfter.alive).toBe(true);
    expect(bAfter.isEliminated).toBe(false);

    // A's ammo was decremented by 5.
    const aAfter = getPlayer(roomA.state, roomA.sessionId)!;
    expect(aAfter.ammo).toBe(ASSAULT_RIFLE.maxAmmo - sequences.length);

    // A's lastFireSequence was updated to the last shot.
    expect(aAfter.lastFireSequence).toBe(50);
  });

  // ─── 3. Client-facing state reflects both players' health correctly ─────────

  it("the client-facing state reflects both players' health correctly (HealthHud contract)", async () => {
    // Both clients should agree on the authoritative health values.
    // This is what a HealthHud component would read from the state.

    // From A's perspective:
    const aInA = getPlayer(roomA.state, roomA.sessionId)!;
    const bInA = getPlayer(roomA.state, roomB.sessionId)!;

    // From B's perspective:
    const aInB = getPlayer(roomB.state, roomA.sessionId)!;
    const bInB = getPlayer(roomB.state, roomB.sessionId)!;

    // A's health should still be full (A was not hit).
    expect(aInA.health).toBe(MAX_HEALTH);
    expect(aInA.shield).toBe(MAX_SHIELD);

    // B's health should reflect the damage taken (50, per previous test).
    const totalDamage = 5 * ASSAULT_RIFLE.damage; // 100
    const shieldAbsorbed = Math.min(totalDamage, MAX_SHIELD); // 50
    const healthDamage = totalDamage - shieldAbsorbed; // 50
    const expectedBHealth = MAX_HEALTH - healthDamage; // 50

    expect(bInA.health).toBe(expectedBHealth);
    expect(bInA.shield).toBe(0);

    // Cross-client consistency: both clients see the same values.
    expect(aInB.health).toBe(aInA.health);
    expect(aInB.shield).toBe(aInA.shield);
    expect(bInB.health).toBe(bInA.health);
    expect(bInB.shield).toBe(bInA.shield);

    // Both players are still alive.
    expect(aInA.alive).toBe(true);
    expect(bInA.alive).toBe(true);

    // The HealthHud would display:
    //   - Player A: "100 / 100" health, "Shield: 50 / 50"
    //   - Player B: "50 / 100" health, "Shield: 0 / 50"
    // Verify the values a HealthHud.setHealth() and setShield() would receive:
    const hudAHealthCurrent = aInA.health;
    const hudAHealthMax = MAX_HEALTH;
    const hudBHealthCurrent = bInA.health;
    const hudBHealthMax = MAX_HEALTH;
    expect(hudAHealthCurrent).toBeLessThanOrEqual(hudAHealthMax);
    expect(hudBHealthCurrent).toBeLessThanOrEqual(hudBHealthMax);
    expect(hudAHealthCurrent / hudAHealthMax).toBe(1); // full bar
    expect(hudBHealthCurrent / hudBHealthMax).toBe(0.5); // half bar
  });
});
