/**
 * Building foundation — server-authoritative contract tests.
 *
 * Validates the server-authoritative building contract using real Colyseus
 * SDK clients against a real in-process server. Each test uses a fresh
 * server for independence.
 */
import { describe, expect, it } from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";
import {
  BUILD_EVENTS,
  type StructurePlacedEvent,
  type StructureRejectedEvent,
} from "@buildshift/protocol";
import { startServer, shutdownServer } from "../server.js";
import type { GameServer } from "../server.js";
import { TWO_PLAYER_MOVEMENT_ROOM } from "./TwoPlayerMovementRoom.js";
import { ServerPhysicsWorld } from "../physics/serverPhysicsWorld.js";

async function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`[bf] timeout: ${label} ${ms}ms`)), ms); }),
    ]);
  } finally { if (t) clearTimeout(t); }
}

async function waitForState(room: ClientRoom, pred: (s: unknown) => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  if (room.state && pred(room.state)) return;
  while (Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 25));
    if (room.state && pred(room.state)) return;
  }
  throw new Error(`waitForState timeout ${ms}ms`);
}

function playerFromState(state: unknown, sid: string): any {
  const p = (state as Record<string, any>)?.players;
  if (!p) return undefined;
  return typeof p.get === "function" ? p.get(sid) : p[sid];
}

function structuresFromState(state: unknown): Map<string, any> | undefined {
  const s = (state as Record<string, any>)?.building?.structures;
  if (!s) return undefined;
  if (typeof s.get === "function" && typeof s.size === "number") return s as Map<string, any>;
  if (typeof s === "object") {
    const m = new Map<string, any>();
    for (const k of Object.keys(s)) m.set(k, s[k]);
    return m;
  }
  return undefined;
}

function structCount(state: unknown): number {
  return structuresFromState(state)?.size ?? 0;
}

function waitForEvent(room: ClientRoom, name: string, ms = 5000): { promise: Promise<unknown>; unsub: () => void } {
  let res: (v: unknown) => void;
  let rej: (r: unknown) => void;
  const promise = new Promise<unknown>((r, j) => { res = r; rej = j; });
  let unsub: (() => void) | undefined;
  const cb = (payload: unknown) => { if (unsub) unsub(); clearTimeout(timer); res!(payload); };
  const timer = setTimeout(() => { if (unsub) unsub(); rej!(new Error(`waitForEvent timeout ${ms}ms ${name}`)); }, ms);
  const r = room.onMessage(name, cb) as unknown as (() => void) | undefined;
  if (typeof r === "function") unsub = r;
  return { promise, unsub: () => { clearTimeout(timer); if (unsub) unsub(); } };
}

async function teardownRoom(room: ClientRoom | null): Promise<void> {
  if (!room) return;
  room.leave().catch(() => {});
  try { room.connection.close(); } catch {}
}

async function setup(count: number): Promise<{ server: GameServer; rooms: ClientRoom[] }> {
  const { server, port } = await withDeadline(startServer(0), 10000, "startServer");
  const url = `ws://127.0.0.1:${port}`;
  const rooms: ClientRoom[] = [];
  for (let i = 0; i < count; i++) {
    rooms.push(await withDeadline(new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM), 10000, `join ${i}`));
  }
  if (rooms.length > 0) {
    await waitForState(rooms[0], (s) => { for (const r of rooms) if (!playerFromState(s, r.sessionId)) return false; return true; });
  }
  return { server, rooms };
}

describe("Building foundation — server-authoritative contract", () => {
  it("valid placement creates a structure replicated to both clients", async () => {
    const { server, rooms: [roomA, roomB] } = await setup(2);
    try {
      const eA = waitForEvent(roomA, BUILD_EVENTS.STRUCTURE_PLACED);
      const eB = waitForEvent(roomB, BUILD_EVENTS.STRUCTURE_PLACED);
      roomA.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 0, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0 });
      const evA = (await withDeadline(eA.promise, 5000, "placed A")) as StructurePlacedEvent;
      const evB = (await withDeadline(eB.promise, 5000, "placed B")) as StructurePlacedEvent;
      expect(evA.structure.structureId).toBe(evB.structure.structureId);
      expect(evA.structure.buildType).toBe("wall");
      expect(evA.structure.grid).toEqual({ x: 0, y: 0, z: 0 });
      expect(evA.structure.rotation).toBe(0);
      expect(evA.structure.createdSequence).toBe(0);
      await waitForState(roomA, (s) => structCount(s) === 1);
      await waitForState(roomB, (s) => structCount(s) === 1);
      const entryA = structuresFromState(roomA.state)!.get(evA.structure.structureId);
      const entryB = structuresFromState(roomB.state)!.get(evA.structure.structureId);
      expect(entryA).toBeDefined();
      expect(entryB).toBeDefined();
    } finally {
      await withDeadline(Promise.all([teardownRoom(roomB), teardownRoom(roomA)]), 5000, "teardown");
      await withDeadline(shutdownServer(server), 8000, "shutdown");
    }
  });

  it("rejects unknown build type with invalid_grid", async () => {
    const { server, rooms: [roomA] } = await setup(1);
    try {
      const rej = waitForEvent(roomA, BUILD_EVENTS.STRUCTURE_REJECTED);
      roomA.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 0, buildType: "tower", grid: { x: 0, y: 0, z: 0 }, rotation: 0 });
      const ev = (await withDeadline(rej.promise, 5000, "rejected")) as StructureRejectedEvent;
      expect(ev.sequence).toBe(0);
      expect(ev.reason).toBe("invalid_grid");
      await new Promise((r) => setTimeout(r, 100));
      expect(structCount(roomA.state)).toBe(0);
    } finally {
      await withDeadline(teardownRoom(roomA), 5000, "teardown");
      await withDeadline(shutdownServer(server), 8000, "shutdown");
    }
  });

  it("rejects overlapping placement with overlap", async () => {
    const { server, rooms: [roomA, roomB] } = await setup(2);
    try {
      const eA = waitForEvent(roomA, BUILD_EVENTS.STRUCTURE_PLACED);
      roomA.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 0, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0 });
      const placed = (await withDeadline(eA.promise, 5000, "placed A")) as StructurePlacedEvent;
      await waitForState(roomB, (s) => structCount(s) === 1);
      const rejB = waitForEvent(roomB, BUILD_EVENTS.STRUCTURE_REJECTED);
      roomB.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 0, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0 });
      const ev = (await withDeadline(rejB.promise, 5000, "rejected B")) as StructureRejectedEvent;
      expect(ev.sequence).toBe(0);
      expect(ev.reason).toBe("overlap");
      await new Promise((r) => setTimeout(r, 100));
      expect(structCount(roomA.state)).toBe(1);
      expect(structuresFromState(roomA.state)!.get(placed.structure.structureId)).toBeDefined();
    } finally {
      await withDeadline(Promise.all([teardownRoom(roomB), teardownRoom(roomA)]), 5000, "teardown");
      await withDeadline(shutdownServer(server), 8000, "shutdown");
    }
  });

  it("rejects out-of-range placement with out_of_range", async () => {
    const { server, rooms: [roomA] } = await setup(1);
    try {
      const rej = waitForEvent(roomA, BUILD_EVENTS.STRUCTURE_REJECTED);
      roomA.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 0, buildType: "wall", grid: { x: 13, y: 0, z: 0 }, rotation: 0 });
      const ev = (await withDeadline(rej.promise, 5000, "rejected")) as StructureRejectedEvent;
      expect(ev.reason).toBe("out_of_range");
      await new Promise((r) => setTimeout(r, 100));
      expect(structCount(roomA.state)).toBe(0);
    } finally {
      await withDeadline(teardownRoom(roomA), 5000, "teardown");
      await withDeadline(shutdownServer(server), 8000, "shutdown");
    }
  });

  it("rejects rapid successive placement with rate_limited", async () => {
    const { server, rooms: [roomA] } = await setup(1);
    try {
      const eA = waitForEvent(roomA, BUILD_EVENTS.STRUCTURE_PLACED);
      roomA.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 0, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0 });
      await withDeadline(eA.promise, 5000, "placed A");
      const rej = waitForEvent(roomA, BUILD_EVENTS.STRUCTURE_REJECTED);
      roomA.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 1, buildType: "wall", grid: { x: 5, y: 0, z: 0 }, rotation: 0 });
      const ev = (await withDeadline(rej.promise, 5000, "rejected")) as StructureRejectedEvent;
      expect(ev.sequence).toBe(1);
      expect(ev.reason).toBe("rate_limited");
      await new Promise((r) => setTimeout(r, 100));
      expect(structCount(roomA.state)).toBe(1);
    } finally {
      await withDeadline(teardownRoom(roomA), 5000, "teardown");
      await withDeadline(shutdownServer(server), 8000, "shutdown");
    }
  });

  it("records correct ownerId per structure", async () => {
    const { server, rooms: [roomA, roomB] } = await setup(2);
    try {
      const eA = waitForEvent(roomA, BUILD_EVENTS.STRUCTURE_PLACED);
      roomA.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 0, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0 });
      const sA = ((await withDeadline(eA.promise, 5000, "placed A")) as StructurePlacedEvent).structure;
      expect(sA.ownerId).toBe(roomA.sessionId);
      const eB = waitForEvent(roomB, BUILD_EVENTS.STRUCTURE_PLACED);
      roomB.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 0, buildType: "floor", grid: { x: 5, y: 0, z: 0 }, rotation: 0 });
      const sB = ((await withDeadline(eB.promise, 5000, "placed B")) as StructurePlacedEvent).structure;
      expect(sB.ownerId).toBe(roomB.sessionId);
      await waitForState(roomA, (s) => structCount(s) === 2);
      await waitForState(roomB, (s) => structCount(s) === 2);
    } finally {
      await withDeadline(Promise.all([teardownRoom(roomB), teardownRoom(roomA)]), 5000, "teardown");
      await withDeadline(shutdownServer(server), 8000, "shutdown");
    }
  });

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
    } finally {
      try { pw.dispose(); } catch {}
    }
  });

  it("structures persist after a player leaves; player state is cleaned up", async () => {
    const { server, rooms: [roomA, roomB] } = await setup(2);
    try {
      const eA = waitForEvent(roomA, BUILD_EVENTS.STRUCTURE_PLACED);
      roomA.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 0, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0 });
      const placed = (await withDeadline(eA.promise, 5000, "placed A")) as StructurePlacedEvent;
      await waitForState(roomA, (s) => structCount(s) === 1);
      await withDeadline(roomB.leave(), 5000, "roomB.leave");
      await waitForState(roomA, (s) => !playerFromState(s, roomB.sessionId));
      expect(structCount(roomA.state)).toBe(1);
      expect(structuresFromState(roomA.state)!.get(placed.structure.structureId)).toBeDefined();
      expect(playerFromState(roomA.state, roomA.sessionId)).toBeDefined();
    } finally {
      await withDeadline(teardownRoom(roomA), 5000, "teardown");
      await withDeadline(shutdownServer(server), 8000, "shutdown");
    }
  });
});
