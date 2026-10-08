import { Room, type Client } from "@colyseus/core";
import { t } from "@colyseus/schema";
import { RoomStateSchema, PlayerStateSchema, RoundScoreSchema, WeaponAmmoStateSchema, type RoomStateSchemaInstance, PLAYER_NETWORK_INPUT_LIMITS as PIL, EVENTS, MatchPhase, BUILD_EVENTS, ENERGY_EVENTS, BUILD_EDIT_EVENTS, computeEnergyAfterRegeneration, applyStructureDamage, isStructureDestroyed, type WeaponState, type WeaponId, isWeaponId, isBuildEditType, isStructureOpeningPattern } from "@buildshift/protocol";
import { stepPlayerMovement, movementInputToWorld, fireGate, hitscan, computeShotgunSpread } from "@buildshift/simulation";
import { PLAYER_MOVEMENT, VERTICAL_MOVEMENT, ASSAULT_RIFLE, SHOTGUN, MAX_HEALTH, MAX_SHIELD, ROUNDS_TO_WIN, ROUND_COUNTDOWN_SECONDS as RCS, ROUND_RESET_DELAY_SECONDS as RRS, ROUND_DURATION_SECONDS, ANTI_STALL_TIMEOUT_SECONDS, REMATCH_WINDOW_SECONDS, getStructureConfig, ENERGY, SHOTGUN_WEAPON, isBuildEditAllowedForStructure } from "@buildshift/game-config";
import { BuildingStateSchema, StructureStateSchema, oc, wc } from "../state/buildingState.js";
import { ServerPhysicsWorld } from "../physics/serverPhysicsWorld.js";
import { MATCH_EVENTS } from "../match/matchLifecycle.js";
import { handleBuildPlacement } from "../match/buildPlacement.js";
import { createReconnectGraceManager, RECONNECT_GRACE_MS, type ReconnectGraceManager } from "./lifecycle/reconnectGrace.js";
export const TWO_PLAYER_MOVEMENT_ROOM = "two-player-movement";
export const TWO_PLAYER_MOVEMENT_INPUT = "two-player:input";
export const WEAPON_SWITCH_INPUT = "two-player:weapon_switch";
const THZ = 30, TD = 1 / THZ;
const MC = { moveSpeed: PLAYER_MOVEMENT.moveSpeed, gravity: VERTICAL_MOVEMENT.gravity, jumpVelocity: VERTICAL_MOVEMENT.jumpVelocity, terminalVelocity: VERTICAL_MOVEMENT.terminalVelocity, groundY: VERTICAL_MOVEMENT.groundY };
const EH = VERTICAL_MOVEMENT.playerHalfHeight, TR = 0.4;
const CT = Math.max(1, Math.round(RCS * THZ)), RT = Math.max(1, Math.round(RRS * THZ)), ROUND_TICKS = Math.max(1, Math.round(ROUND_DURATION_SECONDS * THZ)), STALL_TICKS = Math.max(1, Math.round(ANTI_STALL_TIMEOUT_SECONDS * THZ));
const REMATCH_REQUEST = "match:rematch_request";
const SP = [{ x: -5, y: VERTICAL_MOVEMENT.groundY, z: 0 }, { x: 5, y: VERTICAL_MOVEMENT.groundY, z: 0 }];
const CWO: WeaponId = "assault_rifle";
const WSE = "combat:weapon_state";
const PLAYER_LOADOUT: readonly WeaponId[] = ["assault_rifle", "shotgun"];
interface WS {
    magazineAmmo: number;
    reserveAmmo: number;
    reloading: boolean;
    reloadProgress: number;
}
interface PWS {
    equippedWeaponId: WeaponId;
    slots: Map<WeaponId, WS>;
}
/** Plain-data snapshot of a player's authoritative state, saved during the
 *  reconnect grace window. Restored verbatim if the session re-joins before
 *  the window expires. */
interface PlayerSnapshot {
    x: number; y: number; z: number; yaw: number; velocityY: number;
    grounded: boolean; lastProcessedSequence: number;
    health: number; shield: number; energy: number;
    ammo: number; lastFireSequence: number;
    alive: boolean; isEliminated: boolean; currentWeapon: WeaponId;
    weaponState: PWS;
    spawnIndex: number;
    roundScoreValue: number;
    nextFireTickValue: number;
    inactiveTicksValue: number;
    lastPlacementTick: number;
}
function cws(): PWS { return { equippedWeaponId: CWO, slots: new Map<WeaponId, WS>([[ASSAULT_RIFLE.id as WeaponId, { magazineAmmo: ASSAULT_RIFLE.maxAmmo, reserveAmmo: ASSAULT_RIFLE.maxReserve, reloading: false, reloadProgress: 0 }], [SHOTGUN.id as WeaponId, { magazineAmmo: SHOTGUN.maxAmmo, reserveAmmo: SHOTGUN.maxReserve, reloading: false, reloadProgress: 0 }]]) }; }
function tws(ws: PWS): WeaponState { const s = ws.slots.get(ws.equippedWeaponId)!; return { weaponId: ws.equippedWeaponId, ammoInMag: s.magazineAmmo, ammoReserve: s.reserveAmmo, reloading: s.reloading, reloadRemainingMs: s.reloading ? Math.ceil((wcfg(ws.equippedWeaponId).reloadTicks - s.reloadProgress) * 1000 / THZ) : 0 }; }
function cl(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; }
function nm(x: unknown, a: number, b: number) { return typeof x === "number" && Number.isFinite(x) ? cl(x, a, b) : 0; }
function ad(y: number, p: number) { const c = Math.cos(p); return { x: Math.sin(y) * c, y: Math.sin(p), z: -Math.cos(y) * c }; }
function pi(m: unknown) { if (!m || typeof m !== "object")
    return null; const r = m as Record<string, unknown>, s = r.sequence; if (typeof s !== "number" || !Number.isSafeInteger(s) || s < 0)
    return null; return { sequence: s, moveX: nm(r.moveX, PIL.movementMin, PIL.movementMax), moveZ: nm(r.moveZ, PIL.movementMin, PIL.movementMax), lookYaw: nm(r.lookYaw, -Math.PI, Math.PI), lookPitch: nm(r.lookPitch, PIL.pitchMin, PIL.pitchMax), jump: r.jump === true, primaryFire: r.primaryFire === true }; }
type PE = InstanceType<typeof PlayerStateSchema>;
function wcfg(id: WeaponId) { return id === "shotgun" ? SHOTGUN : ASSAULT_RIFLE; }
function initW(p: PE): void { p.ammo = ASSAULT_RIFLE.maxAmmo; p.lastFireSequence = -1; p.currentWeapon = CWO; const a = new WeaponAmmoStateSchema(); a.magazineAmmo = ASSAULT_RIFLE.maxAmmo; a.reserveAmmo = ASSAULT_RIFLE.maxReserve; a.isReloading = false; a.reloadProgress = 0; p.weapons.set(ASSAULT_RIFLE.id, a); const s = new WeaponAmmoStateSchema(); s.magazineAmmo = SHOTGUN.maxAmmo; s.reserveAmmo = SHOTGUN.maxReserve; s.isReloading = false; s.reloadProgress = 0; p.weapons.set(SHOTGUN.id, s); }
const CanonicalRoomState = RoomStateSchema.extend({ structures: t.map(StructureStateSchema) }, "CanonicalRoomState");
export class TwoPlayerMovementRoom extends Room<{
    state: RoomStateSchemaInstance;
}> {
    state = new CanonicalRoomState();
    maxPlayers = 2;
    private readonly bld = new BuildingStateSchema();
    private readonly occ = new Set<string>();
    private readonly lpt = new Map<string, number>();
    private tc = 0;
    private sc = 0;
    private pw: ServerPhysicsWorld | null = null;
    private readonly pwp: Promise<ServerPhysicsWorld>;
    private readonly inb = new Map<string, any>();
    private jc = 0;
    private readonly ss = new Map<string, number>();
    private ptl = 0;
    private readonly wps = new Map<string, PWS>();
    private readonly nextFireTick = new Map<string, number>();
    private roundTicks = 0;
    private readonly inactiveTicks = new Map<string, number>();
    private readonly rematchVotes = new Set<string>();
    private matchEndedAt = 0;
    private readonly reconnectGrace: ReconnectGraceManager;
    constructor(...args: ConstructorParameters<typeof Room>) {
        super(...args);
        this.bld.structures = this.state.structures;
        this.pwp = ServerPhysicsWorld.create().then(w => { this.pw = w; return w; });
        this.reconnectGrace = createReconnectGraceManager(RECONNECT_GRACE_MS, (sid, snap) => this.handleGraceExpire(sid, snap as PlayerSnapshot));
    }
    onCreate(): void { this.onMessage(TWO_PLAYER_MOVEMENT_INPUT, (c, m) => { this.hi(c, m); }); this.onMessage(WEAPON_SWITCH_INPUT, (c, m) => { this.hws(c, m); }); this.onMessage("two-player:weapon_reload", (c, m) => { this.hr(c, m); }); this.onMessage(BUILD_EDIT_EVENTS.EDIT_REQUEST, (c, m) => { this.hbe(c, m); }); this.onMessage(BUILD_EVENTS.PLACEMENT_REQUEST, (c, m) => { this.hpr(c, m); }); this.onMessage(REMATCH_REQUEST, (c) => { this.rm(c); }); this.state.matchPhase = MatchPhase.COUNTDOWN; this.state.currentRound = 0; this.ptl = CT; this.setFixedTimestep(() => this.tick(), THZ); }
    onJoin(c: Client): void {
        // Reconnect within grace: restore prior authoritative state.
        const snap = this.reconnectGrace.restore(c.sessionId) as PlayerSnapshot | undefined;
        if (snap) {
            this.restoreFromSnapshot(c.sessionId, snap);
            return;
        }
        const si = this.jc % SP.length, sp = SP[si]; this.jc++; this.ss.set(c.sessionId, si); const p = new PlayerStateSchema(); p.x = sp.x; p.y = sp.y; p.z = sp.z; p.yaw = 0; p.velocityY = 0; p.grounded = true; p.lastProcessedSequence = -1; p.health = MAX_HEALTH; p.shield = MAX_SHIELD; p.energy = ENERGY.startingEnergy; p.alive = true; p.isEliminated = false; initW(p); this.wps.set(c.sessionId, cws()); this.state.players.set(c.sessionId, p); const r = new RoundScoreSchema(); r.value = 0; this.state.roundScore.set(c.sessionId, r); if (this.state.matchPhase === MatchPhase.MATCH_ENDED)
        this.resetMatch();
    }
    onLeave(c: Client, _e?: number): void {
        // Preserve the player's state for the reconnect grace window.
        // The round is NOT ended here — the grace expiry handler does that
        // if the player fails to rejoin in time.
        const p = this.state.players.get(c.sessionId);
        if (p) {
            this.reconnectGrace.save(c.sessionId, this.createSnapshot(c.sessionId, p));
        }
        this.state.players.delete(c.sessionId); this.inb.delete(c.sessionId); this.inactiveTicks.delete(c.sessionId); this.rematchVotes.delete(c.sessionId); this.ss.delete(c.sessionId); this.lpt.delete(c.sessionId); this.wps.delete(c.sessionId); this.nextFireTick.delete(c.sessionId);
    }
    onDispose(): void { this.reconnectGrace.dispose(); this.inb.clear(); this.ss.clear(); this.lpt.clear(); this.occ.clear(); this.wps.clear(); if (this.pw) {
        this.pw.dispose();
        this.pw = null;
    } }
    private getOpp(sid: string): string | null { for (const k of this.state.players.keys())
        if (k !== sid)
            return k; return null; }
    /** Build a plain-data snapshot of the player's authoritative state. */
    private createSnapshot(sid: string, p: PE): PlayerSnapshot {
        const ws = this.wps.get(sid);
        const weaponState: PWS = ws
            ? { equippedWeaponId: ws.equippedWeaponId, slots: new Map(ws.slots) }
            : cws();
        return {
            x: p.x, y: p.y, z: p.z, yaw: p.yaw, velocityY: p.velocityY,
            grounded: p.grounded, lastProcessedSequence: p.lastProcessedSequence,
            health: p.health, shield: p.shield, energy: p.energy,
            ammo: p.ammo, lastFireSequence: p.lastFireSequence,
            alive: p.alive, isEliminated: p.isEliminated, currentWeapon: p.currentWeapon as WeaponId,
            weaponState,
            spawnIndex: this.ss.get(sid) ?? 0,
            roundScoreValue: this.state.roundScore.get(sid)?.value ?? 0,
            nextFireTickValue: this.nextFireTick.get(sid) ?? 0,
            inactiveTicksValue: this.inactiveTicks.get(sid) ?? 0,
            lastPlacementTick: this.lpt.get(sid) ?? 0,
        };
    }
    /** Restore a player's authoritative state from a grace snapshot. */
    private restoreFromSnapshot(sid: string, snap: PlayerSnapshot): void {
        const p = new PlayerStateSchema();
        p.x = snap.x; p.y = snap.y; p.z = snap.z;
        p.yaw = snap.yaw; p.velocityY = snap.velocityY; p.grounded = snap.grounded;
        p.lastProcessedSequence = snap.lastProcessedSequence;
        p.health = snap.health; p.shield = snap.shield; p.energy = snap.energy;
        p.alive = snap.alive; p.isEliminated = snap.isEliminated;
        p.currentWeapon = snap.currentWeapon; p.lastFireSequence = snap.lastFireSequence;
        p.ammo = snap.ammo;
        // Restore per-weapon schema map from the snapshot's weapon state.
        p.weapons.clear();
        for (const [wid, slot] of snap.weaponState.slots) {
            const w = new WeaponAmmoStateSchema();
            w.magazineAmmo = slot.magazineAmmo;
            w.reserveAmmo = slot.reserveAmmo;
            w.isReloading = slot.reloading;
            w.reloadProgress = slot.reloadProgress;
            p.weapons.set(wid, w);
        }
        // Restore room-level maps.
        this.wps.set(sid, { equippedWeaponId: snap.weaponState.equippedWeaponId, slots: new Map(snap.weaponState.slots) });
        this.ss.set(sid, snap.spawnIndex);
        this.inactiveTicks.set(sid, snap.inactiveTicksValue);
        this.nextFireTick.set(sid, snap.nextFireTickValue);
        if (snap.lastPlacementTick > 0) this.lpt.set(sid, snap.lastPlacementTick);
        // Restore round score.
        const rs = this.state.roundScore.get(sid);
        if (rs) rs.value = snap.roundScoreValue;
        else { const r = new RoundScoreSchema(); r.value = snap.roundScoreValue; this.state.roundScore.set(sid, r); }
        this.state.players.set(sid, p);
    }
    /** Grace window elapsed without reconnection: apply the disconnect consequence. */
    private handleGraceExpire(sid: string, _snap: PlayerSnapshot): void {
        const ph = this.state.matchPhase as MatchPhase;
        if (ph === MatchPhase.IN_PROGRESS) {
            const op = this.getOpp(sid);
            if (op) this.endRound(op, sid, "disconnect");
        }
    }
    private hi(c: Client, m: unknown): void { const i = pi(m); if (!i)
        return; this.inb.set(c.sessionId, i); this.inactiveTicks.set(c.sessionId, 0); }
    private async hpr(c: Client, msg: unknown): Promise<void> { this.sc++; await handleBuildPlacement(c, msg, { state: this.state, bld: this.bld, occ: this.occ, lpt: this.lpt, tc: this.tc, structureId: this.roomId + "-" + this.sc, pwPromise: this.pwp, broadcast: (ev, d) => this.broadcast(ev, d), sendTo: (cl2, ev, d) => cl2.send(ev, d) }); }
    private hws(c: Client, m: unknown): void { if (this.state.matchPhase !== MatchPhase.IN_PROGRESS)
        return; const ws = this.wps.get(c.sessionId); if (!ws)
        return; const p = this.state.players.get(c.sessionId); if (!p || p.isEliminated || !p.alive)
        return; if (!m || typeof m !== "object")
        return; const r = m as Record<string, unknown>; const target = r.targetWeaponId ?? r.weaponId; if (typeof target !== "string" || !isWeaponId(target))
        return; if (!PLAYER_LOADOUT.includes(target))
        return; const cs = ws.slots.get(ws.equippedWeaponId); if (cs?.reloading)
        return; ws.equippedWeaponId = target; p.currentWeapon = target; const ns = ws.slots.get(target)!; p.ammo = ns.magazineAmmo; const se = p.weapons.get(target); if (se) {
        se.magazineAmmo = ns.magazineAmmo;
        se.reserveAmmo = ns.reserveAmmo;
        se.isReloading = ns.reloading;
        se.reloadProgress = ns.reloading ? ns.reloadProgress / wcfg(target).reloadTicks : 0;
    } c.send(WSE, tws(ws)); }
    private hr(c: Client, m: unknown): void {
        const ws = this.wps.get(c.sessionId), p = this.state.players.get(c.sessionId);
        if (!ws || !p || p.isEliminated || !p.alive || this.state.matchPhase !== MatchPhase.IN_PROGRESS)
            return;
        if (!m || typeof m !== "object" || Array.isArray(m))
            return;
        const r = m as Record<string, unknown>, requested = r.weaponId ?? r.targetWeaponId;
        if (requested !== undefined && requested !== ws.equippedWeaponId)
            return;
        const tid = ws.equippedWeaponId, slot = ws.slots.get(tid), cfg = wcfg(tid);
        if (!slot || slot.reloading || slot.magazineAmmo >= cfg.maxAmmo || slot.reserveAmmo <= 0)
            return;
        slot.reloading = true;
        slot.reloadProgress = 0;
        const se = p.weapons.get(tid);
        if (se) {
            se.isReloading = true;
            se.reloadProgress = 0;
        }
        c.send(WSE, tws(ws));
    }
    private hbe(c: Client, m: unknown): void {
        if (!m || typeof m !== "object" || Array.isArray(m))
            return;
        const r = m as Record<string, unknown>, id = r.structureId;
        if (typeof id !== "string" || !id)
            return;
        const reject = (reason: string) => c.send(BUILD_EDIT_EVENTS.EDIT_RESULT, { structureId: id, success: false, reason });
        const p = this.state.players.get(c.sessionId), s = this.bld.structures.get(id);
        if (!p || !p.alive || p.isEliminated || this.state.matchPhase !== MatchPhase.IN_PROGRESS) {
            reject("invalid_player_state");
            return;
        }
        if (!s) {
            reject("structure_not_found");
            return;
        }
        if (s.ownerId !== c.sessionId) {
            reject("not_owned");
            return;
        }
        if (s.currentDurability <= 0 || s.currentDurability < s.maxDurability) {
            reject("invalid_structure_state");
            return;
        }
        let edit: unknown = r.editType;
        if (r.editPattern !== undefined) {
            if (!isStructureOpeningPattern(r.editPattern)) {
                reject("invalid_pattern");
                return;
            }
            edit = ({ door_top: "door", window_center: "window", half_bottom: "half_bottom", none: "" } as const)[r.editPattern];
        }
        if (edit !== "" && (!isBuildEditType(edit) || !isBuildEditAllowedForStructure(edit, s.buildType))) {
            reject("edit_type_not_allowed");
            return;
        }
        if (r.gridOffset !== undefined) {
            const g = r.gridOffset as Record<string, unknown>;
            if (!g || typeof g !== "object" || ![g.x, g.y, g.z].every(v => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 2)) {
                reject("invalid_cell");
                return;
            }
        }
        s.editType = edit as string;
        this.broadcast(BUILD_EDIT_EVENTS.EDIT_RESULT, { structureId: id, success: true, editType: s.editType, updatedStructure: s.toJSON() });
    }
    private adv(): void { for (const [sid, p] of this.state.players) {
        const ws = this.wps.get(sid);
        if (!ws)
            continue;
        for (const [wid, sl] of ws.slots) {
            if (!sl.reloading)
                continue;
            const cfg = wcfg(wid);
            sl.reloadProgress += 1;
            const se = p.weapons.get(wid);
            if (se)
                se.reloadProgress = sl.reloadProgress / cfg.reloadTicks;
            if (sl.reloadProgress >= cfg.reloadTicks) {
                sl.reloading = false;
                const n = cfg.maxAmmo - sl.magazineAmmo, t = Math.min(n, sl.reserveAmmo);
                sl.magazineAmmo += t;
                sl.reserveAmmo -= t;
                sl.reloadProgress = 0;
                if (se) {
                    se.magazineAmmo = sl.magazineAmmo;
                    se.reserveAmmo = sl.reserveAmmo;
                    se.isReloading = false;
                    se.reloadProgress = 0;
                }
                if (wid === ws.equippedWeaponId) {
                    p.ammo = sl.magazineAmmo;
                    this.clients.find(c => c.sessionId === sid)?.send(WSE, tws(ws));
                }
            }
        }
    } }
    private tick(): void { this.tc++; const ph = this.state.matchPhase as MatchPhase; if (ph === MatchPhase.COUNTDOWN) {
        if (this.ptl > 0) {
            this.ptl--;
            this.broadcast(MATCH_EVENTS.COUNTDOWN_TICK, { countdownTicks: this.ptl, totalTicks: CT });
            if (this.ptl === 0)
                this.br();
        }
        return;
    } if (ph === MatchPhase.ROUND_ENDED) {
        if (this.ptl > 0) {
            this.ptl--;
            if (this.ptl === 0)
                this.bc();
        }
        return;
    } if (ph !== MatchPhase.IN_PROGRESS)
        return; this.adv(); this.roundTicks = Math.max(0, this.roundTicks - 1); this.broadcast(MATCH_EVENTS.ROUND_TIMER, { remainingMs: Math.round(this.roundTicks * 1000 / THZ), totalMs: Math.round(ROUND_TICKS * 1000 / THZ) }); if (this.roundTicks === 0) {
        this.resolveTimeout();
        return;
    } for (const [, p] of this.state.players) {
        p.energy = computeEnergyAfterRegeneration(p.energy, ENERGY.maxEnergy, 1, ENERGY.regenPerTick);
    } for (const [sid, p] of this.state.players) {
        const inact = (this.inactiveTicks.get(sid) ?? 0) + 1;
        this.inactiveTicks.set(sid, inact);
        if (inact >= STALL_TICKS) {
            const op = this.getOpp(sid);
            if (op)
                this.endRound(op, sid, "anti_stall_timeout");
            return;
        }
        if (p.isEliminated || this.state.matchPhase !== MatchPhase.IN_PROGRESS) {
            this.inb.delete(sid);
            continue;
        }
        const buf = this.inb.get(sid);
        if (buf === undefined) {
            this.sn(p);
            continue;
        }
        if (buf.sequence <= p.lastProcessedSequence) {
            this.inb.delete(sid);
            this.sn(p);
            continue;
        }
        const wd = movementInputToWorld({ x: buf.moveX, z: buf.moveZ }, p.yaw);
        const res = stepPlayerMovement({ x: p.x, y: p.y, z: p.z, vx: 0, vy: p.velocityY, vz: 0, onGround: p.grounded }, { moveX: wd.x, moveZ: wd.z, jump: buf.jump }, TD, MC);
        p.x = res.x;
        p.y = res.y;
        p.z = res.z;
        p.velocityY = res.vy;
        p.grounded = res.onGround;
        p.yaw = buf.lookYaw;
        p.lastProcessedSequence = buf.sequence;
        if (buf.primaryFire)
            this.rf(sid, p, buf.lookYaw, buf.lookPitch);
        this.inb.delete(sid);
    } }
    private sn(p: PE): void { const res = stepPlayerMovement({ x: p.x, y: p.y, z: p.z, vx: 0, vy: p.velocityY, vz: 0, onGround: p.grounded }, { moveX: 0, moveZ: 0, jump: false }, TD, MC); p.y = res.y; p.velocityY = res.vy; p.grounded = res.onGround; }
    private bc(): void { this.broadcast(MATCH_EVENTS.ROUND_RESET, { clearBuilds: true, resetHealth: MAX_HEALTH, resetEnergy: ENERGY.startingEnergy }); this.rp(); this.inb.clear(); this.state.matchPhase = MatchPhase.COUNTDOWN; this.ptl = CT; }
    private br(): void { this.inb.clear(); this.inactiveTicks.clear(); for (const sid of this.state.players.keys())
        this.inactiveTicks.set(sid, 0); this.state.currentRound += 1; this.state.matchPhase = MatchPhase.IN_PROGRESS; this.roundTicks = ROUND_TICKS; this.ptl = 0; }
    private ks(id: string, by: string) { const s = this.bld.structures.get(id); if (!s)
        return; this.bld.structures.delete(id); const c = getStructureConfig(s.buildType); if (c) {
        const cs = oc(s.grid, c, s.rotation);
        for (const k of cs)
            this.occ.delete(k);
    } if (this.pw)
        this.pw.removeStructureCollider(id); const w = this.wps.get(by)?.equippedWeaponId ?? CWO; this.broadcast(ENERGY_EVENTS.STRUCTURE_DESTROYED, { structureId: id, destroyedByPlayerId: by, destroyedByWeaponId: w }); }
    private clearStructures(): void { for (const id of this.bld.structures.keys())
        this.ks(id, ""); }
    private rp(): void { this.nextFireTick.clear(); this.clearStructures(); for (const [sid, p] of this.state.players) {
        const sp = SP[this.ss.get(sid) ?? 0];
        p.x = sp.x;
        p.y = sp.y;
        p.z = sp.z;
        p.yaw = 0;
        p.velocityY = 0;
        p.grounded = true;
        p.health = MAX_HEALTH;
        p.shield = MAX_SHIELD;
        p.energy = ENERGY.startingEnergy;
        p.alive = true;
        p.isEliminated = false;
        initW(p);
        this.wps.set(sid, cws());
        this.clients.find(c => c.sessionId === sid)?.send(WSE, tws(this.wps.get(sid)!));
    } }
    private endRound(wid: string, _lid: string, reason = "elimination"): void { if (this.state.matchPhase !== MatchPhase.IN_PROGRESS)
        return; const ws = this.state.roundScore.get(wid); if (ws !== undefined)
        ws.value += 1;
    else {
        const s = new RoundScoreSchema();
        s.value = 1;
        this.state.roundScore.set(wid, s);
    } const wins = this.state.roundScore.get(wid)?.value ?? 0; const loserScore = this.state.roundScore.get(_lid)?.value ?? 0; this.state.lastRoundResult.winnerId = wid; this.state.lastRoundResult.roundNumber = this.state.currentRound; this.inb.clear(); this.broadcast(MATCH_EVENTS.ROUND_OVER, { winnerId: wid, loserId: _lid, winnerScore: wins, loserScore: loserScore, roundNumber: this.state.currentRound, reason }); if (wins >= ROUNDS_TO_WIN) {
        this.state.matchPhase = MatchPhase.MATCH_ENDED;
        this.ptl = 0;
        this.matchEndedAt = Date.now();
        this.rematchVotes.clear();
        const scores: Record<string, number> = {};
        for (const [k, sc2] of this.state.roundScore)
            scores[k] = sc2.value;
        this.broadcast(MATCH_EVENTS.MATCH_END, { winnerId: wid, scores, reason });
        return;
    } this.state.matchPhase = MatchPhase.ROUND_ENDED; this.ptl = RT; }
    private resetMatch(): void { this.state.matchPhase = MatchPhase.COUNTDOWN; this.state.currentRound = 0; this.ptl = CT; this.roundTicks = 0; this.matchEndedAt = 0; this.rematchVotes.clear(); for (const [, r] of this.state.roundScore)
        r.value = 0; this.state.lastRoundResult.winnerId = ""; this.state.lastRoundResult.roundNumber = 0; this.rp(); this.inb.clear(); }
    private resolveTimeout(): void { const players = [...this.state.players.entries()]; if (players.length < 2)
        return; const [a, ap] = players[0], [b, bp] = players[1]; this.endRound(ap.health > bp.health || (ap.health === bp.health && a < b) ? a : b, ap.health > bp.health || (ap.health === bp.health && a < b) ? b : a, "time_expired"); }
    private rm(c: Client): void { if (this.state.matchPhase !== MatchPhase.MATCH_ENDED || Date.now() - this.matchEndedAt > REMATCH_WINDOW_SECONDS * 1000) {
        c.send(MATCH_EVENTS.REMATCH_DECLINED, { reason: "window_closed" });
        return;
    } this.rematchVotes.add(c.sessionId); if (this.rematchVotes.size === this.state.players.size && this.state.players.size === 2) {
        const previousWinner = this.state.lastRoundResult.winnerId;
        this.resetMatch();
        this.broadcast(MATCH_EVENTS.REMATCH_ACCEPTED, { previousWinnerId: previousWinner, newRoundNumber: 1 });
    } }
    private rf(sid: string, sh: PE, yaw: number, pitch: number): void { const ws = this.wps.get(sid); if (!ws)
        return; const wid = ws.equippedWeaponId, cfg = wcfg(wid); const slot = ws.slots.get(wid); if (!slot || slot.reloading || this.state.matchPhase !== MatchPhase.IN_PROGRESS || !sh.alive)
        return; if (this.tc < (this.nextFireTick.get(sid) ?? 0)) {
        this.broadcast(EVENTS.FIRE_REJECTED, { shooterId: sid, reason: "cooldown" });
        return;
    } if (slot.magazineAmmo <= 0) {
        this.broadcast(EVENTS.FIRE_REJECTED, { shooterId: sid, reason: "empty_muzzle" });
        return;
    } if (sh.isEliminated) {
        this.broadcast(EVENTS.FIRE_REJECTED, { shooterId: sid, reason: "eliminated" });
        return;
    } const seq = sh.lastProcessedSequence; const gate = fireGate({ lastFireSequence: sh.lastFireSequence, currentSequence: seq, fireIntervalTicks: cfg.fireIntervalTicks, isEliminated: sh.isEliminated, ammo: slot.magazineAmmo }); if (!gate.approved) {
        this.broadcast(EVENTS.FIRE_REJECTED, { shooterId: sid, reason: gate.reason });
        return;
    } this.nextFireTick.set(sid, this.tc + cfg.fireIntervalTicks); slot.magazineAmmo--; this.clients.find(c => c.sessionId === sid)?.send(WSE, tws(ws)); sh.ammo = slot.magazineAmmo; sh.lastFireSequence = seq; const se = sh.weapons.get(wid); if (se)
        se.magazineAmmo = slot.magazineAmmo; const o = { x: sh.x, y: sh.y + EH, z: sh.z }, d = ad(yaw, pitch), t = [], st = []; for (const [id, tp] of this.state.players) {
        if (id !== sid && !tp.isEliminated)
            t.push({ id, position: { x: tp.x, y: tp.y + EH, z: tp.z } });
    } for (const [id, s] of this.bld.structures) {
        const c = getStructureConfig(s.buildType);
        if (!c)
            continue;
        const w = wc(s.grid, c, s.rotation);
        st.push({ id, position: { x: w.ctr.x, y: w.ctr.y, z: w.ctr.z } });
    } const rays = wid === "shotgun" ? computeShotgunSpread(o, d, SHOTGUN_WEAPON.spreadDegrees * Math.PI / 180, SHOTGUN_WEAPON.pellets) : [{ origin: o, direction: d }]; const damage = wid === "shotgun" ? SHOTGUN_WEAPON.perPelletDamage : cfg.damage; for (const ray of rays) {
        if (this.state.matchPhase !== MatchPhase.IN_PROGRESS)
            break;
        const pH = hitscan(o, ray.direction, { damage, range: cfg.range, targetRadius: TR }, t)[0];
        const sH = hitscan(o, ray.direction, { damage, range: cfg.range, targetRadius: 0.5 }, st)[0];
        const hit = pH && (sH === undefined || pH.distance <= sH.distance) ? pH : sH;
        if (!hit)
            continue;
        if (this.state.players.has(hit.targetId)) {
            const tp = this.state.players.get(hit.targetId)!;
            let r = hit.damage;
            if (tp.shield > 0) {
                const a = Math.min(tp.shield, r);
                tp.shield -= a;
                r -= a;
            }
            if (r > 0)
                tp.health = Math.max(0, tp.health - r);
            this.broadcast(EVENTS.HIT, { shooterId: sid, targetId: hit.targetId, damage: hit.damage, hitPoint: hit.hitPoint, weaponId: wid });
            if (tp.health <= 0) {
                tp.health = 0;
                tp.alive = false;
                tp.isEliminated = true;
                this.broadcast(EVENTS.ELIMINATED, { eliminatedId: hit.targetId, eliminatedById: sid });
                this.endRound(sid, hit.targetId);
            }
            this.broadcast(EVENTS.HEALTH_UPDATE, { playerId: hit.targetId, health: tp.health, shield: tp.shield, alive: tp.alive, isEliminated: tp.isEliminated });
        }
        else {
            const s = this.bld.structures.get(hit.targetId);
            if (!s)
                return;
            const nd = applyStructureDamage(s.currentDurability, damage);
            s.currentDurability = nd;
            if (isStructureDestroyed(nd))
                this.ks(hit.targetId, sid);
            else
                this.broadcast(ENERGY_EVENTS.STRUCTURE_DAMAGED, { structureId: hit.targetId, damage, remainingDurability: nd, sourcePlayerId: sid, sourceWeaponId: wid });
        }
    } }
}
