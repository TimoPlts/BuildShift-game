/**
 * Server weapon and build-edit integration tests for BoxFightRoom.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";
import { weapons, getStructureDurability, type ShotgunWeaponConfig } from "@buildshift/game-config";
import { BoxFightRoom } from "../rooms/BoxFightRoom.js";
import { BOX_FIGHT_ROOM, BOX_FIGHT_SWITCH_WEAPON, BOX_FIGHT_RELOAD, BOX_FIGHT_FIRE, BOX_FIGHT_BUILD_EDIT, BOX_FIGHT_EVENTS } from "../rooms/boxFightContract.js";
import { StructureStateSchema } from "../state/buildingState.js";
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function wfe<T>(a: T[], p: (e: T, i: number) => boolean, ms = 5000, l = "evt"): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    for (let i = 0; i < a.length; i++) { if (p(a[i]!, i)) return a[i]!; }
    await wait(25);
  }
  throw new Error(`wfe timeout ${ms}ms ${l}`);
}
async function wd<T>(p: Promise<T>, ms: number, l: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try { return await Promise.race([p, new Promise<never>((_, rj) => { t = setTimeout(() => rj(new Error(l)), ms); })]); }
  finally { if (t) clearTimeout(t); }
}
async function td(r: ClientRoom | null): Promise<void> {
  if (!r) return; r.leave().catch(() => {}); try { r.connection.close(); } catch {}
}
interface WSE { playerId: string; weaponState: { weaponType: string; currentAmmo: number; maxAmmo: number; isReloading: boolean; reloadProgress: number } }
interface FRE { hits: Array<{ targetId: string; damage: number; isStructure: boolean }> }
interface BER { success: boolean; reason?: string; structureId: string }
interface SUE { structureId: string; editType: string; structure: Record<string, unknown> }
// Capture the room instance when Colyseus creates it
let bfRoom: BoxFightRoom | undefined;
class CapturedBoxFightRoom extends BoxFightRoom {
  constructor(...args: ConstructorParameters<typeof BoxFightRoom>) {
    super(...args);
    bfRoom = this;
  }
}
describe("Weapon and build-edit integration (BoxFightRoom)", () => {
  let server: Server; let port: number; let roomA: ClientRoom; let roomB: ClientRoom;
  const ws: WSE[] = []; const fr: FRE[] = []; const ber: BER[] = []; const sue: SUE[] = [];
  beforeAll(async () => {
    const tr = new WebSocketTransport();
    server = new Server({ gracefullyShutdown: false, greet: true, transport: tr });
    server.define(BOX_FIGHT_ROOM, CapturedBoxFightRoom);
    await wd(server.listen(0), 10_000, "listen");
    port = (tr as unknown as { server: { address(): { port: number } } }).server.address().port;
    const url = `ws://127.0.0.1:${port}`;
    roomA = await wd(new Client(url).joinOrCreate(BOX_FIGHT_ROOM), 10_000, "A");
    roomB = await wd(new Client(url).joinOrCreate(BOX_FIGHT_ROOM), 10_000, "B");
    expect(roomA.sessionId).not.toBe(roomB.sessionId);
    roomA.onMessage(BOX_FIGHT_EVENTS.WEAPON_STATE, (m: unknown) => ws.push(m as WSE));
    roomA.onMessage(BOX_FIGHT_EVENTS.FIRE_RESULT, (m: unknown) => fr.push(m as FRE));
    roomA.onMessage(BOX_FIGHT_EVENTS.BUILD_EDIT_RESULT, (m: unknown) => ber.push(m as BER));
    roomA.onMessage(BOX_FIGHT_EVENTS.STRUCTURE_UPDATE, (m: unknown) => sue.push(m as SUE));
    roomB.onMessage(BOX_FIGHT_EVENTS.BUILD_EDIT_RESULT, (m: unknown) => ber.push(m as BER));
    // Trigger observable weapon state (initial broadcast happens during onJoin, before handlers)
    roomA.send(BOX_FIGHT_SWITCH_WEAPON, { targetWeapon: "assault_rifle" });
    await wfe(ws, (e) => e.playerId === roomA.sessionId, 5000, "A ws");
    roomB.send(BOX_FIGHT_SWITCH_WEAPON, { targetWeapon: "assault_rifle" });
    await wfe(ws, (e) => e.playerId === roomB.sessionId, 5000, "B ws");
  }, 20_000);
  afterAll(async () => {
    await wd(Promise.all([td(roomB), td(roomA)]), 5000, "td");
    await wd(server.gracefullyShutdown(false), 8000, "shutdown");
  }, 20_000);
  function inj(id: string, bt: string, owner: string): void {
    expect(bfRoom).toBeDefined();
    const s = new StructureStateSchema();
    s.structureId = id; s.buildType = bt; s.ownerId = owner; s.createdSequence = 1;
    s.maxDurability = getStructureDurability(bt) ?? 100; s.currentDurability = s.maxDurability; s.editType = "";
    bfRoom!.state.building.structures.set(id, s);
  }
  it("a fresh player has assault_rifle as active weapon at full ammo", () => {
    const w = ws.find((e) => e.playerId === roomA.sessionId)!;
    expect(w.weaponState.weaponType).toBe("assault_rifle");
    expect(w.weaponState.currentAmmo).toBe(weapons.assault_rifle.magazineSize);
    expect(w.weaponState.maxAmmo).toBe(weapons.assault_rifle.magazineSize);
    expect(w.weaponState.isReloading).toBe(false);
    expect(w.weaponState.reloadProgress).toBe(0);
  });
  it("switching to shotgun changes active weapon and resets reload state", async () => {
    const b = ws.length;
    roomA.send(BOX_FIGHT_SWITCH_WEAPON, { targetWeapon: "shotgun" });
    const w = await wfe(ws, (e, i) => i >= b && e.playerId === roomA.sessionId && e.weaponState.weaponType === "shotgun", 5000, "sg");
    expect(w.weaponState.isReloading).toBe(false);
    expect(w.weaponState.reloadProgress).toBe(0);
    expect(w.weaponState.currentAmmo).toBe(weapons.shotgun.magazineSize);
  }, 10_000);
  it("reloading an assault rifle at full ammo is rejected", async () => {
    const b = ws.length;
    roomA.send(BOX_FIGHT_SWITCH_WEAPON, { targetWeapon: "assault_rifle" });
    await wfe(ws, (e, i) => i >= b && e.playerId === roomA.sessionId && e.weaponState.weaponType === "assault_rifle", 5000, "ar");
    const c = ws.length;
    roomA.send(BOX_FIGHT_RELOAD, { weaponType: "assault_rifle" });
    await wait(400);
    const reloading = ws.filter((e, i) => i >= c && e.playerId === roomA.sessionId && e.weaponState.isReloading);
    expect(reloading).toHaveLength(0);
  }, 10_000);
  it("reloading a shotgun at 0 ammo succeeds and transitions to full ammo after reloadTimeSec", async () => {
    let b = ws.length;
    roomA.send(BOX_FIGHT_SWITCH_WEAPON, { targetWeapon: "shotgun" });
    await wfe(ws, (e, i) => i >= b && e.playerId === roomA.sessionId && e.weaponState.weaponType === "shotgun", 5000, "sg");
    for (let i = 0; i < weapons.shotgun.magazineSize; i++) {
      roomA.send(BOX_FIGHT_FIRE, { weaponType: "shotgun", aimDirection: { x: 1, y: 0, z: 0 } });
      await wait(750);
    }
    b = ws.length;
    roomA.send(BOX_FIGHT_RELOAD, { weaponType: "shotgun" });
    const rs = await wfe(ws, (e, i) => i >= b && e.playerId === roomA.sessionId && e.weaponState.isReloading, 5000, "rl");
    expect(rs.weaponState.isReloading).toBe(true);
    b = ws.length;
    const rc = await wfe(ws, (e, i) => i >= b && e.playerId === roomA.sessionId && e.weaponState.currentAmmo === weapons.shotgun.magazineSize && !e.weaponState.isReloading, 6000, "rc");
    expect(rc.weaponState.currentAmmo).toBe(weapons.shotgun.magazineSize);
    expect(rc.weaponState.isReloading).toBe(false);
  }, 30_000);
  it("firing with 0 ammo is rejected", async () => {
    for (let i = 0; i < weapons.shotgun.magazineSize; i++) {
      roomA.send(BOX_FIGHT_FIRE, { weaponType: "shotgun", aimDirection: { x: 1, y: 0, z: 0 } });
      await wait(750);
    }
    const f = fr.length;
    roomA.send(BOX_FIGHT_FIRE, { weaponType: "shotgun", aimDirection: { x: 1, y: 0, z: 0 } });
    await wait(500);
    expect(fr.length).toBe(f);
  }, 30_000);
  it("firing a shotgun produces exactly pelletCount hits in FireResult", async () => {
    const sc = weapons.shotgun as ShotgunWeaponConfig;
    let b = ws.length;
    roomA.send(BOX_FIGHT_RELOAD, { weaponType: "shotgun" });
    await wfe(ws, (e, i) => i >= b && e.playerId === roomA.sessionId && e.weaponState.isReloading, 5000, "rl");
    b = ws.length;
    await wfe(ws, (e, i) => i >= b && e.playerId === roomA.sessionId && e.weaponState.currentAmmo === weapons.shotgun.magazineSize && !e.weaponState.isReloading, 6000, "rc");
    const f = fr.length;
    roomA.send(BOX_FIGHT_FIRE, { weaponType: "shotgun", aimDirection: { x: 1, y: 0, z: 0 } });
    const r = await wfe(fr, (e, i) => i >= f, 5000, "sg");
    expect(r.hits).toHaveLength(sc.pelletCount);
  }, 30_000);
  it("firing an assault rifle produces exactly 1 hit", async () => {
    let b = ws.length;
    roomA.send(BOX_FIGHT_SWITCH_WEAPON, { targetWeapon: "assault_rifle" });
    await wfe(ws, (e, i) => i >= b && e.playerId === roomA.sessionId && e.weaponState.weaponType === "assault_rifle", 5000, "ar");
    const f = fr.length;
    roomA.send(BOX_FIGHT_FIRE, { weaponType: "assault_rifle", aimDirection: { x: 1, y: 0, z: 0 } });
    const r = await wfe(fr, (e, i) => i >= f, 5000, "ar");
    expect(r.hits).toHaveLength(1);
  }, 30_000);
  it("a BuildEditCommand on a structure not owned by the player is rejected with success false", async () => {
    inj("wall-a", "wall", roomA.sessionId);
    await wait(200);
    const b = ber.length;
    roomB.send(BOX_FIGHT_BUILD_EDIT, { structureId: "wall-a", editType: "door" });
    const r = await wfe(ber, (e, i) => i >= b && e.structureId === "wall-a", 5000, "not_owned");
    expect(r.success).toBe(false);
    expect(r.reason).toBe("not_owned");
  });
  it("a BuildEditCommand with an invalid editType for the structure type is rejected", async () => {
    inj("floor-a", "floor", roomA.sessionId);
    await wait(200);
    const b = ber.length;
    roomA.send(BOX_FIGHT_BUILD_EDIT, { structureId: "floor-a", editType: "door" });
    const r = await wfe(ber, (e, i) => i >= b && e.structureId === "floor-a", 5000, "inv");
    expect(r.success).toBe(false);
    expect(r.reason).toBe("edit_type_not_allowed");
  });
  it("a valid BuildEditCommand on an owned fully-built wall with editType door succeeds", async () => {
    inj("wall-ok", "wall", roomA.sessionId);
    await wait(200);
    const b = ber.length; const s = sue.length;
    roomA.send(BOX_FIGHT_BUILD_EDIT, { structureId: "wall-ok", editType: "door" });
    const r = await wfe(ber, (e, i) => i >= b && e.structureId === "wall-ok", 5000, "ok");
    expect(r.success).toBe(true);
    const upd = await wfe(sue, (e, i) => i >= s && e.structureId === "wall-ok", 5000, "upd");
    expect(upd.editType).toBe("door");
    expect(upd.structure.editType).toBe("door");
  });
});
