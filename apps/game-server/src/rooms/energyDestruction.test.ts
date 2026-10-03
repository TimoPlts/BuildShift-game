/**
 * Energy economy + destructible structures — server contract tests.
 * Regeneration, max clamp, build cost, insufficient-Energy, no double charge,
 * structure damage/health, replicated removal, collision removal, round cleanup.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room as CR } from "@colyseus/sdk";
import {
  ENERGY_EVENTS as EE, BUILD_EVENTS as BE,
  canAffordBuild as cab, computeEnergyAfterRegeneration as cer,
  computeEnergyAfterBuild as ceb, applyStructureDamage as asd,
  isStructureDestroyed as isd,
  type EnergyUpdateEvent as EU, type StructureDamageEvent as SD,
  type StructureDestroyedEvent as SX,
} from "@buildshift/protocol";
import { ENERGY, ASSAULT_RIFLE as AR, getStructureDurability } from "@buildshift/game-config";
import { startServer, shutdownServer } from "../server.js";
import type { GameServer } from "../server.js";
import { TWO_PLAYER_MOVEMENT_ROOM as TMR, TWO_PLAYER_MOVEMENT_INPUT as TMI } from "./TwoPlayerMovementRoom.js";
import { ServerPhysicsWorld } from "../physics/serverPhysicsWorld.js";
const W = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function wfs(r: CR, p: (s: unknown) => boolean, ms = 5000) {
  const t = Date.now();
  if (r.state && p(r.state)) return;
  while (Date.now() - t < ms) { await W(25); if (r.state && p(r.state)) return; }
  throw new Error("t" + ms);
}
function pl(s: unknown, id: string) {
  const p = (s as Record<string, any>)?.players;
  return p ? (typeof p.get === "function" ? p.get(id) : p[id]) : undefined;
}
function ss(s: unknown): Record<string, any> {
  const x = (s as Record<string, any>)?.building?.structures;
  if (!x) return {};
  if (typeof x.get === "function") { const r: Record<string, any> = {}; for (const [k, v] of x) r[k] = v; return r; }
  return typeof x === "object" && !Array.isArray(x) ? x : {};
}
async function wfe<T>(a: T[], p: (e: T) => boolean, ms = 5000, l = ""): Promise<T> {
  const t = Date.now();
  while (Date.now() - t < ms) { const f = a.find(p); if (f) return f; await W(25); }
  throw new Error("wfe " + l);
}
async function td(r: CR | null) { if (!r) return; r.leave().catch(() => {}); try { r.connection.close(); } catch {} }
async function wd<T>(p: Promise<T>, ms: number, l: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try { return await Promise.race([p, new Promise<never>((_, rj) => { t = setTimeout(() => rj(new Error(l)), ms); })]); }
  finally { if (t) clearTimeout(t); }
}

describe("Energy protocol helpers", () => {
  it("regen ticks*rate", () => { expect(cer(50, 100, 10, 1)).toBe(60); });
  it("regen clamp max", () => { expect(cer(95, 100, 10, 1)).toBe(100); });
  it("regen 0 ticks", () => { expect(cer(50, 100, 0, 1)).toBe(50); });
  it("regen neg ticks", () => { expect(cer(50, 100, -5, 1)).toBe(50); });
  it("regen 0 rate", () => { expect(cer(50, 100, 10, 0)).toBe(50); });
  it("regen neg input", () => { expect(cer(-5, 100, 10, 1)).toBe(5); });
  it("afford exact", () => { expect(cab(10, 10)).toBe(true); });
  it("afford above", () => { expect(cab(50, 10)).toBe(true); });
  it("afford below", () => { expect(cab(9, 10)).toBe(false); });
  it("afford 0/5", () => { expect(cab(0, 5)).toBe(false); });
  it("afford 0/0", () => { expect(cab(0, 0)).toBe(true); });
  it("afford neg cost", () => { expect(cab(100, -1)).toBe(false); });
  it("build wall 90", () => { expect(ceb(100, 10, 100)).toBe(90); });
  it("build floor 95", () => { expect(ceb(100, 5, 100)).toBe(95); });
  it("build clamp 0", () => { expect(ceb(3, 5, 100)).toBe(0); });
  it("build exact 0", () => { expect(ceb(10, 10, 100)).toBe(0); });
  it("build clamp max", () => { expect(ceb(100, -5, 100)).toBe(100); });
  it("dmg 180", () => { expect(asd(200, 20)).toBe(180); });
  it("dmg clamp 0", () => { expect(asd(10, 20)).toBe(0); });
  it("dmg 0", () => { expect(asd(100, 0)).toBe(100); });
  it("dmg neg", () => { expect(asd(100, -5)).toBe(100); });
  it("dmg exact 0", () => { expect(asd(80, 80)).toBe(0); });
  it("dmg accum", () => { let d = getStructureDurability("wall")!; for (let i = 0; i < 5; i++) d = asd(d, AR.damage); expect(d).toBe(100); });
  it("dest 0", () => { expect(isd(0)).toBe(true); });
  it("dest neg", () => { expect(isd(-1)).toBe(true); });
  it("dest 1", () => { expect(isd(1)).toBe(false); });
  it("dest 200", () => { expect(isd(200)).toBe(false); });
});

describe("Energy+destruction integration", () => {
  let sv: GameServer; let ra: CR; let rb: CR;
  const eu: EU[] = []; const sd: SD[] = []; const st: SX[] = [];
  const sd2: SD[] = []; const st2: SX[] = [];
  beforeAll(async () => {
    const s = await wd(startServer(0), 10000, "st");
    sv = s.server;
    const u = `ws://127.0.0.1:${s.port}`;
    ra = await wd(new Client(u).joinOrCreate(TMR), 10000, "A");
    rb = await wd(new Client(u).joinOrCreate(TMR), 10000, "B");
    ra.onMessage(EE.ENERGY_UPDATE, (m) => eu.push(m as EU));
    ra.onMessage(EE.STRUCTURE_DAMAGED, (m) => sd.push(m as SD));
    ra.onMessage(EE.STRUCTURE_DESTROYED, (m) => st.push(m as SX));
    rb.onMessage(EE.STRUCTURE_DAMAGED, (m) => sd2.push(m as SD));
    rb.onMessage(EE.STRUCTURE_DESTROYED, (m) => st2.push(m as SX));
    await wfs(ra, (s) => pl(s, ra.sessionId) && pl(s, rb.sessionId));
    await wfs(rb, (s) => pl(s, ra.sessionId) && pl(s, rb.sessionId));
  }, 20000);
  afterAll(async () => {
    await wd(Promise.all([td(rb), td(ra)]), 5000, "td");
    await wd(shutdownServer(sv), 8000, "sd");
  }, 20000);

  it("full energy on join", () => {
    expect(pl(ra.state, ra.sessionId).energy).toBe(ENERGY.maxEnergy);
    expect(pl(ra.state, rb.sessionId).energy).toBe(ENERGY.maxEnergy);
  });

  it("exact floor cost", async () => {
    ra.send(BE.PLACEMENT_REQUEST, { sequence: 200, buildType: "floor", grid: { x: 1, y: 0, z: 1 }, rotation: 0 });
    const ev = await wfe(eu, (e) => e.playerId === ra.sessionId && e.energy === 95, 5000, "eu");
    expect(ev.energy).toBe(95);
    await wfs(ra, (s) => Object.values(ss(s)).some((x: any) => x.createdSequence === 200), 5000);
    const p = Object.values(ss(ra.state)).find((x: any) => x.createdSequence === 200) as any;
    expect(p.maxDurability).toBe(100);
    expect(p.currentDurability).toBe(100);
  }, 15000);

  it("regen after build", async () => {
    await W(500);
    const e = pl(ra.state, ra.sessionId).energy;
    expect(e).toBeGreaterThan(95);
    expect(e).toBeLessThanOrEqual(ENERGY.maxEnergy);
  });

  it("clamp at max", async () => {
    await W(4000);
    expect(pl(ra.state, ra.sessionId).energy).toBe(ENERGY.maxEnergy);
  });

  it("no double charge", async () => {
    await W(400);
    const b = pl(ra.state, ra.sessionId).energy;
    ra.send(BE.PLACEMENT_REQUEST, { sequence: 201, buildType: "wall", grid: { x: 13, y: 0, z: 0 }, rotation: 0 });
    await W(300);
    expect(Object.values(ss(ra.state)).some((x: any) => x.createdSequence === 201)).toBe(false);
    expect(pl(ra.state, ra.sessionId).energy).toBeGreaterThanOrEqual(b);
  }, 15000);

  it("wall cost 10", async () => {
    await W(400);
    ra.send(BE.PLACEMENT_REQUEST, { sequence: 202, buildType: "wall", grid: { x: 2, y: 0, z: 2 }, rotation: 0 });
    const ev = await wfe(eu, (e) => e.playerId === ra.sessionId && e.energy === 90, 5000, "w");
    expect(ev.energy).toBe(90);
  }, 15000);

  it("damage+destroy+remove", async () => {
    await W(400);
    ra.send(BE.PLACEMENT_REQUEST, { sequence: 203, buildType: "cone", grid: { x: -4, y: 0, z: 0 }, rotation: 0 });
    await wfs(ra, (s) => Object.values(ss(s)).some((x: any) => x.createdSequence === 203), 5000);
    const sid = (Object.values(ss(ra.state)).find((x: any) => x.createdSequence === 203) as any).structureId;
    for (const q of [300, 310, 320, 330]) {
      ra.send(TMI, { sequence: q, moveX: 0, moveZ: 0, lookYaw: Math.PI / 2, lookPitch: Math.atan2(0.1, 1), jump: false, sprint: false, crouch: false, primaryFire: true, secondaryFire: false });
      await W(300);
    }
    const de = await wfe(sd, (e) => e.structureId === sid, 5000, "dm");
    expect(de.damage).toBe(AR.damage);
    expect(de.remainingDurability).toBe(60);
    const xe = await wfe(st, (e) => e.structureId === sid, 5000, "ds");
    expect(xe.destroyedByPlayerId).toBe(ra.sessionId);
    await wfs(ra, (s) => !Object.values(ss(s)).some((x: any) => x.structureId === sid), 5000);
    await wfs(rb, (s) => !Object.values(ss(s)).some((x: any) => x.structureId === sid), 5000);
    expect(sd2.some((e) => e.structureId === sid)).toBe(true);
    expect(st2.some((e) => e.structureId === sid)).toBe(true);
  }, 20000);

  it("collider lifecycle", async () => {
    const pw = await ServerPhysicsWorld.create();
    try {
      pw.addStructureCollider("s", { x: 0, y: 1, z: 0 }, { x: 0.5, y: 1, z: 0.5 });
      pw.addStructureCollider("s", { x: 0, y: 1, z: 0 }, { x: 0.5, y: 1, z: 0.5 });
      pw.removeStructureCollider("s");
      pw.removeStructureCollider("s");
      pw.dispose();
    } finally { try { pw.dispose(); } catch {} }
  }, 15000);

  it("round cleanup", async () => {
    await W(400);
    ra.send(BE.PLACEMENT_REQUEST, { sequence: 204, buildType: "floor", grid: { x: -2, y: 0, z: -2 }, rotation: 0 });
    await wfs(ra, (s) => Object.values(ss(s)).some((x: any) => x.createdSequence === 204), 5000);
    for (let i = 0; i < 30; i++) {
      ra.send(TMI, { sequence: 400 + i * 10, moveX: 0, moveZ: 0, lookYaw: Math.PI / 2, lookPitch: 0, jump: false, sprint: false, crouch: false, primaryFire: true, secondaryFire: false });
      await W(280);
    }
    await wfs(ra, (s) => Object.values(ss(s)).length === 0, 20000);
    expect(Object.values(ss(ra.state)).length).toBe(0);
    await wfs(ra, (s) => pl(s, ra.sessionId).energy === ENERGY.startingEnergy, 10000);
    expect(pl(ra.state, ra.sessionId).energy).toBe(ENERGY.startingEnergy);
    expect(pl(ra.state, rb.sessionId).energy).toBe(ENERGY.startingEnergy);
  }, 25000);
});
