/**
 * Building foundation — server-authoritative contract tests.
 * Single shared server + room; event-handler registration in beforeAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";
import { BUILD_EVENTS, type StructurePlacedEvent, type StructureRejectedEvent } from "@buildshift/protocol";
import { startServer, shutdownServer } from "../server.js";
import type { GameServer } from "../server.js";
import { TWO_PLAYER_MOVEMENT_ROOM } from "./TwoPlayerMovementRoom.js";
import { ServerPhysicsWorld } from "../physics/serverPhysicsWorld.js";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function wfs(room: ClientRoom, pred: (s: unknown) => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  if (room.state && pred(room.state)) return;
  while (Date.now() - t0 < ms) { await wait(25); if (room.state && pred(room.state)) return; }
  throw new Error(`wfs timeout ${ms}ms`);
}
function pfs(state: unknown, sid: string): any {
  const p = (state as Record<string, any>)?.players;
  if (!p) return undefined;
  return typeof p.get === "function" ? p.get(sid) : p[sid];
}
async function wfe<T>(arr: T[], pred: (e: T) => boolean, ms = 5000, label = "evt"): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const f = arr.find(pred); if (f) return f; await wait(25); }
  throw new Error(`wfe timeout ${ms}ms ${label}`);
}
async function td(room: ClientRoom | null): Promise<void> {
  if (!room) return;
  room.leave().catch(() => {});
  try { room.connection.close(); } catch {}
}
async function wd<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try { return await Promise.race([p, new Promise<never>((_, rj) => { t = setTimeout(() => rj(new Error(`${label} ${ms}ms`)), ms); })]); }
  finally { if (t) clearTimeout(t); }
}

let server: GameServer;
let roomA: ClientRoom;
let roomB: ClientRoom;
const pA: StructurePlacedEvent[] = [];
const pB: StructurePlacedEvent[] = [];
const rA: StructureRejectedEvent[] = [];
const rB: StructureRejectedEvent[] = [];

/** BUILD_RATE.minTicksBetweenPlacements=10 at 30Hz => ~333ms. Use 400ms margin. */
const RATE_WAIT = 400;

describe("Building foundation — server-authoritative contract", () => {
  beforeAll(async () => {
    const s = await wd(startServer(0), 10_000, "start");
    server = s.server;
    const url = `ws://127.0.0.1:${s.port}`;
    roomA = await wd(new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM), 10_000, "A");
    roomB = await wd(new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM), 10_000, "B");
    expect(roomA.sessionId).not.toBe(roomB.sessionId);
    roomA.onMessage(BUILD_EVENTS.STRUCTURE_PLACED, (m) => pA.push(m as StructurePlacedEvent));
    roomB.onMessage(BUILD_EVENTS.STRUCTURE_PLACED, (m) => pB.push(m as StructurePlacedEvent));
    roomA.onMessage(BUILD_EVENTS.STRUCTURE_REJECTED, (m) => rA.push(m as StructureRejectedEvent));
    roomB.onMessage(BUILD_EVENTS.STRUCTURE_REJECTED, (m) => rB.push(m as StructureRejectedEvent));
    const both = (st: unknown) => pfs(st, roomA.sessionId) && pfs(st, roomB.sessionId);
    await wfs(roomA, both);
    await wfs(roomB, both);
    // Wait for the match countdown to finish so the phase is IN_PROGRESS.
    // Builds are rejected during COUNTDOWN.
    await wfs(roomA, (s) => (s as Record<string, any>)?.matchPhase === "IN_PROGRESS", 10_000);
  }, 20_000);
  afterAll(async () => {
    await wd(Promise.all([td(roomB), td(roomA)]), 5000, "td");
    await wd(shutdownServer(server), 8000, "shutdown");
  }, 20_000);

  it("valid placement creates a structure replicated to both clients", async () => {
    roomA.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 100, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0 });
    const a = await wfe(pA, (e) => e.structure.createdSequence === 100, 5000, "A");
    const b = await wfe(pB, (e) => e.structure.createdSequence === 100, 5000, "B");
    expect(a.structure.structureId).toBe(b.structure.structureId);
    expect(a.structure.buildType).toBe("wall");
    expect(a.structure.grid).toEqual({ x: 0, y: 0, z: 0 });
    expect(a.structure.rotation).toBe(0);
    expect(a.structure.createdSequence).toBe(100);
    expect(a.structure.ownerId).toBe(roomA.sessionId);
  }, 15000);

  it("rejects unknown build type with invalid_grid", async () => {
    roomA.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 101, buildType: "tower", grid: { x: 0, y: 0, z: 0 }, rotation: 0 });
    const ev = await wfe(rA, (e) => e.sequence === 101, 5000, "rej");
    expect(ev.reason).toBe("invalid_grid");
    await wait(200);
    expect(pA.filter((e) => e.structure.createdSequence === 101)).toHaveLength(0);
  }, 15000);

  it("rejects overlapping placement with overlap", async () => {
    await wait(RATE_WAIT);
    roomA.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 102, buildType: "wall", grid: { x: 3, y: 0, z: 0 }, rotation: 0 });
    await wfe(pA, (e) => e.structure.createdSequence === 102, 5000, "setup");
    roomB.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 103, buildType: "wall", grid: { x: 3, y: 0, z: 0 }, rotation: 0 });
    const ev = await wfe(rB, (e) => e.sequence === 103, 5000, "overlap");
    expect(ev.reason).toBe("overlap");
    await wait(200);
    expect(pA.filter((e) => e.structure.createdSequence === 102)).toHaveLength(1);
  }, 15000);

  it("rejects out-of-range placement with out_of_range", async () => {
    // Grid x=6 → world x=12, distance from player at (0, 0.9, 6) ≈ 13.4 > 12.
    roomA.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 104, buildType: "wall", grid: { x: 6, y: 0, z: 0 }, rotation: 0 });
    const ev = await wfe(rA, (e) => e.sequence === 104, 5000, "range");
    expect(ev.reason).toBe("out_of_range");
    await wait(200);
    expect(pA.filter((e) => e.structure.createdSequence === 104)).toHaveLength(0);
  }, 15000);

  it("rejects rapid successive placement with rate_limited", async () => {
    await wait(RATE_WAIT);
    roomA.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 105, buildType: "wall", grid: { x: 0, y: 0, z: 2 }, rotation: 0 });
    await wfe(pA, (e) => e.structure.createdSequence === 105, 5000, "first");
    roomA.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 106, buildType: "wall", grid: { x: 0, y: 0, z: 3 }, rotation: 0 });
    const ev = await wfe(rA, (e) => e.sequence === 106 && e.reason === "rate_limited", 5000, "rl");
    expect(ev.reason).toBe("rate_limited");
    await wait(200);
    expect(pA.filter((e) => e.structure.createdSequence === 106)).toHaveLength(0);
  }, 15000);

  it("records correct ownerId per structure", async () => {
    await wait(RATE_WAIT);
    roomA.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 107, buildType: "wall", grid: { x: -3, y: 0, z: 0 }, rotation: 0 });
    const sA = (await wfe(pA, (e) => e.structure.createdSequence === 107, 5000, "oA")).structure;
    expect(sA.ownerId).toBe(roomA.sessionId);
    roomB.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 108, buildType: "floor", grid: { x: 3, y: 0, z: 1 }, rotation: 0 });
    const sB = (await wfe(pB, (e) => e.structure.createdSequence === 108, 5000, "oB")).structure;
    expect(sB.ownerId).toBe(roomB.sessionId);
  }, 15000);

  it("structure collider lifecycle: add, re-add, remove, re-remove, dispose", async () => {
    const pw = await ServerPhysicsWorld.create();
    try {
      pw.addStructureCollider("s1", { x: 0, y: 1, z: 0 }, { x: 0.5, y: 1, z: 0.5 });
      pw.addStructureCollider("s1", { x: 0, y: 1, z: 0 }, { x: 0.5, y: 1, z: 0.5 });
      pw.addStructureCollider("s2", { x: 5, y: 1, z: 5 }, { x: 0.5, y: 0.5, z: 0.5 });
      pw.removeStructureCollider("s1");
      pw.removeStructureCollider("s1");
      pw.removeStructureCollider("s2");
      pw.removeStructureCollider("nonexistent");
      pw.dispose();
      pw.addStructureCollider("s3", { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
      pw.removeStructureCollider("s3");
    } finally { try { pw.dispose(); } catch {} }
  }, 15000);

  it("structures persist after a player leaves; player state is cleaned up", async () => {
    await wait(RATE_WAIT);
    roomA.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 109, buildType: "wall", grid: { x: -1, y: 0, z: 0 }, rotation: 0 });
    await wfe(pA, (e) => e.structure.createdSequence === 109, 5000, "persist");
    await wd(roomB.leave(), 5000, "leave");
    await wfs(roomA, (s) => pfs(s, roomB.sessionId) === undefined, 5000);
    expect(pfs(roomA.state, roomA.sessionId)).toBeDefined();
    expect(pfs(roomA.state, roomB.sessionId)).toBeUndefined();
  }, 15000);
});
