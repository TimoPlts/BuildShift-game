/**
 * CombatRoom damage-pipeline integration tests.
 */
import { describe, expect, it } from "vitest";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";
import { PLAYER, WEAPONS } from "@buildshift/game-config";
import { EVENTS, type HitEventPayload, ROOMS } from "@buildshift/protocol";
import { FoundationRoom } from "./FoundationRoom.js";
import { TwoPlayerMovementRoom } from "./TwoPlayerMovementRoom.js";
import { CombatRoom, COMBAT_ROOM } from "./CombatRoom.js";
import { shutdownServer } from "../server.js";
import type { GameServer } from "../server.js";

const blaster = WEAPONS.find((w) => w.id === "blaster")!;
const INPUT_MSG = "input";
const AIM = Math.PI / 2;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pfs = (s: any, id: string) => s?.players?.get?.(id) ?? s?.players?.[id];

async function wfs(room: ClientRoom, fn: (s: any) => boolean, ms = 5000) {
  const t0 = Date.now();
  if (room.state && fn(room.state)) return;
  while (Date.now() - t0 < ms) { await wait(25); if (room.state && fn(room.state)) return; }
  throw new Error(`wfs timeout`);
}

async function dl<T>(p: Promise<T>, ms: number, l: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try { return await Promise.race([p, new Promise<never>((_, rj) => { t = setTimeout(() => rj(new Error(l)), ms); })]); }
  finally { if (t) clearTimeout(t); }
}

function si(room: ClientRoom, seq: number, fire: boolean) {
  room.send(INPUT_MSG, { clientId: room.sessionId, input: { sequence: seq, moveX: 0, moveZ: 0, lookYaw: AIM, lookPitch: 0, jump: false, primaryFire: fire ? 1 : 0 } });
}

let _room: InstanceType<typeof CombatRoom> | null = null;

async function mkServer(): Promise<{ srv: GameServer; port: number; rm: () => InstanceType<typeof CombatRoom> }> {
  const transport = new WebSocketTransport();
  const srv = new Server({ gracefullyShutdown: false, greet: false, transport }) as GameServer;
  srv.define(ROOMS.FOUNDATION, FoundationRoom);
  srv.define(ROOMS.TWO_PLAYER_MOVEMENT, TwoPlayerMovementRoom);
  srv.define(COMBAT_ROOM, class extends CombatRoom {
    onCreate() { super.onCreate(); _room = this; }
  } as any);
  await srv.listen(0);
  const port = (srv as any).transport.server.address().port;
  return { srv, port, rm: () => { if (!_room) throw new Error("no room"); return _room; } };
}

async function setup() {
  const { srv, port, rm } = await dl(mkServer(), 10000, "start");
  const url = `ws://127.0.0.1:${port}`;
  const a = await dl(new Client(url).joinOrCreate(COMBAT_ROOM), 10000, "joinA");
  const b = await dl(new Client(url).joinOrCreate(COMBAT_ROOM), 10000, "joinB");
  return { srv, rooms: [a, b] as [ClientRoom, ClientRoom], rm };
}

async function wb(a: ClientRoom, b: ClientRoom) {
  await wfs(a, (s) => pfs(s, a.sessionId) && pfs(s, b.sessionId));
  await wfs(b, (s) => pfs(s, a.sessionId) && pfs(s, b.sessionId));
}

async function wh(room: ClientRoom, id: string, hp: number, ms = 5000) {
  await wfs(room, (s) => { const p = pfs(s, id); return p && p.health === hp; }, ms);
}

async function cl(srv: GameServer, rooms: ClientRoom[]) {
  for (const r of rooms) { r.leave().catch(() => {}); try { r.connection.close(); } catch {} }
  await dl(shutdownServer(srv), 8000, "shutdown");
  _room = null;
}

function align(rm: () => InstanceType<typeof CombatRoom>, id: string) {
  const p = rm().state.players.get(id);
  if (!p) throw new Error(`no player ${id}`);
  p.y = 1.5;
}

describe("CombatRoom damage pipeline", () => {
  it("1) self-hit exclusion", async () => {
    const { srv, rooms: [a, b], rm } = await setup();
    try {
      await wb(a, b); align(rm, b.sessionId); await wait(100);
      expect(pfs(a.state, a.sessionId).health).toBe(PLAYER.maxHealth);
      expect(pfs(a.state, b.sessionId).health).toBe(PLAYER.maxHealth);
      si(a, 0, true); await wait(300);
      expect(pfs(a.state, a.sessionId).health).toBe(PLAYER.maxHealth);
      expect(pfs(a.state, a.sessionId).alive).toBe(true);
    } finally { await cl(srv, [a, b]); }
  }, 20000);

  it("2) cooldown rejection", async () => {
    const { srv, rooms: [a, b], rm } = await setup();
    try {
      await wb(a, b); align(rm, b.sessionId); await wait(100);
      si(a, 0, true);
      await wh(a, b.sessionId, PLAYER.maxHealth - blaster.damage);
      si(a, 1, true);
      await wait(blaster.fireCooldownMs + 200);
      expect(pfs(a.state, b.sessionId).health).toBe(PLAYER.maxHealth - blaster.damage);
    } finally { await cl(srv, [a, b]); }
  }, 20000);

  it("3a) health clamping to 0", async () => {
    const { srv, rooms: [a, b], rm } = await setup();
    try {
      await wb(a, b); align(rm, b.sessionId); await wait(100);
      const n = Math.ceil(PLAYER.maxHealth / blaster.damage) + 1;
      for (let i = 0; i < n; i++) { si(a, i, true); await wait(blaster.fireCooldownMs + 80); }
      expect(pfs(a.state, b.sessionId).health).toBe(0);
      expect(pfs(a.state, b.sessionId).health).toBeGreaterThanOrEqual(0);
      expect(pfs(a.state, b.sessionId).alive).toBe(false);
    } finally { await cl(srv, [a, b]); }
  }, 30000);

  it("3b) max health boundary", async () => {
    const { srv, rooms: [a, b], rm } = await setup();
    try {
      await wb(a, b);
      expect(pfs(a.state, a.sessionId).health).toBe(PLAYER.maxHealth);
      expect(pfs(a.state, b.sessionId).health).toBe(PLAYER.maxHealth);
      align(rm, b.sessionId); await wait(100);
      si(a, 0, true); await wait(300);
      expect(pfs(a.state, a.sessionId).health).toBeLessThanOrEqual(PLAYER.maxHealth);
      expect(pfs(a.state, b.sessionId).health).toBeLessThanOrEqual(PLAYER.maxHealth);
    } finally { await cl(srv, [a, b]); }
  }, 20000);

  it("4) exact damage application", async () => {
    const { srv, rooms: [a, b], rm } = await setup();
    try {
      await wb(a, b); align(rm, b.sessionId); await wait(100);
      const before = pfs(a.state, b.sessionId).health;
      expect(before).toBe(PLAYER.maxHealth);
      si(a, 0, true);
      await wh(a, b.sessionId, PLAYER.maxHealth - blaster.damage);
      const after = pfs(a.state, b.sessionId).health;
      expect(before - after).toBe(blaster.damage);
      expect(after).toBe(PLAYER.maxHealth - blaster.damage);
    } finally { await cl(srv, [a, b]); }
  }, 20000);

  it("5) state broadcast to receiving client", async () => {
    const { srv, rooms: [a, b], rm } = await setup();
    try {
      await wb(a, b); align(rm, b.sessionId); await wait(100);
      expect(pfs(b.state, b.sessionId).health).toBe(PLAYER.maxHealth);
      const hp = new Promise<HitEventPayload>((res, rej) => {
        const t = setTimeout(() => rej(new Error("HIT timeout")), 5000);
        b.onMessage(EVENTS.HIT, (p: any) => { clearTimeout(t); res(p); });
      });
      si(a, 0, true);
      await wh(b, b.sessionId, PLAYER.maxHealth - blaster.damage);
      expect(pfs(b.state, b.sessionId).health).toBe(PLAYER.maxHealth - blaster.damage);
      const hit = await dl(hp, 5000, "HIT");
      expect(hit.shooterId).toBe(a.sessionId);
      expect(hit.targetId).toBe(b.sessionId);
      expect(hit.damage).toBe(blaster.damage);
      expect(hit.remainingHealth).toBe(PLAYER.maxHealth - blaster.damage);
    } finally { await cl(srv, [a, b]); }
  }, 20000);
});
