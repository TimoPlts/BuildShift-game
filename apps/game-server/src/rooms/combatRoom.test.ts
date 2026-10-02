/**
 * CombatRoom damage-pipeline integration tests.
 *
 * Drive the server-authoritative `CombatRoom` over a real in-process Colyseus
 * server with real `@colyseus/sdk` clients. Verifies the five damage-pipeline
 * contracts:
 *
 *  1. SELF-HIT EXCLUSION — a shot can never damage the shooter.
 *  2. COOLDOWN REJECTION — a second shot within `fireCooldownMs` is rejected.
 *  3. HEALTH CLAMPING — (a) overkill clamps to exactly 0; (b) never exceeds
 *     the configured `PLAYER.maxHealth`.
 *  4. EXACT DAMAGE — a confirmed hit reduces the target by exactly the
 *     weapon's configured damage.
 *  5. STATE BROADCAST — the receiving client observes the updated health in
 *     its own (client-side) state after a hit.
 *
 * Balance values (damage, cooldown, max health) come from
 * `@buildshift/game-config`; assertions never hardcode numbers. Each test
 * starts a fresh server + room and tears it down in a `finally`, so no
 * cooldown / health state leaks between tests.
 *
 * Aim geometry: A (first join) at x=-5, B (second) at x=+5. `processFire`
 * aims along `(sin(yaw), 0, -cos(yaw))`. A→B (+X): `lookYaw = Math.PI / 2`;
 * B→A (-X): `-Math.PI / 2`.
 */
import { describe, expect, it } from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";

import { PLAYER, WEAPONS } from "@buildshift/game-config";
import { EVENTS, type HitEventPayload } from "@buildshift/protocol";

import { startServer, shutdownServer } from "../server.js";
import type { GameServer } from "../server.js";
import { COMBAT_ROOM } from "./CombatRoom.js";

const blaster = WEAPONS.find((w) => w.id === "blaster")!;
expect(blaster).toBeDefined();

const INPUT_MSG = "input"; // inbound message type in CombatRoom
const AIM_A_TO_B = Math.PI / 2; // A(-5) → B(+5): +X
const AIM_B_TO_A = -Math.PI / 2; // B(+5) → A(-5): -X

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
    `waitForState timed out after ${timeoutMs}ms; last=${JSON.stringify(room.state)}`,
  );
}

const waitMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function playerFromState(state: any, sessionId: string): any {
  const players = state?.players;
  if (!players) return undefined;
  if (typeof players.get === "function") return players.get(sessionId);
  return players[sessionId];
}

function snapshot(p: any): { health: number; alive: boolean } {
  return { health: p?.health ?? 0, alive: p?.alive ?? false };
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
        timer = setTimeout(
          () => reject(new Error(`[combat-test] timeout: "${label}" ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sendInput(room: ClientRoom, sequence: number, lookYaw: number, primaryFire: boolean): void {
  room.send(INPUT_MSG, {
    clientId: room.sessionId,
    input: {
      sequence,
      moveX: 0,
      moveZ: 0,
      lookYaw,
      lookPitch: 0,
      jump: false,
      primaryFire,
    },
  });
}

async function setup(count: number): Promise<{ server: GameServer; rooms: ClientRoom[] }> {
  const { server, port } = await withDeadline(startServer(0), 10_000, "startServer");
  const url = `ws://127.0.0.1:${port}`;
  const rooms: ClientRoom[] = [];
  for (let i = 0; i < count; i++) {
    rooms.push(
      await withDeadline(new Client(url).joinOrCreate(COMBAT_ROOM), 10_000, `join ${i}`),
    );
  }
  return { server, rooms };
}

async function waitBothVisible(roomA: ClientRoom, roomB: ClientRoom): Promise<void> {
  await waitForState(roomA, (s) => playerFromState(s, roomA.sessionId) && playerFromState(s, roomB.sessionId));
  await waitForState(roomB, (s) => playerFromState(s, roomA.sessionId) && playerFromState(s, roomB.sessionId));
}

async function waitHealth(room: ClientRoom, target: string, expected: number, timeoutMs = 5_000): Promise<void> {
  await waitForState(room, (s) => {
    const p = playerFromState(s, target);
    return p && p.health === expected;
  }, timeoutMs);
}

async function cleanup(server: GameServer, rooms: ClientRoom[]): Promise<void> {
  await withDeadline(Promise.all(rooms.map((r) => teardownRoom(r))), 5_000, "teardown");
  await withDeadline(shutdownServer(server), 8_000, "shutdownServer");
}

describe("CombatRoom damage pipeline", () => {
  it("1) a player's own shot never damages the shooter (self-hit exclusion)", async () => {
    const { server, rooms: [roomA, roomB] } = await setup(2);
    try {
      await waitBothVisible(roomA, roomB);
      expect(playerFromState(roomA.state, roomA.sessionId).health).toBe(PLAYER.maxHealth);
      expect(playerFromState(roomA.state, roomB.sessionId).health).toBe(PLAYER.maxHealth);

      // A fires toward B. Whatever the shot does to B, the shooter (A) must
      // never lose health — the shooter is excluded from its own hitscan.
      sendInput(roomA, 0, AIM_A_TO_B, true);
      await waitMs(300);

      const aAfter = playerFromState(roomA.state, roomA.sessionId);
      expect(aAfter).toBeDefined();
      expect(aAfter.health).toBe(PLAYER.maxHealth);
      expect(aAfter.alive).toBe(true);
    } finally {
      await cleanup(server, [roomA, roomB]);
    }
  });

  it("2) a second shot fired within the weapon cooldown is rejected", async () => {
    const { server, rooms: [roomA, roomB] } = await setup(2);
    try {
      await waitBothVisible(roomA, roomB);

      // First shot confirms (B loses exactly one weapon-damage of health).
      sendInput(roomA, 0, AIM_A_TO_B, true);
      await waitHealth(roomA, roomB.sessionId, PLAYER.maxHealth - blaster.damage);

      // Immediately (well within `fireCooldownMs`) fire the same weapon again.
      sendInput(roomA, 1, AIM_A_TO_B, true);

      // Wait past the cooldown so a (buggy) second shot would have registered.
      await waitMs(blaster.fireCooldownMs + 200);

      // No additional damage was applied by the rejected second shot.
      expect(playerFromState(roomA.state, roomB.sessionId).health).toBe(
        PLAYER.maxHealth - blaster.damage,
      );
    } finally {
      await cleanup(server, [roomA, roomB]);
    }
  });

  it("3a) overkill damage is clamped to exactly 0 (never negative)", async () => {
    const { server, rooms: [roomA, roomB] } = await setup(2);
    try {
      await waitBothVisible(roomA, roomB);

      // Drive B from `maxHealth` to 0 and beyond (overkill).
      const totalShots = Math.ceil(PLAYER.maxHealth / blaster.damage) + 1;
      for (let i = 0; i < totalShots; i++) {
        sendInput(roomA, i, AIM_A_TO_B, true);
        await waitMs(blaster.fireCooldownMs + 80);
      }

      const bAfter = playerFromState(roomA.state, roomB.sessionId);
      expect(bAfter.health).toBe(0);
      expect(bAfter.health).toBeGreaterThanOrEqual(0);
      expect(bAfter.alive).toBe(false);
    } finally {
      await cleanup(server, [roomA, roomB]);
    }
  });

  it("3b) player health never exceeds the configured max health", async () => {
    const { server, rooms: [roomA, roomB] } = await setup(2);
    try {
      await waitBothVisible(roomA, roomB);

      // On spawn, both players are initialised to exactly `maxHealth`.
      const aSpawn = playerFromState(roomA.state, roomA.sessionId);
      const bSpawn = playerFromState(roomA.state, roomB.sessionId);
      expect(aSpawn.health).toBe(PLAYER.maxHealth);
      expect(bSpawn.health).toBe(PLAYER.maxHealth);
      expect(aSpawn.health).toBeLessThanOrEqual(PLAYER.maxHealth);
      expect(bSpawn.health).toBeLessThanOrEqual(PLAYER.maxHealth);

      // Drive some combat; no player's health may ever exceed `maxHealth`.
      sendInput(roomA, 0, AIM_A_TO_B, true);
      await waitMs(300);

      const aAfter = playerFromState(roomA.state, roomA.sessionId);
      const bAfter = playerFromState(roomA.state, roomB.sessionId);
      expect(aAfter.health).toBeLessThanOrEqual(PLAYER.maxHealth);
      expect(bAfter.health).toBeLessThanOrEqual(PLAYER.maxHealth);
    } finally {
      await cleanup(server, [roomA, roomB]);
    }
  });

  it("4) a confirmed hit reduces the target's health by exactly the weapon damage", async () => {
    const { server, rooms: [roomA, roomB] } = await setup(2);
    try {
      await waitBothVisible(roomA, roomB);
      const bBefore = snapshot(playerFromState(roomA.state, roomB.sessionId));
      expect(bBefore.health).toBe(PLAYER.maxHealth);

      sendInput(roomA, 0, AIM_A_TO_B, true);
      await waitHealth(roomA, roomB.sessionId, PLAYER.maxHealth - blaster.damage);

      const bAfter = snapshot(playerFromState(roomA.state, roomB.sessionId));
      // The decrease is EXACTLY the weapon's configured damage.
      expect(bBefore.health - bAfter.health).toBe(blaster.damage);
      expect(bAfter.health).toBe(PLAYER.maxHealth - blaster.damage);
    } finally {
      await cleanup(server, [roomA, roomB]);
    }
  });

  it("5) the receiving client observes the updated health in its own state", async () => {
    const { server, rooms: [roomA, roomB] } = await setup(2);
    try {
      await waitBothVisible(roomA, roomB);

      // The receiving client (B) sees itself at full health initially.
      const bBefore = playerFromState(roomB.state, roomB.sessionId);
      expect(bBefore.health).toBe(PLAYER.maxHealth);

      // Capture the authoritative HIT event observed by B.
      const hitPromise = new Promise<HitEventPayload>((resolve) => {
        roomB.on(EVENTS.HIT, (payload) => resolve(payload as HitEventPayload));
      });

      // A fires at B; the hit is confirmed.
      sendInput(roomA, 0, AIM_A_TO_B, true);
      await waitHealth(roomA, roomB.sessionId, PLAYER.maxHealth - blaster.damage);

      // The RECEIVING client (B) observes the updated health in ITS OWN
      // (client-side) state — not just the shooter's view.
      await waitHealth(roomB, roomB.sessionId, PLAYER.maxHealth - blaster.damage);
      const bInB = playerFromState(roomB.state, roomB.sessionId);
      expect(bInB.health).toBe(PLAYER.maxHealth - blaster.damage);

      // And the authoritative HIT event reports the same remaining health.
      const hit = await withDeadline(hitPromise, 5_000, "HIT event");
      expect(hit.shooterId).toBe(roomA.sessionId);
      expect(hit.targetId).toBe(roomB.sessionId);
      expect(hit.damage).toBe(blaster.damage);
      expect(hit.remainingHealth).toBe(PLAYER.maxHealth - blaster.damage);
    } finally {
      await cleanup(server, [roomA, roomB]);
    }
  });
});
