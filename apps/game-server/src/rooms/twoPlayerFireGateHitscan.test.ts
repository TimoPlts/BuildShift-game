/**
 * Server-side integration test for the canonical room's authoritative
 * fire-intent path (Task T2). Proves `TwoPlayerMovementRoom` orchestrates the
 * shared simulation combat math (`fireGate` / `hitscan`) rather than
 * reimplementing it inline:
 *   (a) a within-cooldown fire-intent is REJECTED → `FIRE_REJECTED`, no damage;
 *   (b) a valid in-range fire-intent applies the correct damage (shield first);
 *   (c) a `HEALTH_UPDATE` event carries the target's new health/shield;
 *   (d) elimination triggers at health 0 → state + `ELIMINATED`.
 *
 * No mocks for room/protocol/simulation — only the WebSocket transport is real.
 *
 * Timeline (ASSAULT_RIFLE damage = DMG, MAX_SHIELD absorbs first):
 *   seq 10 (ok) shield 50→30 | seq 11 (REJECTED) | seq 20 (ok) shield 30→10 |
 *   seq 30 (ok) shield 10→0 + health 100→90 | seq 40..80 health 90→0 (dead).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";

import { MAX_HEALTH, MAX_SHIELD, ASSAULT_RIFLE } from "@buildshift/game-config";
import {
  MatchPhase,
  EVENTS,
  type FireRejectedEvent,
  type HealthUpdateEvent,
  type HitResultEvent,
  type PlayerEliminatedEvent,
} from "@buildshift/protocol";

import { startServer, shutdownServer } from "../server.js";
import type { GameServer } from "../server.js";
import {
  TWO_PLAYER_MOVEMENT_ROOM,
  TWO_PLAYER_MOVEMENT_INPUT,
} from "./TwoPlayerMovementRoom.js";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface PlayerView {
  health: number;
  shield: number;
  ammo: number;
  alive: boolean;
  isEliminated: boolean;
  lastFireSequence: number;
}

function getPlayer(state: unknown, sessionId: string): PlayerView | undefined {
  const s = state as Record<string, any> | undefined;
  const players = s?.players;
  if (!players) return undefined;
  const p = typeof players.get === "function" ? players.get(sessionId) : players[sessionId];
  if (!p) return undefined;
  return {
    health: p.health,
    shield: p.shield,
    ammo: p.ammo,
    alive: p.alive,
    isEliminated: p.isEliminated,
    lastFireSequence: p.lastFireSequence,
  };
}

async function waitForState(room: ClientRoom, pred: (s: unknown) => boolean, timeoutMs = 5000): Promise<void> {
  const t0 = Date.now();
  if (room.state && pred(room.state)) return;
  while (Date.now() - t0 < timeoutMs) {
    await wait(25);
    if (room.state && pred(room.state)) return;
  }
  throw new Error(`waitForState timed out after ${timeoutMs}ms; last state=${JSON.stringify(room.state)}`);
}

async function waitForEvent<T>(arr: T[], pred: (e: T) => boolean, timeoutMs = 5000, label = "event"): Promise<void> {
  const t0 = Date.now();
  if (arr.some(pred)) return;
  while (Date.now() - t0 < timeoutMs) {
    await wait(25);
    if (arr.some(pred)) return;
  }
  throw new Error(`waitForEvent timed out after ${timeoutMs}ms waiting for ${label}`);
}

async function teardownRoom(room: ClientRoom | null): Promise<void> {
  if (!room) return;
  room.leave().catch(() => {});
  try {
    room.connection.close();
  } catch {}
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout: "${label}" ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sendFire(room: ClientRoom, sequence: number): void {
  room.send(TWO_PLAYER_MOVEMENT_INPUT, {
    sequence,
    moveX: 0,
    moveZ: 0,
    lookYaw: Math.PI / 2,
    lookPitch: 0,
    jump: false,
    sprint: false,
    crouch: false,
    primaryFire: true,
    secondaryFire: false,
  });
}

const DMG = ASSAULT_RIFLE.damage;

describe("TwoPlayerMovementRoom fireGate + hitscan wiring", () => {
  let server: GameServer;
  let port: number;
  let roomA: ClientRoom;
  let roomB: ClientRoom;

  const fireRejected: FireRejectedEvent[] = [];
  const healthUpdates: HealthUpdateEvent[] = [];
  const hits: HitResultEvent[] = [];
  const eliminated: PlayerEliminatedEvent[] = [];

  beforeAll(async () => {
    const started = await withDeadline(startServer(0), 10000, "startServer");
    server = started.server;
    port = started.port;
    expect(port).toBeGreaterThan(0);

    const url = `ws://127.0.0.1:${port}`;
    roomA = await withDeadline(new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM), 10000, "join A");
    roomB = await withDeadline(new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM), 10000, "join B");
    expect(roomA.sessionId).not.toBe(roomB.sessionId);
    expect(roomA.roomId).toBe(roomB.roomId);

    const both = (s: unknown) =>
      getPlayer(s, roomA.sessionId) !== undefined && getPlayer(s, roomB.sessionId) !== undefined;
    await waitForState(roomA, both);
    await waitForState(roomB, both);

    // The room runs a pre-round COUNTDOWN before combat is allowed. Wait for
    // the round to be IN_PROGRESS so fire inputs are processed.
    await waitForState(
      roomA,
      (s) => (s as Record<string, any>)?.matchPhase === MatchPhase.IN_PROGRESS,
      8000,
    );

    roomA.onMessage(EVENTS.FIRE_REJECTED, (m) => fireRejected.push(m as FireRejectedEvent));
    roomA.onMessage(EVENTS.HEALTH_UPDATE, (m) => healthUpdates.push(m as HealthUpdateEvent));
    roomA.onMessage(EVENTS.HIT, (m) => hits.push(m as HitResultEvent));
    roomA.onMessage(EVENTS.ELIMINATED, (m) => eliminated.push(m as PlayerEliminatedEvent));
  }, 20000);

  afterAll(async () => {
    await withDeadline(Promise.all([teardownRoom(roomB), teardownRoom(roomA)]), 5000, "teardown");
    await withDeadline(shutdownServer(server), 8000, "shutdown");
  }, 20000);

  it("(a) rejects a fire-intent still within the weapon cooldown", async () => {
    const bBefore = getPlayer(roomA.state, roomB.sessionId)!;
    expect(bBefore.shield).toBe(MAX_SHIELD);
    expect(bBefore.health).toBe(MAX_HEALTH);

    const rejectedBefore = fireRejected.length;
    const healthBefore = healthUpdates.length;
    // Shot 1 (seq 10): first shot is always allowed → lands on B.
    sendFire(roomA, 10);
    await waitForState(roomA, (s) => {
      const b = getPlayer(s, roomB.sessionId);
      return b !== undefined && b.shield === MAX_SHIELD - DMG;
    });

    // Shot 2 (seq 11): gap 1 < fireIntervalTicks (8) → REJECTED.
    sendFire(roomA, 11);
    await waitForEvent(fireRejected, (e) => e.shooterId === roomA.sessionId, 5000, "FIRE_REJECTED");
    await wait(250);

    expect(fireRejected.length - rejectedBefore).toBe(1);
    const rejection = fireRejected[fireRejected.length - 1];
    expect(rejection.shooterId).toBe(roomA.sessionId);
    expect(rejection.reason).toBe("cooldown");

    const bAfter = getPlayer(roomA.state, roomB.sessionId)!;
    expect(bAfter.shield).toBe(MAX_SHIELD - DMG);
    expect(bAfter.health).toBe(MAX_HEALTH);
    expect(healthUpdates.length - healthBefore).toBe(1);

    const aAfter = getPlayer(roomA.state, roomA.sessionId)!;
    expect(aAfter.lastFireSequence).toBe(10);
    expect(aAfter.ammo).toBe(ASSAULT_RIFLE.maxAmmo - 1);
  });

  it("(b) a valid in-range fire-intent applies the correct damage", async () => {
    // B: shield = MAX_SHIELD - DMG (30), health = 100. seq 20 (20-10=10>=8) ok.
    const healthBefore = healthUpdates.length;
    const hitsBefore = hits.length;
    sendFire(roomA, 20);
    await waitForState(roomA, (s) => {
      const b = getPlayer(s, roomB.sessionId);
      return b !== undefined && b.shield === MAX_SHIELD - 2 * DMG;
    });

    const bAfter = getPlayer(roomA.state, roomB.sessionId)!;
    expect(bAfter.shield).toBe(MAX_SHIELD - 2 * DMG);
    expect(bAfter.health).toBe(MAX_HEALTH);

    const aAfter = getPlayer(roomA.state, roomA.sessionId)!;
    expect(aAfter.ammo).toBe(ASSAULT_RIFLE.maxAmmo - 2);
    expect(aAfter.lastFireSequence).toBe(20);

    expect(hits.length - hitsBefore).toBe(1);
    const hit = hits[hits.length - 1];
    expect(hit.shooterId).toBe(roomA.sessionId);
    expect(hit.targetId).toBe(roomB.sessionId);
    expect(hit.damage).toBe(DMG);
    expect(healthUpdates.length - healthBefore).toBe(1);
  });

  it("(c) emits a HEALTH_UPDATE event with the target's new health/shield", async () => {
    // B: shield = MAX_SHIELD - 2*DMG (10), health = 100. seq 30 (30-20=10>=8) ok.
    // Shield (10) absorbs 10; `DMG - 10` overflows → health 100 → 90.
    const shieldBefore = MAX_SHIELD - 2 * DMG; // 10
    const overflow = DMG - shieldBefore; // 10
    const expectedHealth = MAX_HEALTH - overflow; // 90

    const healthBefore = healthUpdates.length;
    sendFire(roomA, 30);
    await waitForState(roomA, (s) => {
      const b = getPlayer(s, roomB.sessionId);
      return b !== undefined && b.health < MAX_HEALTH;
    });

    const bAfter = getPlayer(roomA.state, roomB.sessionId)!;
    expect(bAfter.shield).toBe(0);
    expect(bAfter.health).toBe(expectedHealth);

    expect(healthUpdates.length - healthBefore).toBe(1);
    const latest = healthUpdates[healthUpdates.length - 1];
    expect(latest.playerId).toBe(roomB.sessionId);
    expect(latest.health).toBe(bAfter.health);
    expect(latest.shield).toBe(bAfter.shield);
    expect(latest.alive).toBe(true);
    expect(latest.isEliminated).toBe(false);
  });

  it("(d) triggers elimination and emits ELIMINATED when health reaches 0", async () => {
    // B: shield = 0, health = 90. 5 more shots (5×DMG=100>90) at 10-tick gaps.
    let seq = 40;
    for (let i = 0; i < 5; i += 1) {
      sendFire(roomA, seq);
      await wait(300);
      seq += 10;
    }

    await waitForState(
      roomA,
      (s) => {
        const b = getPlayer(s, roomB.sessionId);
        return b !== undefined && b.isEliminated === true;
      },
      10000,
    );

    const bAfter = getPlayer(roomA.state, roomB.sessionId)!;
    expect(bAfter.health).toBe(0);
    expect(bAfter.shield).toBe(0);
    expect(bAfter.isEliminated).toBe(true);
    expect(bAfter.alive).toBe(false);

    const finalHealth = healthUpdates[healthUpdates.length - 1];
    expect(finalHealth.playerId).toBe(roomB.sessionId);
    expect(finalHealth.health).toBe(0);
    expect(finalHealth.isEliminated).toBe(true);

    await waitForEvent(
      eliminated,
      (e) => e.eliminatedId === roomB.sessionId && e.eliminatedById === roomA.sessionId,
      5000,
      "ELIMINATED",
    );
    const elim = eliminated[eliminated.length - 1];
    expect(elim.eliminatedId).toBe(roomB.sessionId);
    expect(elim.eliminatedById).toBe(roomA.sessionId);
  });
});
