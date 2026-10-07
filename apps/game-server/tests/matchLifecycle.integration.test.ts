/**
 * Server integration tests for the match lifecycle state machine.
 *
 * Tests the full match lifecycle of TwoPlayerMovementRoom:
 *  1. Two players joining triggers COUNTDOWN phase.
 *  2. Countdown expires transitions to PLAYING (IN_PROGRESS).
 *  3. Simulating a player death triggers ROUND_OVER (ROUND_ENDED).
 *  4. Winning three rounds triggers MATCH_OVER (MATCH_ENDED).
 *  5. A round reset correctly restores health, energy, and clears builds.
 */
import { describe, expect, it } from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";
import {
  MatchPhase,
  BUILD_EVENTS,
  ENERGY_EVENTS,
  type StructurePlacedEvent,
  type StructureDestroyedEvent,
} from "@buildshift/protocol";
import {
  MAX_HEALTH,
  MAX_SHIELD,
  ENERGY,
  ROUNDS_TO_WIN,
  VERTICAL_MOVEMENT,
} from "@buildshift/game-config";
import { startServer, shutdownServer } from "../src/server.js";
import type { GameServer } from "../src/server.js";
import {
  TWO_PLAYER_MOVEMENT_ROOM,
  TWO_PLAYER_MOVEMENT_INPUT,
} from "../src/rooms/TwoPlayerMovementRoom.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitForState(
  room: ClientRoom,
  pred: (s: unknown) => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const t0 = Date.now();
  if (room.state && pred(room.state)) return;
  while (Date.now() - t0 < timeoutMs) {
    await wait(25);
    if (room.state && pred(room.state)) return;
  }
  throw new Error(`waitForState timeout ${timeoutMs}ms`);
}

function playerFromState(state: unknown, sessionId: string): any {
  const p = (state as Record<string, any>)?.players;
  if (!p) return undefined;
  return typeof p.get === "function" ? p.get(sessionId) : p[sessionId];
}

function phase(state: unknown): string {
  return (state as Record<string, any>)?.matchPhase as string ?? "";
}

function score(state: unknown, sessionId: string): number {
  const rs = (state as Record<string, any>)?.roundScore;
  if (!rs) return 0;
  const e = typeof rs.get === "function" ? rs.get(sessionId) : rs[sessionId];
  return e?.value ?? 0;
}

async function teardown(room: ClientRoom | null): Promise<void> {
  if (!room) return;
  room.leave().catch(() => {});
  try { room.connection.close(); } catch {}
}

async function deadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rj) => { t = setTimeout(() => rj(new Error(label)), ms); }),
    ]);
  } finally { if (t) clearTimeout(t); }
}

async function setup(): Promise<{ server: GameServer; roomA: ClientRoom; roomB: ClientRoom }> {
  const started = await deadline(startServer(0), 10000, "startServer");
  const url = `ws://127.0.0.1:${started.port}`;
  const roomA = await deadline(new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM), 10000, "joinA");
  const roomB = await deadline(new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM), 10000, "joinB");
  await waitForState(roomA, (s) => playerFromState(s, roomA.sessionId) && playerFromState(s, roomB.sessionId));
  return { server: started.server, roomA, roomB };
}

async function waitForPlay(room: ClientRoom, timeoutMs = 8000): Promise<void> {
  await waitForState(room, (s) => phase(s) === MatchPhase.IN_PROGRESS, timeoutMs);
}

function sendFire(room: ClientRoom, seq: number): void {
  room.send(TWO_PLAYER_MOVEMENT_INPUT, {
    sequence: seq, moveX: 0, moveZ: 0,
    lookYaw: Math.PI / 2, lookPitch: 0,
    jump: false, sprint: false, crouch: false,
    primaryFire: true, secondaryFire: false,
  });
}

function sendBuild(room: ClientRoom, seq: number, buildType: string, grid: { x: number; y: number; z: number }): void {
  room.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: seq, buildType, grid, rotation: 0 });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Match lifecycle state machine", () => {
  it("two players joining triggers COUNTDOWN", async () => {
    const { server, roomA, roomB } = await setup();
    try {
      expect(phase(roomA.state)).toBe(MatchPhase.COUNTDOWN);
      expect(phase(roomB.state)).toBe(MatchPhase.COUNTDOWN);

      const a = playerFromState(roomA.state, roomA.sessionId);
      const b = playerFromState(roomA.state, roomB.sessionId);
      expect(a).toBeDefined();
      expect(b).toBeDefined();

      const aInB = playerFromState(roomB.state, roomA.sessionId);
      const bInB = playerFromState(roomB.state, roomB.sessionId);
      expect(aInB).toBeDefined();
      expect(bInB).toBeDefined();

      expect((roomA.state as Record<string, any>).currentRound).toBe(0);

      expect(a.health).toBe(MAX_HEALTH);
      expect(a.shield).toBe(MAX_SHIELD);
      expect(a.energy).toBe(ENERGY.startingEnergy);
      expect(a.alive).toBe(true);
      expect(a.isEliminated).toBe(false);

      expect(a.x).toBeCloseTo(-5, 1);
      expect(a.y).toBeCloseTo(VERTICAL_MOVEMENT.groundY, 1);
      expect(b.x).toBeCloseTo(5, 1);
      expect(b.y).toBeCloseTo(VERTICAL_MOVEMENT.groundY, 1);
    } finally {
      await deadline(Promise.all([teardown(roomB), teardown(roomA)]), 5000, "teardown");
      await deadline(shutdownServer(server), 8000, "shutdown");
    }
  }, 30_000);

  it("countdown expires transitions to PLAYING (IN_PROGRESS)", async () => {
    const { server, roomA, roomB } = await setup();
    try {
      expect(phase(roomA.state)).toBe(MatchPhase.COUNTDOWN);
      await waitForPlay(roomA);

      expect(phase(roomA.state)).toBe(MatchPhase.IN_PROGRESS);
      expect(phase(roomB.state)).toBe(MatchPhase.IN_PROGRESS);
      expect((roomA.state as Record<string, any>).currentRound).toBe(1);

      expect(playerFromState(roomA.state, roomA.sessionId)).toBeDefined();
      expect(playerFromState(roomA.state, roomB.sessionId)).toBeDefined();
    } finally {
      await deadline(Promise.all([teardown(roomB), teardown(roomA)]), 5000, "teardown");
      await deadline(shutdownServer(server), 8000, "shutdown");
    }
  }, 30_000);

  it("simulating a player death triggers ROUND_OVER (ROUND_ENDED)", async () => {
    const { server, roomA, roomB } = await setup();
    try {
      await waitForPlay(roomA);
      expect(phase(roomA.state)).toBe(MatchPhase.IN_PROGRESS);

      try { roomB.connection.close(); } catch {}

      await waitForState(roomA, (s) => !playerFromState(s, roomB.sessionId), 6000);
      await waitForState(roomA, (s) => phase(s) === MatchPhase.ROUND_ENDED, 6000);

      expect(phase(roomA.state)).toBe(MatchPhase.ROUND_ENDED);
      expect(score(roomA.state, roomA.sessionId)).toBe(1);

      const lrr = (roomA.state as Record<string, any>)?.lastRoundResult;
      expect(lrr).toBeDefined();
      expect(lrr.winnerId).toBe(roomA.sessionId);
      expect(lrr.roundNumber).toBe(1);
    } finally {
      await deadline(teardown(roomA), 5000, "teardownA");
      await deadline(shutdownServer(server), 8000, "shutdown");
    }
  }, 30_000);

  it("winning three rounds triggers MATCH_OVER (MATCH_ENDED)", async () => {
    const { server, roomA, roomB } = await setup();
    try {
      // Round 1
      await waitForPlay(roomA);
      try { roomB.connection.close(); } catch {}
      await waitForState(roomA, (s) => phase(s) === MatchPhase.ROUND_ENDED, 8000);
      expect(score(roomA.state, roomA.sessionId)).toBe(1);

      // Transition to round 2
      await waitForPlay(roomA, 15000);
      expect((roomA.state as Record<string, any>).currentRound).toBe(2);

      // Round 2: B reconnects and disconnects
      const addr = server.transport.server!.address() as { port: number };
      const url = `ws://127.0.0.1:${addr.port}`;
      const roomB2 = await deadline(new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM), 10000, "rejoinB2");
      await waitForState(roomA, (s) => playerFromState(s, roomB2.sessionId), 5000);
      try { roomB2.connection.close(); } catch {}

      await waitForState(roomA, (s) => phase(s) === MatchPhase.ROUND_ENDED, 8000);
      expect(score(roomA.state, roomA.sessionId)).toBe(2);

      // Transition to round 3
      await waitForPlay(roomA, 15000);
      expect((roomA.state as Record<string, any>).currentRound).toBe(3);

      // Round 3: B reconnects and disconnects → MATCH_ENDED
      const roomB3 = await deadline(new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM), 10000, "rejoinB3");
      await waitForState(roomA, (s) => playerFromState(s, roomB3.sessionId), 5000);
      try { roomB3.connection.close(); } catch {}

      await waitForState(roomA, (s) => phase(s) === MatchPhase.MATCH_ENDED, 8000);
      expect(phase(roomA.state)).toBe(MatchPhase.MATCH_ENDED);
      expect(score(roomA.state, roomA.sessionId)).toBe(ROUNDS_TO_WIN);

      const lrr = (roomA.state as Record<string, any>)?.lastRoundResult;
      expect(lrr.winnerId).toBe(roomA.sessionId);
      expect(lrr.roundNumber).toBe(3);
    } finally {
      await deadline(teardown(roomA), 5000, "teardownA");
      await deadline(shutdownServer(server), 8000, "shutdown");
    }
  }, 60_000);

  it("round reset correctly restores health, energy, and clears builds", async () => {
    const { server, roomA, roomB } = await setup();
    const placed: StructurePlacedEvent[] = [];
    const destroyed: StructureDestroyedEvent[] = [];

    roomA.onMessage(BUILD_EVENTS.STRUCTURE_PLACED, (m) => placed.push(m as StructurePlacedEvent));
    roomA.onMessage(ENERGY_EVENTS.STRUCTURE_DESTROYED, (m) => destroyed.push(m as StructureDestroyedEvent));

    try {
      await waitForPlay(roomA);

      // A places a floor (costs 5 energy → energy becomes 95).
      sendBuild(roomA, 100, "floor", { x: 0, y: 0, z: 1 });
      await waitForState(roomA, () => placed.length > 0, 5000);
      expect(placed.length).toBeGreaterThan(0);

      // Verify energy dropped below starting value.
      await waitForState(
        roomA,
        (s) => (playerFromState(s, roomA.sessionId)?.energy ?? 100) < ENERGY.startingEnergy,
        5000,
      );
      const aBefore = playerFromState(roomA.state, roomA.sessionId);
      expect(aBefore.energy).toBeLessThan(ENERGY.startingEnergy);

      // A fires at B to reduce B's health (shield absorbs first, then health).
      // Fire enough times to bring B's health below MAX_HEALTH.
      let seq = 200;
      for (let i = 0; i < 4; i++) {
        sendFire(roomA, seq);
        await wait(300);
        seq += 10;
      }

      // Verify B took damage (health < MAX_HEALTH after shield is depleted).
      await waitForState(
        roomA,
        (s) => (playerFromState(s, roomB.sessionId)?.health ?? MAX_HEALTH) < MAX_HEALTH,
        5000,
      );

      // B disconnects → triggers endRound for A.
      try { roomB.connection.close(); } catch {}

      // Wait for round to end and reset to happen (ROUND_ENDED → COUNTDOWN).
      await waitForState(
        roomA,
        (s) => phase(s) === MatchPhase.COUNTDOWN,
        15000,
      );

      // After reset, A's energy should be restored to startingEnergy.
      const aAfter = playerFromState(roomA.state, roomA.sessionId);
      expect(aAfter.energy).toBe(ENERGY.startingEnergy);
      expect(aAfter.health).toBe(MAX_HEALTH);
      expect(aAfter.shield).toBe(MAX_SHIELD);
      expect(aAfter.alive).toBe(true);
      expect(aAfter.isEliminated).toBe(false);

      // A should be back at spawn position.
      expect(aAfter.x).toBeCloseTo(-5, 1);
      expect(aAfter.y).toBeCloseTo(VERTICAL_MOVEMENT.groundY, 1);
      expect(aAfter.z).toBeCloseTo(0, 1);

      // The placed structure should have been destroyed (cleared) during reset.
      await waitForState(
        roomA,
        () => destroyed.length > 0,
        5000,
      );
      expect(destroyed.length).toBeGreaterThan(0);
      // The destruction during round reset has empty destroyedByPlayerId.
      expect(destroyed[0].destroyedByPlayerId).toBe("");
    } finally {
      await deadline(teardown(roomA), 5000, "teardownA");
      await deadline(shutdownServer(server), 8000, "shutdown");
    }
  }, 45_000);
});
