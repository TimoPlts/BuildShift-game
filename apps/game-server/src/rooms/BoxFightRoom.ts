/**
 * Authoritative 1v1 Energy Box Fight room.
 *
 * Weapon system: per-player WeaponState, switching, time-based reloading
 * (advanced in the fixed-timestep tick), and firing.
 *
 * The shotgun spawns `pelletCount` hitscan pellets per trigger pull, each
 * with the aim direction perturbed by a random angle within ±spreadDeg/2.
 *
 * Build editing: validates ownership, full build progress, and per-type
 * edit allowance before applying the edit and broadcasting.
 */
import { Room, type Client } from "@colyseus/core";
import { isWeaponType, isBuildEditType, type Vec3 } from "@buildshift/protocol";
import { weapons, isBuildEditAllowedForStructure, getStructureConfig, MAX_HEALTH, MAX_SHIELD, PLAYER_MOVEMENT, VERTICAL_MOVEMENT, type ShotgunWeaponConfig } from "@buildshift/game-config";
import { stepPlayerMovement, movementInputToWorld, hitscan } from "@buildshift/simulation";
import { BuildingStateSchema, wc, type BuildingStateSchemaInstance } from "../state/buildingState.js";
import {
  BOX_FIGHT_INPUT, BOX_FIGHT_SWITCH_WEAPON, BOX_FIGHT_RELOAD,
  BOX_FIGHT_FIRE, BOX_FIGHT_BUILD_EDIT, BOX_FIGHT_EVENTS,
  PLAYER_TARGET_RADIUS, STRUCTURE_TARGET_RADIUS, WEAPON_RANGES,
  makePlayerWeapons, toWeaponState, parseInputFrame, parseFireRequest,
  perturbDirection, degreesToRadians, structureSnapshot,
  type PlayerWeapons, type InputFrame,
} from "./boxFightContract.js";

const THZ = 30;
const TD = 1 / THZ;
const PHH = VERTICAL_MOVEMENT.playerHalfHeight;
const MC = {
  moveSpeed: PLAYER_MOVEMENT.moveSpeed,
  gravity: VERTICAL_MOVEMENT.gravity,
  jumpVelocity: VERTICAL_MOVEMENT.jumpVelocity,
  terminalVelocity: VERTICAL_MOVEMENT.terminalVelocity,
  groundY: VERTICAL_MOVEMENT.groundY,
};
const SP = [
  { x: -5, y: VERTICAL_MOVEMENT.groundY, z: 0 },
  { x: 5, y: VERTICAL_MOVEMENT.groundY, z: 0 },
];

interface PI {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  vY: number; gr: boolean;
  hp: number; sh: number; alive: boolean;
  wps: PlayerWeapons;
  inp: InputFrame | null;
  cl: Client;
}

interface RH { targetId: string; isStructure: boolean }

interface BFState { building: BuildingStateSchemaInstance }

export class BoxFightRoom extends Room<{ state: BFState }> {
  declare state: BFState;
  maxPlayers = 2;
  private readonly pl = new Map<string, PI>();
  private st = 0;
  private jc = 0;

  constructor(...args: ConstructorParameters<typeof Room>) {
    super(...args);
    (this as unknown as { state: BFState }).state = { building: new BuildingStateSchema() };
  }

  onCreate(): void {
    this.onMessage(BOX_FIGHT_INPUT, (c, m) => this.hi(c, m));
    this.onMessage(BOX_FIGHT_SWITCH_WEAPON, (c, m) => this.hsw(c, m));
    this.onMessage(BOX_FIGHT_RELOAD, (c, m) => this.hr(c, m));
    this.onMessage(BOX_FIGHT_FIRE, (c, m) => this.hf(c, m));
    this.onMessage(BOX_FIGHT_BUILD_EDIT, (c, m) => this.hbe(c, m));
    this.setFixedTimestep(() => this.tick(), THZ);
  }

  onJoin(c: Client): void {
    const i = this.jc % SP.length;
    this.jc++;
    const s = SP[i];
    this.pl.set(c.sessionId, {
      x: s.x, y: s.y, z: s.z, yaw: 0, pitch: 0,
      vY: 0, gr: true, hp: MAX_HEALTH, sh: MAX_SHIELD, alive: true,
      wps: makePlayerWeapons(), inp: null, cl: c,
    });
    this.bws(c.sessionId);
  }

  onLeave(c: Client): void { this.pl.delete(c.sessionId); }
  onDispose(): void { this.pl.clear(); this.state.building.structures.clear(); }

  private tick(): void {
    this.st += TD;
    for (const p of this.pl.values()) this.ar(p);
    for (const p of this.pl.values()) {
      if (!p.alive) continue;
      if (!p.inp) { this.sn(p); continue; }
      const f = p.inp;
      p.inp = null;
      const w = movementInputToWorld({ x: f.moveX, z: f.moveZ }, p.yaw);
      const r = stepPlayerMovement(
        { x: p.x, y: p.y, z: p.z, vx: 0, vy: p.vY, vz: 0, onGround: p.gr },
        { moveX: w.x, moveZ: w.z, jump: f.jump }, TD, MC,
      );
      p.x = r.x; p.y = r.y; p.z = r.z; p.vY = r.vy; p.gr = r.onGround;
      p.yaw = f.lookYaw; p.pitch = f.lookPitch;
    }
  }

  private ar(p: PI): void {
    const s = p.wps.slots[p.wps.active];
    if (!s || !s.isReloading) return;
    s.reloadProgress += TD / weapons[p.wps.active].reloadTimeSec;
    if (s.reloadProgress >= 1) {
      s.reloadProgress = 1; s.isReloading = false; s.currentAmmo = s.maxAmmo;
      this.bws(p.cl.sessionId);
    }
  }

  private sn(p: PI): void {
    const r = stepPlayerMovement(
      { x: p.x, y: p.y, z: p.z, vx: 0, vy: p.vY, vz: 0, onGround: p.gr },
      { moveX: 0, moveZ: 0, jump: false }, TD, MC,
    );
    p.y = r.y; p.vY = r.vy; p.gr = r.onGround;
  }

  private hi(c: Client, m: unknown): void {
    const f = parseInputFrame(m);
    if (!f) return;
    const p = this.pl.get(c.sessionId);
    if (!p || !p.alive) return;
    p.inp = f;
  }

  private hsw(c: Client, m: unknown): void {
    const p = this.pl.get(c.sessionId);
    if (!p || !p.alive) return;
    if (!m || typeof m !== "object") return;
    const r = m as Record<string, unknown>;
    const t = r.targetWeapon ?? r.targetWeaponType ?? r.weaponType;
    if (!isWeaponType(t)) return;
    p.wps.active = t;
    p.wps.slots[t].isReloading = false;
    p.wps.slots[t].reloadProgress = 0;
    this.bws(c.sessionId);
  }

  private hr(c: Client, m: unknown): void {
    const p = this.pl.get(c.sessionId);
    if (!p || !p.alive) return;
    if (!m || typeof m !== "object") return;
    const r = m as Record<string, unknown>;
    const wt: unknown = r.weaponType ?? p.wps.active;
    if (!isWeaponType(wt)) return;
    const s = p.wps.slots[wt];
    if (!s || s.isReloading || s.currentAmmo >= s.maxAmmo) return;
    s.isReloading = true;
    s.reloadProgress = 0;
    this.bws(c.sessionId);
  }

  private hf(c: Client, m: unknown): void {
    const sid = c.sessionId;
    const p = this.pl.get(sid);
    if (!p || !p.alive) return;
    const pf = parseFireRequest(m);
    if (!pf) return;
    const { weaponType, aimDirection } = pf;
    const s = p.wps.slots[weaponType];
    if (!s) return;
    if (s.currentAmmo <= 0) return;
    if (s.isReloading) return;
    const cfg = weapons[weaponType];
    if (s.lastShotAt !== null && (this.st - s.lastShotAt) < 1 / cfg.fireRate) return;
    s.currentAmmo--;
    s.lastShotAt = this.st;
    const o: Vec3 = { x: p.x, y: p.y + PHH, z: p.z };
    const rg = WEAPON_RANGES[weaponType];
    const pts = this.pts(sid);
    const sts = this.sts();
    const hits: Array<{ targetId: string; damage: number; isStructure: boolean }> = [];
    if (weaponType === "assault_rifle") {
      const h = this.rh(o, aimDirection, rg, pts, sts);
      if (h) { this.ad(h, cfg.damage); hits.push({ targetId: h.targetId, damage: cfg.damage, isStructure: h.isStructure }); }
    } else {
      const sc = weapons.shotgun as ShotgunWeaponConfig;
      const pc = sc.pelletCount;
      const hs = degreesToRadians(sc.spreadDeg) / 2;
      for (let i = 0; i < pc; i++) {
        const ang = (Math.random() * 2 - 1) * hs;
        const d = perturbDirection(aimDirection, ang);
        const h = this.rh(o, d, rg, pts, sts);
        if (h) { this.ad(h, cfg.damage); hits.push({ targetId: h.targetId, damage: cfg.damage, isStructure: h.isStructure }); }
      }
    }
    c.send(BOX_FIGHT_EVENTS.FIRE_RESULT, { hits });
    this.bws(sid);
  }

  private hbe(c: Client, m: unknown): void {
    const sid = c.sessionId;
    if (!m || typeof m !== "object") return;
    const r = m as Record<string, unknown>;
    const id = r.structureId;
    const et = r.editType;
    if (typeof id !== "string" || id.length === 0) return;
    if (!isBuildEditType(et)) return;
    const str = this.state.building.structures.get(id);
    if (!str) { c.send(BOX_FIGHT_EVENTS.BUILD_EDIT_RESULT, { success: false, reason: "structure_not_found", structureId: id }); return; }
    if (str.ownerId !== sid) { c.send(BOX_FIGHT_EVENTS.BUILD_EDIT_RESULT, { success: false, reason: "not_owned", structureId: id }); return; }
    if (str.currentDurability < str.maxDurability) { c.send(BOX_FIGHT_EVENTS.BUILD_EDIT_RESULT, { success: false, reason: "not_at_full_build_progress", structureId: id }); return; }
    if (!isBuildEditAllowedForStructure(et, str.buildType)) { c.send(BOX_FIGHT_EVENTS.BUILD_EDIT_RESULT, { success: false, reason: "edit_type_not_allowed", structureId: id }); return; }
    str.editType = et;
    this.broadcast(BOX_FIGHT_EVENTS.STRUCTURE_UPDATE, { structureId: id, editType: et, structure: structureSnapshot(str) });
    c.send(BOX_FIGHT_EVENTS.BUILD_EDIT_RESULT, { success: true, structureId: id });
  }

  private bws(pid: string): void {
    const p = this.pl.get(pid);
    if (!p) return;
    const s = p.wps.slots[p.wps.active];
    this.broadcast(BOX_FIGHT_EVENTS.WEAPON_STATE, { playerId: pid, weaponState: toWeaponState(s) });
  }

  private pts(sid: string): Array<{ id: string; position: Readonly<Vec3> }> {
    const t: Array<{ id: string; position: Readonly<Vec3> }> = [];
    for (const [id, p] of this.pl) {
      if (id === sid || !p.alive) continue;
      t.push({ id, position: { x: p.x, y: p.y + PHH, z: p.z } });
    }
    return t;
  }

  private sts(): Array<{ id: string; position: Readonly<Vec3> }> {
    const t: Array<{ id: string; position: Readonly<Vec3> }> = [];
    for (const s of this.state.building.structures.values()) {
      const cfg = getStructureConfig(s.buildType);
      if (!cfg) continue;
      const w = wc(s.grid, cfg, s.rotation);
      t.push({ id: s.structureId, position: { x: w.ctr.x, y: w.ctr.y, z: w.ctr.z } });
    }
    return t;
  }

  private rh(o: Readonly<Vec3>, d: Readonly<Vec3>, rg: number, pts: Array<{ id: string; position: Readonly<Vec3> }>, sts: Array<{ id: string; position: Readonly<Vec3> }>): RH | null {
    const pH = hitscan(o, d, { damage: 1, range: rg, targetRadius: PLAYER_TARGET_RADIUS }, pts)[0];
    const sH = hitscan(o, d, { damage: 1, range: rg, targetRadius: STRUCTURE_TARGET_RADIUS }, sts)[0];
    if (!pH && !sH) return null;
    if (pH && (!sH || pH.distance <= sH.distance)) return { targetId: pH.targetId, isStructure: false };
    return { targetId: sH.targetId, isStructure: true };
  }

  private ad(h: RH, dmg: number): void {
    if (!h.isStructure) {
      const tp = this.pl.get(h.targetId);
      if (!tp) return;
      let r = dmg;
      if (tp.sh > 0) { const a = Math.min(tp.sh, r); tp.sh -= a; r -= a; }
      if (r > 0) tp.hp = Math.max(0, tp.hp - r);
      if (tp.hp <= 0) { tp.hp = 0; tp.alive = false; }
    } else {
      const s = this.state.building.structures.get(h.targetId);
      if (!s) return;
      s.currentDurability = Math.max(0, s.currentDurability - dmg);
      if (s.currentDurability <= 0) this.state.building.structures.delete(h.targetId);
    }
  }
}
