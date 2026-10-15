/**
 * Two-client stress / resource acceptance for the building & editing system.
 *
 * Deterministic, bounded scenario over the canonical production path:
 *   App → GameCanvas → GameRuntime → NetworkClient → TwoPlayerMovementRoom
 *
 * Two real headless Chromium clients load the built web app. The production
 * game server runs IN THIS PROCESS (same `createServer`/`startServer` as the
 * shipped entry point) so the harness can audit the live authoritative room:
 * structures, occupied cells, Rapier colliders, the collision-cuboid
 * registry, input queues, ownership maps and tick timing. Server code is not
 * modified — only observed through prototype wrappers installed before the
 * room is created.
 *
 * Not part of `pnpm test:browser` (file name does not match
 * `*.browser.test.ts`). Requires `pnpm build`. Run from apps/game-server:
 *
 *   node_modules/.bin/tsx ../web/tests/stress/twoClientStress.ts [reportPath]
 *
 * Exit code 0 = every acceptance check passed.
 */
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import {
  ARENA_COLLIDERS, BUILD_GRID, BUILD_BOUNDS, BUILD_RANGE, VERTICAL_MOVEMENT,
  PLAYER_CROUCH_COLLIDER_HALF_TOTAL_HEIGHT, getStructureConfig, structureCuboids, structureSlots, wallEdgeCenter, type GeometryEditState,
} from "@buildshift/game-config";
import { createServer, startServer, shutdownServer } from "../../../game-server/src/server.ts";
import { TwoPlayerMovementRoom } from "../../../game-server/src/rooms/TwoPlayerMovementRoom.ts";
import { PlayerInputQueue, INPUT_QUEUE_LIMIT } from "../../../game-server/src/rooms/lifecycle/playerInputQueue.ts";
import { oc } from "../../../game-server/src/state/buildingState.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../../..");
const WEB_DIST = path.join(ROOT, "apps/web/dist");
const GAME_PORT = Number(process.env.BS_STRESS_GAME_PORT ?? 25691);
const STATIC_PORT = Number(process.env.BS_STRESS_STATIC_PORT ?? 41791);
const APP_URL = `http://127.0.0.1:${STATIC_PORT}/?devdiag=1&gameServer=ws://127.0.0.1:${GAME_PORT}`;
const REPORT_PATH = process.argv[2] ?? path.join(ROOT, "test-results", "stress-report.json");
const LOOK = 0.0022; // THIRD_PERSON_CAMERA.mouseSensitivity (rad/px)
const CS = BUILD_GRID.cellSize, LH = BUILD_GRID.layerHeight;
const EYE = VERTICAL_MOVEMENT.playerHalfHeight;

const t0 = performance.now();
const ts = () => ((performance.now() - t0) / 1000).toFixed(1).padStart(6);
let phaseLabel = "setup";
const log = (msg: string) => console.log(`[stress ${ts()}s] [${phaseLabel}] ${msg}`);
const failures: string[] = [];
const fail = (msg: string) => { failures.push(`[${phaseLabel}] ${msg}`); log(`FAIL ${msg}`); };
const check = (ok: boolean, msg: string) => { if (!ok) fail(msg); return ok; };

// ─── Server instrumentation (observation only) ───────────────────────────────

type AnyRoom = any;
const rooms: AnyRoom[] = [];
const tickDur: number[] = [];
const tickGap: number[] = [];
let lastTickStart = 0;
const lastLook = new Map<string, { yaw: number; pitch: number; seq: number }>();
type PlacementRecord = { sid: string; seq: number; buildType: string; grid?: unknown; rotation?: unknown; accepted: boolean; reason: string | null; e0: number; e1: number; tick: number; phase: string };
const placements: PlacementRecord[] = [];
type EditRecord = { sid: string; structureId: string; action: string; ok: boolean; reason: string | null; phase: string };
const edits: EditRecord[] = [];
const destroyed: { id: string; by: string; buildType: string; phase: string }[] = [];
const leaves: { sid: string; code: unknown; phase: string }[] = [];
const queueStats = { maxDepth: 0, overflow: 0, stale: 0, outOfOrder: 0, enqueued: 0 };
const roundEvents: { kind: string; tick: number; at: number }[] = [];

const P = TwoPlayerMovementRoom.prototype as any;
const wrap = (name: string, make: (orig: (...a: any[]) => any) => (this: AnyRoom, ...a: any[]) => any) => {
  const orig = P[name];
  if (typeof orig !== "function") throw new Error(`room method ${name} not found`);
  P[name] = make(orig);
};
wrap("onCreate", orig => function (...a) { rooms.push(this); return orig.apply(this, a); });
wrap("tick", orig => function (...a) {
  const s = performance.now();
  if (lastTickStart) tickGap.push(s - lastTickStart);
  lastTickStart = s;
  const r = orig.apply(this, a);
  tickDur.push(performance.now() - s);
  return r;
});
wrap("si", orig => function (sid: string, p: any, buf: any) {
  lastLook.set(sid, { yaw: buf.lookYaw, pitch: buf.lookPitch, seq: buf.sequence });
  return orig.call(this, sid, p, buf);
});
wrap("hpr", orig => function (c: any, msg: any) {
  const p = this.state.players.get(c.sessionId);
  const e0 = p?.energy ?? NaN, n0 = this.bld.structures.size;
  let reason: string | null = null;
  const send = c.send;
  c.send = (type: string, data: any) => { if (type === "build:structure_rejected") reason = data?.reason ?? "?"; return send.call(c, type, data); };
  let r;
  try { r = orig.call(this, c, msg); } finally { c.send = send; }
  // Every rejection path and the Energy charge run synchronously, before
  // the handler's first await.
  const accepted = this.bld.structures.size === n0 + 1;
  placements.push({ sid: c.sessionId, seq: msg?.sequence, buildType: msg?.buildType, grid: msg?.grid, rotation: msg?.rotation, accepted, reason, e0, e1: p?.energy ?? NaN, tick: this.tc, phase: phaseLabel });
  return r;
});
wrap("hega", orig => function (c: any, msg: any) {
  let reason: string | null = null;
  const send = c.send;
  c.send = (type: string, data: any) => { if (type === "two-player:edit_grid_action" && data?.success === false) reason = data.reason ?? "?"; return send.call(c, type, data); };
  let r;
  try { r = orig.call(this, c, msg); } finally { c.send = send; }
  edits.push({ sid: c.sessionId, structureId: msg?.structureId, action: msg?.action, ok: reason === null, reason, phase: phaseLabel });
  return r;
});
wrap("ks", orig => function (id: string, by: string) {
  const s = this.bld.structures.get(id);
  if (s && by) destroyed.push({ id, by, buildType: s.buildType, phase: phaseLabel });
  return orig.call(this, id, by);
});
wrap("onLeave", orig => function (c: any, code: unknown) { leaves.push({ sid: c.sessionId, code, phase: phaseLabel }); return orig.call(this, c, code); });
wrap("br", orig => function (...a) { roundEvents.push({ kind: "round_start", tick: this.tc, at: performance.now() }); return orig.apply(this, a); });
wrap("bc", orig => function (...a) { roundEvents.push({ kind: "round_reset", tick: this.tc, at: performance.now() }); return orig.apply(this, a); });
wrap("resetMatch", orig => function (...a) { roundEvents.push({ kind: "match_reset", tick: this.tc, at: performance.now() }); return orig.apply(this, a); });
{
  const Q = PlayerInputQueue.prototype as any;
  const enqueue = Q.enqueue;
  Q.enqueue = function (input: unknown, last: number) {
    const r = enqueue.call(this, input, last);
    queueStats.enqueued++;
    if (r === "overflow") queueStats.overflow++;
    if (r === "stale") queueStats.stale++;
    if (r === "out_of_order") queueStats.outOfOrder++;
    if (this.size > queueStats.maxDepth) queueStats.maxDepth = this.size;
    return r;
  };
}

// ─── Server audit ─────────────────────────────────────────────────────────────

function editGeometryState(s: any): GeometryEditState | undefined {
  if (s.editKind === "wall" && s.editTiles.length === 9) return { kind: "wall", tiles: [...s.editTiles] };
  if (s.editKind === "floor_cone" && s.editTiles.length === 4) return { kind: "floor_cone", tiles: [...s.editTiles] };
  if (s.editKind === "ramp" && s.editRampVariant) return { kind: "ramp", variant: s.editRampVariant };
  return undefined;
}
const geometryOf = (s: any) => structureCuboids({ buildType: s.buildType, grid: { x: s.grid.x, y: s.grid.y, z: s.grid.z }, rotation: s.rotation, editGrid: editGeometryState(s) });

type ServerAudit = {
  phase: string; structures: number; occupied: number; colliders: number; bodies: number; structureBodies: number;
  registryCuboids: number; expectedColliders: number; queueDepths: number[]; violations: string[];
};
function auditServer(room: AnyRoom): ServerAudit {
  const violations: string[] = [];
  const players = new Set<string>([...room.state.players.keys()]);
  const expectedOcc = new Map<string, string>();
  let cuboidTotal = 0;
  for (const [key, s] of room.bld.structures) {
    if (key !== s.structureId) violations.push(`structure key ${key} != id ${s.structureId}`);
    if (!players.has(s.ownerId)) violations.push(`structure ${key} owned by absent player ${s.ownerId}`);
    const cfg = getStructureConfig(s.buildType);
    if (!cfg) { violations.push(`structure ${key} unknown type ${s.buildType}`); continue; }
    for (const cell of oc(s.grid, cfg, s.rotation)) {
      const prev = expectedOcc.get(cell);
      if (prev) violations.push(`slot ${cell} occupied by both ${prev} and ${key}`);
      expectedOcc.set(cell, key);
    }
    const want = geometryOf(s);
    cuboidTotal += want.length;
    const have = room.pw?.structureCuboids.get(key);
    if (!have) violations.push(`structure ${key} has no collision cuboids`);
    else {
      const sameBox = (a: any, b: any) => ["x", "y", "z"].every(k => Math.abs(a.center[k] - b.center[k]) < 1e-6 && Math.abs(a.halfExtents[k] - b.halfExtents[k]) < 1e-6);
      if (have.length !== want.length || !want.every((w: any) => have.some((h: any) => sameBox(w, h))))
        violations.push(`structure ${key} collision cuboids (${have.length}) != canonical edit geometry (${want.length})`);
      const n = room.pw.structureColliderCount(key);
      if (n !== want.length) violations.push(`structure ${key} Rapier colliders ${n} != ${want.length}`);
    }
  }
  const occ: Set<string> = room.occ;
  for (const cell of occ) if (!expectedOcc.has(cell)) violations.push(`stale occupied slot ${cell}`);
  for (const cell of expectedOcc.keys()) if (!occ.has(cell)) violations.push(`missing occupied slot ${cell}`);
  const pw = room.pw;
  const registryIds: string[] = pw ? [...pw.structureCuboids.keys()] : [];
  const bodyIds: string[] = pw ? [...pw.structures.keys()] : [];
  for (const id of new Set([...registryIds, ...bodyIds])) if (!room.bld.structures.has(id)) violations.push(`stale collider for removed structure ${id}`);
  const playerBodies = pw ? pw.players.size : 0;
  const colliders = pw ? pw.world.colliders.len() : 0;
  const bodies = pw ? pw.world.bodies.len() : 0;
  const expectedColliders = ARENA_COLLIDERS.length + playerBodies + cuboidTotal;
  if (pw && colliders !== expectedColliders) violations.push(`Rapier collider count ${colliders} != arena ${ARENA_COLLIDERS.length} + players ${playerBodies} + structure cuboids ${cuboidTotal}`);
  if (pw && bodies !== ARENA_COLLIDERS.length + playerBodies + bodyIds.length) violations.push(`Rapier body count ${bodies} != expected ${ARENA_COLLIDERS.length + playerBodies + bodyIds.length}`);
  for (const [name, map] of [["lpt", room.lpt], ["inq", room.inq], ["wps", room.wps], ["nextFireTick", room.nextFireTick], ["inactiveTicks", room.inactiveTicks]] as const)
    for (const sid of (map as Map<string, unknown>).keys()) if (!players.has(sid)) violations.push(`stale ${name} entry for ${sid}`);
  const queueDepths = [...(room.inq as Map<string, any>).values()].map(q => q.size);
  for (const d of queueDepths) if (d > INPUT_QUEUE_LIMIT) violations.push(`input queue depth ${d} > ${INPUT_QUEUE_LIMIT}`);
  return { phase: room.state.matchPhase, structures: room.bld.structures.size, occupied: occ.size, colliders, bodies, structureBodies: bodyIds.length, registryCuboids: registryIds.reduce((n, id) => n + pw.structureCuboids.get(id).length, 0), expectedColliders, queueDepths, violations };
}

/** Plain authoritative structure snapshot, as each client must parse it. */
function serverStructures(room: AnyRoom) {
  const out: Record<string, { ownerId: string; buildType: string; grid: { x: number; y: number; z: number }; rotation: number; edit: string; dur: number; parts: number }> = {};
  for (const [key, s] of room.bld.structures) {
    const e = editGeometryState(s);
    out[key] = { ownerId: s.ownerId, buildType: s.buildType, grid: { x: s.grid.x, y: s.grid.y, z: s.grid.z }, rotation: s.rotation, edit: e ? (e.kind === "ramp" ? `ramp:${e.variant}` : `${e.kind}:${e.tiles.map(t => (t ? 1 : 0)).join("")}`) : "", dur: s.currentDurability, parts: geometryOf(s).length };
  }
  return out;
}

// Continuous server sampler: peaks, invariant violations, input-freeze gaps.
const peaks = { structures: 0, occupied: 0, colliders: 0, bodies: 0, queueDepth: 0 };
const violationLog: string[] = [];
const seqProgress = new Map<string, { seq: number; at: number }>();
const maxInputGapMs = new Map<string, number>();
const seqRegressions: string[] = [];
let sampler: NodeJS.Timeout | null = null;
function startSampler() {
  let n = 0;
  sampler = setInterval(() => {
    const room = rooms[rooms.length - 1];
    if (!room || !room.pw) return;
    n++;
    const a = auditServer(room);
    peaks.structures = Math.max(peaks.structures, a.structures);
    peaks.occupied = Math.max(peaks.occupied, a.occupied);
    peaks.colliders = Math.max(peaks.colliders, a.colliders);
    peaks.bodies = Math.max(peaks.bodies, a.bodies);
    peaks.queueDepth = Math.max(peaks.queueDepth, ...a.queueDepths, 0);
    for (const v of a.violations) {
      const line = `${phaseLabel}: ${v}`;
      if (!violationLog.includes(line)) { violationLog.push(line); log(`VIOLATION ${v}`); }
    }
    const now = performance.now();
    for (const [sid, p] of room.state.players) {
      const prev = seqProgress.get(sid);
      if (prev && p.lastProcessedSequence < prev.seq) seqRegressions.push(`${phaseLabel}: ${sid} ${prev.seq} -> ${p.lastProcessedSequence}`);
      if (!prev || p.lastProcessedSequence !== prev.seq || room.state.matchPhase !== "IN_PROGRESS") {
        seqProgress.set(sid, { seq: p.lastProcessedSequence, at: now });
      } else if (room.state.matchPhase === "IN_PROGRESS") {
        maxInputGapMs.set(sid, Math.max(maxInputGapMs.get(sid) ?? 0, now - prev.at));
      }
    }
  }, 50);
}

// ─── Static server ────────────────────────────────────────────────────────────

function startStatic(): Promise<http.Server> {
  const MIME: Record<string, string> = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const server = http.createServer((req, res) => {
    const urlPath = (req.url ?? "/").split("?")[0] || "/";
    const file = path.join(WEB_DIST, urlPath === "/" ? "index.html" : urlPath);
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(body);
    } catch { res.writeHead(404); res.end("Not found"); }
  });
  return new Promise(resolve => server.listen(STATIC_PORT, "127.0.0.1", () => resolve(server)));
}

// ─── Client instrumentation ───────────────────────────────────────────────────

type Player = { name: "A" | "B"; page: Page; cdp: CDPSession; sid: string; sign: 1 | -1 };

async function installClientProbe(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    const engine = w.__buildshiftEngine, scene = engine.scenes[0];
    const S = w.__stress = { frameMs: [] as number[], renderMs: [] as number[], draws: [] as number[], intervals: [] as number[], seqRegressions: [] as string[], leaves: [] as unknown[], rejections: [] as unknown[], corr: [] as number[], probeObservers: 3 };
    let fb = 0, last = 0;
    engine.onBeginFrameObservable.add(() => { fb = performance.now(); if (last) S.intervals.push(fb - last); last = fb; });
    engine.onEndFrameObservable.add(() => { S.frameMs.push(performance.now() - fb); });
    scene.onBeforeRenderObservable.add(() => {
      const dc = engine._drawCalls;
      if (dc) { S.draws.push(dc.current); dc.fetchNewFrame(); }
    });
    const client = w.__buildshiftNetworking.client.deref();
    let lastSeq = -1;
    client.room.onStateChange((state: any) => {
      const p = state.players.get(client.sessionId);
      if (!p) return;
      if (p.lastProcessedSequence < lastSeq) S.seqRegressions.push(`${lastSeq}->${p.lastProcessedSequence}`);
      lastSeq = p.lastProcessedSequence;
    });
    client.room.onLeave((code: unknown) => S.leaves.push(code));
    client.onEvent("build:structure_rejected", (p: unknown) => S.rejections.push(p));
    setInterval(() => {
      const m = (document.querySelector(".devdiag-overlay")?.textContent ?? "").match(/Corr:\s*(\d+\.\d+)/);
      if (m) S.corr.push(Number(m[1]));
    }, 250);
  });
}

type ClientWindow = { frameMsMed: number; frameMsP95: number; intervalMed: number; intervalP95: number; drawsMed: number; drawsMax: number; frames: number; corrMax: number };
const pct = (xs: number[], q: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]!; };
async function drainClientWindow(page: Page): Promise<ClientWindow> {
  const d = await page.evaluate(() => { const S = (window as any).__stress; const out = { frameMs: S.frameMs, intervals: S.intervals, draws: S.draws, corr: S.corr }; S.frameMs = []; S.intervals = []; S.draws = []; S.corr = []; return out; });
  return { frameMsMed: pct(d.frameMs, 0.5), frameMsP95: pct(d.frameMs, 0.95), intervalMed: pct(d.intervals, 0.5), intervalP95: pct(d.intervals, 0.95), drawsMed: pct(d.draws, 0.5), drawsMax: d.draws.length ? Math.max(...d.draws) : NaN, frames: d.frameMs.length, corrMax: d.corr.length ? Math.max(...d.corr) : 0 };
}

type ClientResources = {
  meshes: number; enabledMeshes: number; activeMeshes: number; materials: number; textures: number; geometries: number; transformNodes: number;
  buildSolids: number; structureRoots: number; renderedStructures: number; observers: number; groups: Record<string, number>; heapMB: number; listeners: number;
};
async function clientResources(p: Player, gc: boolean): Promise<ClientResources> {
  const r = await p.page.evaluate(() => {
    const w = window as any;
    const engine = w.__buildshiftEngine, scene = engine.scenes[0];
    const groups: Record<string, number> = {};
    const ids = new Set<string>();
    let buildSolids = 0, structureRoots = 0;
    for (const m of scene.meshes) {
      const n: string = m.name;
      const sm = n.match(/^build-solid-(.+)-\d+$/);
      if (sm) { buildSolids++; ids.add(sm[1]!); }
      if (/^structure-/.test(n)) structureRoots++;
      const g = n.replace(/^build-solid-.+$/, "build-solid-*").replace(/^structure-.+$/, "structure-*").replace(/\d+/g, "#");
      groups[g] = (groups[g] ?? 0) + 1;
    }
    let observers = 0;
    for (const host of [scene, engine]) for (const k of Object.keys(host)) {
      const v = host[k];
      if (v && typeof v === "object" && Array.isArray(v._observers)) observers += v._observers.length;
      else if (v && typeof v === "object" && Array.isArray(v.observers)) observers += v.observers.length;
    }
    return { meshes: scene.meshes.length, enabledMeshes: scene.meshes.filter((m: any) => m.isEnabled()).length, activeMeshes: scene.getActiveMeshes().length, materials: scene.materials.length, textures: scene.textures.length, geometries: scene.geometries.length, transformNodes: scene.transformNodes.length, buildSolids, structureRoots, renderedStructures: ids.size, observers: observers - w.__stress.probeObservers, groups };
  });
  if (gc) await p.cdp.send("HeapProfiler.collectGarbage");
  const heap = await p.cdp.send("Runtime.getHeapUsage");
  let listeners = 0;
  for (const expr of ["window", "document", "document.querySelector('canvas.game-canvas')"]) {
    const { result } = await p.cdp.send("Runtime.evaluate", { expression: expr });
    if (result.objectId) listeners += (await p.cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId })).listeners.length;
  }
  return { ...r, heapMB: Math.round((heap.usedSize / 1048576) * 10) / 10, listeners };
}

// ─── Client actions (production NetworkClient / real input) ───────────────────

let placementSeq = 20_000;
const send = (p: Player, type: string, payload: unknown) =>
  p.page.evaluate(({ type, payload }) => (window as any).__buildshiftNetworking.client.deref().send(type, payload), { type, payload });

async function waitUntil<T>(fn: () => T | undefined | false, timeoutMs: number, label: string): Promise<T> {
  const end = performance.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (performance.now() > end) throw new Error(`timeout: ${label}`);
    await sleep(10);
  }
}

/** Request a placement; resolves with the authoritative outcome. */
async function place(room: AnyRoom, p: Player, buildType: string, grid: { x: number; y: number; z: number }, rotation: number): Promise<{ accepted: boolean; reason: string | null; id?: string }> {
  const seq = ++placementSeq;
  await send(p, "build:placement_request", { sequence: seq, buildType, grid, rotation });
  const rec = await waitUntil(() => placements.find(r => r.sid === p.sid && r.seq === seq), 5_000, `placement ${seq} outcome`);
  if (!rec.accepted) return { accepted: false, reason: rec.reason };
  const id = await waitUntil(() => { for (const [k, s] of room.bld.structures) if (s.ownerId === p.sid && s.createdSequence === seq) return k as string; return undefined; }, 2_000, `placement ${seq} structure`).catch(() => undefined);
  return { accepted: true, reason: null, id };
}

async function edit(p: Player, structureId: string, action: Record<string, unknown>): Promise<EditRecord> {
  const n = edits.length;
  await send(p, "two-player:edit_grid_action", { structureId, ...action });
  return waitUntil(() => edits.slice(n).find(e => e.sid === p.sid && e.structureId === structureId), 5_000, `edit ${structureId} ${JSON.stringify(action)}`);
}

const look = (p: Player, dx: number, dy: number) => p.page.evaluate(({ dx, dy }) => {
  document.dispatchEvent(new MouseEvent("mousemove", { movementX: dx, movementY: dy, bubbles: true }));
}, { dx, dy });
const normAngle = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** Turn the real camera (mouse deltas) to an absolute yaw/pitch, verified on the server. */
let liveRoom: AnyRoom = null;
async function setLook(p: Player, yaw: number, pitch: number) {
  for (let i = 0; i < 4; i++) {
    const before = lastLook.get(p.sid)?.seq ?? -1;
    // Inputs are only simulated in a live round; stop quietly once it ends.
    const ok = await waitUntil(() => (lastLook.get(p.sid)?.seq ?? -1) > before || (liveRoom && liveRoom.state.matchPhase !== "IN_PROGRESS" ? "ended" : undefined), 3_000, `${p.name} input after look`);
    if (ok === "ended") return;
    const cur = lastLook.get(p.sid)!;
    const dx = Math.round(normAngle(cur.yaw - yaw) / LOOK), dy = Math.round((cur.pitch - pitch) / LOOK);
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) return;
    await look(p, dx, dy);
    await sleep(120);
  }
  const cur = lastLook.get(p.sid);
  log(`WARN ${p.name} setLook(${yaw.toFixed(3)}, ${pitch.toFixed(3)}) ended at (${cur?.yaw.toFixed(3)}, ${cur?.pitch.toFixed(3)})`);
}
async function aimAt(room: AnyRoom, p: Player, target: { x: number; y: number; z: number }) {
  const s = room.state.players.get(p.sid);
  const eye = s.y + (s.crouch ? PLAYER_CROUCH_COLLIDER_HALF_TOTAL_HEIGHT : EYE);
  const dx = target.x - s.x, dy = target.y - eye, dz = target.z - s.z;
  await setLook(p, Math.atan2(dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
}
const mouse = (p: Player, down: boolean) => p.page.evaluate((down) => {
  const el = (document.pointerLockElement ?? document.querySelector("canvas.game-canvas")) as HTMLElement | null;
  el?.dispatchEvent(new MouseEvent(down ? "mousedown" : "mouseup", { button: 0, bubbles: true }));
}, down);
const buildModeOn = (p: Player) => p.page.evaluate(() => /Build:\s*on/i.test(document.querySelector(".devdiag-overlay")?.textContent ?? ""));
const editModeOn = (p: Player) => p.page.evaluate(() => document.querySelector(".build-edit-hud__title") !== null);
/** Leave the edit layer (G toggles it) and the build layer (legacy B toggle). */
async function combatMode(p: Player) {
  for (let i = 0; i < 3 && await editModeOn(p); i++) { await p.page.keyboard.press("KeyG"); await sleep(200); }
  if (await editModeOn(p)) fail(`${p.name} could not leave the edit layer`);
  if (await buildModeOn(p)) { await p.page.keyboard.press("KeyB"); await sleep(250); }
  if (await buildModeOn(p)) fail(`${p.name} could not leave build mode`);
}
async function equip(room: AnyRoom, p: Player, weapon: "assault_rifle" | "shotgun") {
  await combatMode(p);
  await p.page.keyboard.press(weapon === "assault_rifle" ? "Digit1" : "Digit2");
  await waitUntil(() => room.wps.get(p.sid)?.equippedWeaponId === weapon, 3_000, `${p.name} equip ${weapon}`);
}

/** Hold a movement key until the client's predicted pose satisfies `predicate`. */
async function holdUntil(room: AnyRoom, p: Player, key: string, predicate: string, arg: Record<string, unknown>, opts: { crouch?: boolean; jumpEveryMs?: number; timeout?: number } = {}) {
  if (opts.crouch) await p.page.keyboard.down("KeyC");
  await p.page.keyboard.down(key);
  let jumping = true;
  const jumper = (async () => {
    while (opts.jumpEveryMs && jumping) { await sleep(opts.jumpEveryMs); if (jumping) await p.page.keyboard.press("Space").catch(() => {}); }
  })();
  try {
    await p.page.waitForFunction(({ predicate, arg }) => {
      const m = (document.querySelector(".devdiag-overlay")?.textContent ?? "").match(/Pred:\s*\(\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\)/);
      if (!m) return false;
      const p = { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
      return new Function("p", "arg", `return ${predicate};`)(p, arg) as boolean;
    }, { predicate, arg }, { timeout: opts.timeout ?? 40_000, polling: 30 });
  } catch (e) {
    const auth = room.state.players.get(p.sid);
    const diag = await p.page.evaluate(() => (document.querySelector(".devdiag-overlay")?.textContent ?? "").slice(0, 400)).catch(() => "");
    throw new Error(`${p.name} hold ${key} until ${predicate}: auth (${auth.x.toFixed(2)}, ${auth.y.toFixed(2)}, ${auth.z.toFixed(2)}) seq ${auth.lastProcessedSequence}; diag ${diag}`, { cause: e });
  } finally {
    jumping = false;
    await jumper;
    await p.page.keyboard.up(key);
    if (opts.crouch) await p.page.keyboard.up("KeyC");
  }
}

/** Max authoritative height reached by a player while `fn` runs. */
async function trackMaxY(room: AnyRoom, p: Player, fn: () => Promise<void>) {
  let maxY = -Infinity, minY = Infinity, run = true;
  const t = (async () => { while (run) { const s = room.state.players.get(p.sid); if (s) { maxY = Math.max(maxY, s.y); minY = Math.min(minY, s.y); } await sleep(15); } })();
  try { await fn(); } finally { run = false; await t; }
  return { maxY, minY };
}

async function settle(room: AnyRoom, p: Player, n = 10) {
  const s0 = room.state.players.get(p.sid).lastProcessedSequence;
  await waitUntil(() => room.state.players.get(p.sid).lastProcessedSequence >= s0 + n, 10_000, `${p.name} settle`);
}

// ─── Convergence ──────────────────────────────────────────────────────────────

async function converge(room: AnyRoom, players: Player[], label: string) {
  const deadline = performance.now() + 8_000;
  let last: unknown = null;
  for (;;) {
    const want = serverStructures(room);
    const results = await Promise.all(players.map(p => p.page.evaluate((want) => {
      const w = window as any;
      const client = w.__buildshiftNetworking.client.deref();
      const have = client.state.building.structures as Record<string, any>;
      const durability = (client.state.structureDurabilities ?? {}) as Record<string, any>;
      const scene = w.__buildshiftEngine.scenes[0];
      const solids = new Map<string, number>();
      for (const m of scene.meshes) { const sm = (m.name as string).match(/^build-solid-(.+)-\d+$/); if (sm) solids.set(sm[1]!, (solids.get(sm[1]!) ?? 0) + 1); }
      const diffs: string[] = [];
      for (const [id, e] of Object.entries(want) as [string, any][]) {
        const s = have[id];
        if (!s) { diffs.push(`missing ${id}`); continue; }
        const eg = s.editGrid;
        const edit = eg ? (eg.kind === "ramp" ? `ramp:${eg.variant}` : `${eg.kind}:${eg.tiles.map((t: boolean) => (t ? 1 : 0)).join("")}`) : "";
        if (s.ownerId !== e.ownerId) diffs.push(`${id} owner ${s.ownerId} != ${e.ownerId}`);
        if (s.buildType !== e.buildType || s.rotation !== e.rotation || s.grid.x !== e.grid.x || s.grid.y !== e.grid.y || s.grid.z !== e.grid.z) diffs.push(`${id} placement differs`);
        if (edit !== e.edit) diffs.push(`${id} edit ${edit} != ${e.edit}`);
        if (durability[id]?.currentDurability !== e.dur) diffs.push(`${id} durability ${durability[id]?.currentDurability} != ${e.dur}`);
        if ((solids.get(id) ?? 0) !== e.parts) diffs.push(`${id} rendered solids ${solids.get(id) ?? 0} != ${e.parts}`);
      }
      for (const id of Object.keys(have)) if (!(id in want)) diffs.push(`ghost state ${id}`);
      for (const id of solids.keys()) if (!(id in want)) diffs.push(`ghost mesh ${id}`);
      return diffs;
    }, want)));
    if (results.every(d => d.length === 0)) return Object.keys(want).length;
    last = results;
    if (performance.now() > deadline) { fail(`${label}: clients did not converge: ${JSON.stringify(last).slice(0, 600)}`); return -1; }
    await sleep(150);
  }
}

// ─── Scenario ─────────────────────────────────────────────────────────────────

type Grid = { x: number; y: number; z: number };
const anchor = (g: Grid) => ({ x: g.x * CS, y: g.y * LH, z: g.z * CS });
const inRange = (room: AnyRoom, p: Player, g: Grid, margin = 0.6) => {
  const s = room.state.players.get(p.sid), a = anchor(g);
  return Math.hypot(s.x - a.x, s.y - a.y, s.z - a.z) <= BUILD_RANGE.maxPlacementDistance - margin;
};
/**
 * The tiles ("x,y,z") a piece physically touches: its own tile, plus — for a
 * wall, which stands on a tile edge — the neighbouring tile across that edge.
 * Used for the harness's reserved lanes (occupancy itself is per slot).
 */
function tilesOf(buildType: string, g: Grid, rotation: number): string[] {
  const own = `${g.x},${g.y},${g.z}`;
  if (buildType !== "wall") return [own];
  const [dx, dz] = ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const)[rotation & 3]!;
  return [own, `${g.x + dx},${g.y},${g.z + dz}`];
}
function freeFor(room: AnyRoom, buildType: string, g: Grid, rotation: number) {
  if (g.x < BUILD_BOUNDS.minX || g.x > BUILD_BOUNDS.maxX || g.z < BUILD_BOUNDS.minZ || g.z > BUILD_BOUNDS.maxZ || g.y < BUILD_BOUNDS.minLayer || g.y > BUILD_BOUNDS.maxLayer) return false;
  return structureSlots(buildType, g, rotation).every(slot => !room.occ.has(slot));
}
const cellOf = (x: number, z: number) => ({ x: Math.round(x / CS), z: Math.round(z / CS) });

const counters = { accepted: 0, rejected: 0, editCycles: 0, realInputEdits: 0, destructionCycles: 0, contestedAttempts: 0, contestedResolved: 0, editShotgunReset: 0, turboPlacements: 0, roundsCompleted: 0, rematches: 0 };

/** Ground-row cells between the two players (kept clear for the kill line). */
function corridor(room: AnyRoom, A: Player, B: Player) {
  const a = room.state.players.get(A.sid), b = room.state.players.get(B.sid);
  const cells = new Set<string>();
  for (let i = 0; i <= 20; i++) { const t = i / 20; const c = cellOf(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t); for (const dz of [-1, 0, 1]) cells.add(`${c.x},0,${c.z + dz}`); }
  return cells;
}

/**
 * Movement: cross the cone (W), then come back over it (crouched S) straight
 * onto a one-tile ramp that reaches a next-layer floor, continue onto an
 * adjacent air floor, walk off its far edge (drop), and step back under it.
 */
async function movementPhase(room: AnyRoom, p: Player) {
  const s = p.sign;
  const lanePieces: [string, Grid, number][] = [["cone", { x: s, y: 0, z: -1 }, 0], ["ramp", { x: s, y: 0, z: 0 }, 1], ["floor", { x: s, y: 1, z: 1 }, 0], ["floor", { x: s, y: 1, z: 2 }, 0]];
  for (const [type, g, rot] of lanePieces) {
    for (const slot of structureSlots(type, g, rot)) {
      if (!room.occ.has(slot)) continue;
      const owner = [...room.bld.structures.values()].find((st: any) => [...oc(st.grid, getStructureConfig(st.buildType)!, st.rotation)].includes(slot));
      fail(`${p.name} movement lane slot ${slot} already occupied by ${owner?.buildType} ${owner?.structureId} @${JSON.stringify(owner?.grid)} r${owner?.rotation}`);
    }
  }
  await setLook(p, 0, 0);
  const lane: number[] = [];
  const x = () => lane.push(Math.round(room.state.players.get(p.sid).x * 100) / 100);
  x();
  const cone = await place(room, p, "cone", { x: s, y: 0, z: -1 }, 0);
  check(cone.accepted, `${p.name} movement cone placement rejected (${cone.reason})`);
  let ramp: { accepted: boolean; reason: string | null } = { accepted: false, reason: "not placed" };
  const over = await trackMaxY(room, p, async () => {
    // Onto the cone's first steps (clear of the ramp tile), then place the
    // one-tile ramp (rotation 1 rises toward +Z) on the tile after the cone.
    await holdUntil(room, p, "KeyW", "p.z <= -3.0", {});
    ramp = await place(room, p, "ramp", { x: s, y: 0, z: 0 }, 1);
    await holdUntil(room, p, "KeyW", "p.z <= -10.4", {}, { jumpEveryMs: 900 });
  });
  check(ramp.accepted, `${p.name} ramp placement rejected (${ramp.reason})`);
  x();
  check(over.maxY >= 3.5, `${p.name} cone crossing peak ${over.maxY.toFixed(2)} < 3.5`);
  await settle(room, p);
  const back = await trackMaxY(room, p, () => holdUntil(room, p, "KeyS", "p.z >= 0.5", {}, { crouch: true }));
  x();
  check(back.maxY >= 3.5, `${p.name} crouched cone return peak ${back.maxY.toFixed(2)} < 3.5`);
  await settle(room, p);
  // The floor at the ramp's top (the next tile, next layer), then an adjacent air floor.
  for (const z of [1, 2]) {
    const floor = await place(room, p, "floor", { x: s, y: 1, z }, 0);
    check(floor.accepted, `${p.name} next-layer floor (z ${z}) placement rejected (${floor.reason})`);
    await sleep(340);
  }
  const climb = await trackMaxY(room, p, () => holdUntil(room, p, "KeyS", "p.z >= 10.3", {}));
  await settle(room, p);
  const top = { y: room.state.players.get(p.sid).y as number };
  check(Math.abs(top.y - (LH + 0.15)) < 1e-3, `${p.name} ramp did not reach the next-layer floor (y=${top.y.toFixed(3)}, max ${climb.maxY.toFixed(2)})`);
  await holdUntil(room, p, "KeyS", "p.z >= 13.3", {});
  await waitUntil(() => room.state.players.get(p.sid).y === 0, 5_000, `${p.name} drop off the floor`);
  await settle(room, p);
  x();
  return { lane, conePeak: over.maxY, conePeakBack: back.maxY, floorY: top.y };
}

/** Step back under the next-layer floor (crouched W). */
async function movementFinish(room: AnyRoom, p: Player) {
  await setLook(p, 0, 0);
  await holdUntil(room, p, "KeyW", "p.z <= 10.4", {}, { crouch: true });
  await settle(room, p);
}

/** Rapid placement burst + edit/reset cycles on own pieces. */
async function buildBurst(room: AnyRoom, p: Player, reserved: Set<string>, target: number, editCycles: number) {
  const plan: { type: string; rot: number }[] = [
    { type: "wall", rot: 0 }, { type: "floor", rot: 0 }, { type: "wall", rot: 1 }, { type: "cone", rot: 0 },
    { type: "ramp", rot: 0 }, { type: "wall", rot: 2 }, { type: "floor", rot: 0 }, { type: "wall", rot: 3 },
    { type: "ramp", rot: 3 }, { type: "cone", rot: 0 }, { type: "ramp", rot: 1 }, { type: "wall", rot: 0 },
  ];
  const mine: { id: string; type: string }[] = [];
  const me = room.state.players.get(p.sid);
  const candidates: Grid[] = [];
  for (let y = 0; y <= 2; y++) for (let x = BUILD_BOUNDS.minX; x <= BUILD_BOUNDS.maxX; x++) for (let z = BUILD_BOUNDS.minZ; z <= BUILD_BOUNDS.maxZ; z++) candidates.push({ x, y, z });
  const own = cellOf(me.x, me.z);
  candidates.sort((a, b) => Math.hypot(a.x * CS - me.x, a.y * LH - me.y, a.z * CS - me.z) - Math.hypot(b.x * CS - me.x, b.y * LH - me.y, b.z * CS - me.z));
  let i = 0;
  for (const item of plan.concat(plan)) {
    if (mine.length >= target) break;
    const g = candidates.find(g => {
      if (!inRange(room, p, g) || !freeFor(room, item.type, g, item.rot)) return false;
      const cells = tilesOf(item.type, g, item.rot);
      if (cells.some(c => reserved.has(c))) return false;
      if (g.y === 0 && cells.some(c => c === `${own.x},0,${own.z}`)) return false; // never box the builder in at ground level
      return true;
    });
    if (!g) continue;
    const r = await place(room, p, item.type, g, item.rot);
    if (r.accepted && r.id) mine.push({ id: r.id, type: item.type });
    i++;
    await sleep(340); // just above the 10-tick server placement window
  }
  // Edit/reset cycles on own pieces (rapid select → confirm → reset).
  const variants = ["half_left", "half_right", "flipped", "turn_left", "turn_right"];
  let done = 0;
  for (let k = 0; done < editCycles && k < editCycles * 3 && mine.length; k++) {
    const piece = mine[k % mine.length]!;
    if (!room.bld.structures.has(piece.id)) continue;
    const action = piece.type === "ramp" ? { action: "select", rampVariant: variants[k % variants.length] }
      : piece.type === "wall" ? { action: "select", tileIndex: (k * 4) % 9 }
      : { action: "select", tileIndex: k % 4 };
    const sel = await edit(p, piece.id, action);
    if (!check(sel.ok, `${p.name} edit ${piece.type} ${JSON.stringify(action)} rejected: ${sel.reason}`)) continue;
    if (piece.type === "wall" || piece.type === "cone") {
      const second = await edit(p, piece.id, { action: "select", tileIndex: piece.type === "wall" ? ((k * 4) + 1) % 9 : (k + 2) % 4 });
      check(second.ok, `${p.name} second ${piece.type} tile rejected: ${second.reason}`);
    }
    const reset = await edit(p, piece.id, { action: "reset" });
    check(reset.ok, `${p.name} reset ${piece.type} rejected: ${reset.reason}`);
    const s = room.bld.structures.get(piece.id);
    const fresh = s && (s.editKind === "ramp" ? s.editRampVariant === "full" : [...s.editTiles].every(Boolean));
    check(Boolean(fresh), `${p.name} ${piece.type} ${piece.id} not restored by reset`);
    done++;
  }
  counters.editCycles += done;
  return { placed: mine.length, editCycles: done };
}

/** Real-input turbo building + rapid piece switching + real-input edit/reset. */
async function realInputBuild(room: AnyRoom, p: Player) {
  const before = placements.filter(r => r.sid === p.sid && r.accepted).length;
  await combatMode(p);
  // From beyond the floor's far edge (z ≈ 13.4) look diagonally back into the
  // outer build column (A: +X/−Z, B: −X/−Z): the aimed cells are (±2, 0, 1..2),
  // clear of both movement lanes and of the line between the players.
  // A shallow pitch: placement targets the layer plane along the aim ray, so
  // a steep look would land in the builder's own lane tile.
  await setLook(p, p.sign * Math.PI / 4, -0.12);
  await p.page.keyboard.press("KeyQ"); // dedicated wall bind enters building
  await sleep(250);
  check(await buildModeOn(p), `${p.name} build mode did not activate`);
  await mouse(p, true);
  // Wall/floor/cone binds + rotations while the primary stays held (ramps
  // are exercised by the burst and movement). Rotate right/left net to zero.
  const keys = ["KeyF", "KeyR", "KeyQ", "KeyZ", "KeyX", "KeyF", "KeyQ", "KeyR", "KeyZ", "KeyX"];
  for (const [i, k] of keys.entries()) {
    await p.page.keyboard.press(k);
    await look(p, (i % 2 ? 1 : -1) * 70, 0);
    await sleep(220);
  }
  await mouse(p, false);
  await sleep(300);
  const turbo = placements.filter(r => r.sid === p.sid && r.accepted).length - before;
  log(`${p.name} after turbo: overlay ${(await p.page.evaluate(() => (document.querySelector(".devdiag-overlay")?.textContent ?? "").slice(0, 300))).replace(/\s+/g, " ")}`);
  counters.turboPlacements += turbo;
  // Real-input edit layer: G over the aimed own piece, LMB selects a tile
  // locally, Enter confirms (the change goes out), then G, T (reset preview),
  // Enter confirms the reset; G leaves the edit layer if it is still active.
  const editsBefore = edits.filter(e => e.sid === p.sid && e.ok).length;
  await p.page.keyboard.press("KeyQ");
  await setLook(p, p.sign * Math.PI / 4, -0.1);
  const targeted = () => p.page.evaluate(() => document.querySelector(".build-edit-hud__target") !== null);
  let noTarget = 0;
  for (let i = 0; i < 4; i++) {
    if (!(await editModeOn(p))) { await p.page.keyboard.press("KeyG"); await sleep(250); }
    check(await editModeOn(p), `${p.name} edit layer did not open`);
    if (await targeted()) {
      await mouse(p, true); await sleep(60); await mouse(p, false); // select the aimed tile (local)
      await sleep(200);
      await p.page.keyboard.press("Enter"); // confirm: the tile change goes out
      await sleep(300);
      await p.page.keyboard.press("KeyG");
      await sleep(250);
      await p.page.keyboard.press("KeyT"); // reset preview
      await sleep(150);
      await p.page.keyboard.press("Enter"); // confirm the reset
      await sleep(200);
    } else noTarget++;
    if (await editModeOn(p)) { await p.page.keyboard.press("KeyG"); await sleep(200); }
    await look(p, (i % 2 ? 1 : -1) * 60, 0);
  }
  const realEdits = edits.filter(e => e.sid === p.sid && e.ok).length - editsBefore;
  counters.realInputEdits += realEdits;
  if (noTarget) log(`${p.name} real-input edit: ${noTarget}/4 attempts had no aimed own piece`);
  // Leave any edit layer (G toggles), then build mode.
  await combatMode(p);
  return { turbo, realEdits };
}

/** Wall between the players: destroy with real fire, then contested replacement. */
async function destructionCycles(room: AnyRoom, A: Player, B: Player, cycles: number) {
  const a = room.state.players.get(A.sid), b = room.state.players.get(B.sid);
  const zc = cellOf(0, (a.z + b.z) / 2).z;
  const grid = { x: 0, y: 0, z: zc };
  // Rotation 1 stands on the tile's +X edge (canonical edge wall), between the lanes.
  const wallSlot = structureSlots("wall", grid, 1)[0]!;
  const wallX = wallEdgeCenter(grid, 1).x;
  const results: unknown[] = [];
  let current: string | undefined;
  {
    const first = await place(room, A, "wall", grid, 1);
    if (first.accepted) current = first.id;
    else for (const [k, s] of room.bld.structures) if (structureSlots(s.buildType, s.grid, s.rotation).includes(wallSlot)) current = k;
  }
  for (let c = 0; c < cycles; c++) {
    if (room.roundTicks / 30 < 22) { log(`destruction: stopping after ${c} cycles (${(room.roundTicks / 30).toFixed(0)}s of round left)`); break; }
    if (!current || !room.bld.structures.has(current)) { fail(`no wall to destroy in cycle ${c}`); break; }
    const s = room.bld.structures.get(current);
    const owner = s.ownerId === A.sid ? A : B;
    const shooter = c % 2 === 0 ? A : B;
    const weapon = c % 2 === 0 ? "assault_rifle" : "shotgun";
    // Edit → shotgun → reset on the owner's wall (every other cycle).
    if (c % 2 === 1) {
      const sel = await edit(owner, current, { action: "select", tileIndex: 4 });
      check(sel.ok, `edit before shotgun rejected: ${sel.reason}`);
    }
    await equip(room, shooter, weapon as "assault_rifle" | "shotgun");
    const me = room.state.players.get(shooter.sid);
    // Aim high on the wall face (y 3.2) so rays that pass the wall clear the opponent.
    await aimAt(room, shooter, { x: wallX + (me.x > wallX ? 0.4 : -0.4), y: 3.2, z: grid.z * CS + (me.z - grid.z * CS) * 0.5 });
    const d0 = room.bld.structures.get(current)?.currentDurability;
    const fireStart = performance.now();
    await mouse(shooter, true);
    let durAfterFirstShots: number | undefined;
    try {
      await waitUntil(() => {
        const st = room.bld.structures.get(current!);
        if (st && durAfterFirstShots === undefined && st.currentDurability < d0) durAfterFirstShots = st.currentDurability;
        if (!st) return true;
        const slot = room.wps.get(shooter.sid)?.slots.get(weapon);
        if (slot && slot.magazineAmmo === 0 && !slot.reloading) void shooter.page.keyboard.press("KeyR");
        return false;
      }, 25_000, `cycle ${c} destruction`);
    } catch (e) {
      const slot = room.wps.get(shooter.sid)?.slots.get(weapon);
      const overlay = await shooter.page.evaluate(() => (document.querySelector(".devdiag-overlay")?.textContent ?? "").slice(0, 500)).catch(() => "");
      const sp = room.state.players.get(shooter.sid);
      fail(`cycle ${c}: wall ${current} not destroyed by ${shooter.name} ${weapon} (durability ${room.bld.structures.get(current)?.currentDurability}/${d0}; mag ${slot?.magazineAmmo}; look ${JSON.stringify(lastLook.get(shooter.sid))}; pos (${sp.x.toFixed(2)}, ${sp.y.toFixed(2)}, ${sp.z.toFixed(2)}); overlay ${overlay})`);
    }
    finally { await mouse(shooter, false); }
    const destroyMs = performance.now() - fireStart;
    if (c % 2 === 1 && room.bld.structures.has(current)) {
      const reset = await edit(owner, current, { action: "reset" });
      check(reset.ok, `reset after shotgun rejected: ${reset.reason}`);
    }
    if (c % 2 === 1) counters.editShotgunReset++;
    if (room.bld.structures.has(current)) break;
    counters.destructionCycles++;
    // Contested immediate replacement: both clients request the freed cell at once.
    const occFreed = !room.occ.has(wallSlot);
    check(occFreed, `cycle ${c}: wall slot ${wallSlot} not freed after destruction`);
    await sleep(340);
    const eA0 = room.state.players.get(A.sid).energy, eB0 = room.state.players.get(B.sid).energy;
    const [ra, rb] = await Promise.all([place(room, A, "wall", grid, 1), place(room, B, "wall", grid, 1)]);
    counters.contestedAttempts++;
    const winners = [ra, rb].filter(r => r.accepted);
    if (check(winners.length === 1, `cycle ${c}: contested replacement accepted ${winners.length} (A ${ra.reason}, B ${rb.reason})`)) counters.contestedResolved++;
    const loser = ra.accepted ? { r: rb, p: B } : { r: ra, p: A };
    const loserRec = placements.filter(r => r.sid === loser.p.sid && !r.accepted).at(-1);
    check(loserRec !== undefined && loserRec.e1 === loserRec.e0, `cycle ${c}: losing contested placement changed Energy`);
    current = (ra.accepted ? ra.id : rb.id);
    results.push({ cycle: c, shooter: shooter.name, weapon, destroyMs: Math.round(destroyMs), firstDamage: durAfterFirstShots, winner: ra.accepted ? "A" : "B", loserReason: loser.r.reason, energy: { A: [eA0, room.state.players.get(A.sid).energy], B: [eB0, room.state.players.get(B.sid).energy] } });
    log(`destruction cycle ${c}: ${shooter.name} ${weapon} ${Math.round(destroyMs)}ms; contested → ${ra.accepted ? "A" : "B"} won, loser ${loser.r.reason}`);
  }
  return results;
}

/** Extra contested placements during the burst: same free cell from both clients at once. */
async function contestedBurst(room: AnyRoom, A: Player, B: Player, reserved: Set<string>, attempts: number) {
  const out: unknown[] = [];
  for (let i = 0; i < attempts; i++) {
    let g: Grid | undefined;
    for (let y = 1; y <= 2 && !g; y++) for (let x = -1; x <= 1 && !g; x++) for (let z = BUILD_BOUNDS.minZ; z <= BUILD_BOUNDS.maxZ && !g; z++) {
      const c = { x, y, z };
      if (freeFor(room, "floor", c, 0) && inRange(room, A, c) && inRange(room, B, c) && !reserved.has(`${x},${y},${z}`)) g = c;
    }
    if (!g) break;
    await sleep(340);
    const [ra, rb] = await Promise.all([place(room, A, "floor", g, 0), place(room, B, "floor", g, 0)]);
    counters.contestedAttempts++;
    const ok = [ra, rb].filter(r => r.accepted).length === 1;
    if (check(ok, `contested floor ${JSON.stringify(g)}: ${ra.accepted}/${rb.accepted} (${ra.reason}/${rb.reason})`)) counters.contestedResolved++;
    out.push({ grid: g, A: ra.reason ?? "accepted", B: rb.reason ?? "accepted" });
  }
  return out;
}

/** End the round: A fires the AR at B (re-aimed from authoritative poses) until the round ends. */
async function killPhase(room: AnyRoom, A: Player, B: Player) {
  await equip(room, A, "assault_rifle");
  const target = () => { const b = room.state.players.get(B.sid); return { x: b.x, y: b.y + (b.crouch ? PLAYER_CROUCH_COLLIDER_HALF_TOTAL_HEIGHT : EYE) - 0.2, z: b.z }; };
  await aimAt(room, A, target());
  await mouse(A, true);
  const start = performance.now();
  try {
    while (room.state.matchPhase === "IN_PROGRESS" && performance.now() - start < 60_000) {
      const slot = room.wps.get(A.sid)?.slots.get("assault_rifle");
      if (slot && slot.magazineAmmo === 0 && !slot.reloading) await A.page.keyboard.press("KeyR");
      await sleep(400);
      await aimAt(room, A, target());
    }
  } finally { await mouse(A, false); }
  await waitUntil(() => room.state.matchPhase !== "IN_PROGRESS", 60_000, "round end");
  return { ms: Math.round(performance.now() - start), phase: room.state.matchPhase, winner: room.state.lastRoundResult.winnerId === A.sid ? "A" : room.state.lastRoundResult.winnerId === B.sid ? "B" : "?" };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(WEB_DIST)) throw new Error("apps/web/dist missing — run pnpm build");
  const staticServer = await startStatic();
  const { server: gameServer } = await startServer(GAME_PORT, createServer());
  startSampler();
  const browser: Browser = await chromium.launch({ headless: true });
  const contexts: BrowserContext[] = [];
  const report: any = { startedAt: new Date().toISOString(), rounds: [], samples: [] };
  const consoleErrors: string[] = [];
  try {
    const open = async (name: "A" | "B") => {
      const context = await browser.newContext({ viewport: { width: 480, height: 270 } });
      contexts.push(context);
      // tsx (esbuild keepNames) wraps named functions in evaluated callbacks with `__name`.
      await context.addInitScript("globalThis.__name = (f) => f;");
      const page = await context.newPage();
      page.on("pageerror", e => consoleErrors.push(`${name}: ${e.message}`));
      page.on("console", m => { if (m.type() === "error" && !/message not registered|net::/.test(m.text())) consoleErrors.push(`${name}: ${m.text()}`); });
      await page.goto(APP_URL);
      await page.waitForFunction(() => Boolean((window as any).__buildshiftNetworking?.client?.deref()?.sessionId), undefined, { timeout: 30_000 });
      const sid = await page.evaluate(() => (window as any).__buildshiftNetworking.client.deref().sessionId as string);
      const cdp = await context.newCDPSession(page);
      return { name, page, cdp, sid } as Omit<Player, "sign">;
    };
    const b0 = await open("B");
    const a0 = await open("A");
    const room = await waitUntil(() => rooms.find(r => r.state.players.size === 2), 20_000, "room with two players");
    liveRoom = room;
    const spawnX = (sid: string) => room.state.players.get(sid).x;
    const A: Player = { ...a0, sign: spawnX(a0.sid) > 0 ? 1 : -1 };
    const B: Player = { ...b0, sign: spawnX(b0.sid) > 0 ? 1 : -1 };
    check(A.sign === 1 && B.sign === -1, `unexpected spawn slots A=${spawnX(A.sid)} B=${spawnX(B.sid)}`);
    const players = [A, B];
    for (const p of players) {
      await p.page.evaluate(() => {
        const canvas = document.querySelector("canvas.game-canvas");
        Object.defineProperty(document, "pointerLockElement", { get: () => canvas, configurable: true });
        document.dispatchEvent(new Event("pointerlockchange"));
      });
    }
    await waitUntil(() => room.state.matchPhase === "IN_PROGRESS", 30_000, "first round in progress");
    await Promise.all(players.map(p => p.page.waitForFunction(() => document.querySelector(".match-hud__phase")?.textContent === "IN PROGRESS", undefined, { timeout: 30_000 })));
    for (const p of players) await installClientProbe(p.page);

    const sample = async (label: string, gc: boolean) => {
      if (gc) {
        // Resting measurement: discard the activity window, then measure a
        // quiet 2 s window (no harness input) for frame time / draw calls.
        for (const p of players) await drainClientWindow(p.page);
        await sleep(2_000);
      }
      const server = auditServer(room);
      const clients: Record<string, unknown> = {};
      for (const p of players) clients[p.name] = { ...(await clientResources(p, gc)), window: await drainClientWindow(p.page) };
      const tick = { n: tickDur.length, durMed: pct(tickDur, 0.5), durP99: pct(tickDur, 0.99), durMax: Math.max(...tickDur), gapMed: pct(tickGap, 0.5), gapP99: pct(tickGap, 0.99), gapMax: Math.max(...tickGap), gapsOver66: tickGap.filter(g => g > 66.7).length, gapsOver100: tickGap.filter(g => g > 100).length };
      tickDur.length = 0; tickGap.length = 0;
      const s = { label, t: Number(ts()), server: { ...server, violations: server.violations.length }, tick, clients };
      report.samples.push(s);
      const cA = clients.A as ClientResources & { window: ClientWindow }, cB = clients.B as ClientResources & { window: ClientWindow };
      log(`sample ${label}: server structures=${server.structures} occ=${server.occupied} colliders=${server.colliders} q=${server.queueDepths.join("/")} tick p99=${tick.durP99?.toFixed(2)}ms gapMax=${tick.gapMax?.toFixed(0)}ms | A meshes=${cA.meshes} mats=${cA.materials} tex=${cA.textures} geo=${cA.geometries} solids=${cA.buildSolids} obs=${cA.observers} lst=${cA.listeners} heap=${cA.heapMB}MB frame=${cA.window.frameMsMed?.toFixed(1)}/${cA.window.frameMsP95?.toFixed(1)}ms draws=${cA.window.drawsMed} | B meshes=${cB.meshes} mats=${cB.materials} solids=${cB.buildSolids} heap=${cB.heapMB}MB`);
      return s;
    };
    const peakSampler = { stop: false, max: {} as Record<string, Record<string, number>> };
    const peakLoop = (async () => {
      while (!peakSampler.stop) {
        await sleep(2_500);
        if (peakSampler.stop) break;
        for (const p of players) {
          const r = await clientResources(p, false).catch(() => null);
          if (!r) continue;
          const m = (peakSampler.max[p.name] ??= {});
          for (const k of ["meshes", "enabledMeshes", "activeMeshes", "materials", "textures", "geometries", "transformNodes", "buildSolids", "renderedStructures", "observers", "listeners", "heapMB"] as const) m[k] = Math.max(m[k] ?? -Infinity, r[k] as number);
        }
      }
    })();

    const baseline = await sample("BEFORE (round 1 start)", true);
    report.baseline = baseline;

    const runRound = async (label: string, opts: { burst: number; edits: number; destruction: number; contested: number; movement: boolean; realInput: boolean }) => {
      const round: any = { label, roundNumber: room.state.currentRound };
      phaseLabel = `${label} immediate`;
      // Immediate input at round start: movement + placement in the first second.
      const startTick = room.tc;
      const seqA0 = room.state.players.get(A.sid).lastProcessedSequence;
      // Real jump (both players) + a placement, right at round start.
      await Promise.all([A.page.keyboard.press("Space"), B.page.keyboard.press("Space")]);
      const immediate = await place(room, A, "wall", { x: 2, y: 0, z: 0 }, 1).catch(e => ({ accepted: false, reason: String(e) }));
      const jumped = await waitUntil(() => room.state.players.get(A.sid).y > 0.3 && room.state.players.get(B.sid).y > 0.3 ? room.tc : undefined, 3_000, "immediate jump").catch(() => undefined);
      check(jumped !== undefined, "real jump at round start not simulated by the server");
      await waitUntil(() => room.state.players.get(A.sid).lastProcessedSequence > seqA0 + 5, 3_000, "immediate input processed").catch(() => fail("no input processed in the first seconds of the round"));
      round.immediate = { placement: immediate.accepted ? "accepted" : immediate.reason, ticksToPlacement: (placements.filter(r => r.sid === A.sid).at(-1)?.tick ?? 0) - startTick, ticksToJump: jumped === undefined ? null : jumped - startTick, inputsProcessed: room.state.players.get(A.sid).lastProcessedSequence - seqA0 };
      check(immediate.accepted, `immediate placement at round start rejected: ${immediate.reason}`);
      await settle(room, A);
      if (opts.movement) {
        phaseLabel = `${label} movement`;
        // The immediate wall sits in x-cell 2 — outside both lanes.
        const [ma, mb] = await Promise.all([movementPhase(room, A), movementPhase(room, B)]);
        round.movement = { A: ma, B: mb };
        log(`movement A ${JSON.stringify(ma)} B ${JSON.stringify(mb)}`);
      }
      if (opts.realInput) {
        phaseLabel = `${label} real-input build/edit`;
        const [ra, rb] = await Promise.all([realInputBuild(room, A), realInputBuild(room, B)]);
        round.realInput = { A: ra, B: rb };
        log(`real input A ${JSON.stringify(ra)} B ${JSON.stringify(rb)}`);
      }
      if (opts.movement) {
        phaseLabel = `${label} movement`;
        await Promise.all([movementFinish(room, A), movementFinish(room, B)]);
      }
      phaseLabel = `${label} build`;
      const reserved = corridor(room, A, B);
      for (let z = BUILD_BOUNDS.minZ; z <= BUILD_BOUNDS.maxZ; z++) reserved.add(`0,0,${z}`);
      for (const p of players) { const s = room.state.players.get(p.sid), c = cellOf(s.x, s.z); for (const y of [0, 1]) reserved.add(`${c.x},${y},${c.z}`); }
      round.timeLeftAtBuild = Math.round(room.roundTicks / 30);
      round.contested = await contestedBurst(room, A, B, reserved, opts.contested);
      const [ba, bb] = await Promise.all([buildBurst(room, A, reserved, opts.burst, opts.edits), buildBurst(room, B, reserved, opts.burst, opts.edits)]);
      round.burst = { A: ba, B: bb };
      log(`burst A ${JSON.stringify(ba)} B ${JSON.stringify(bb)} contested ${JSON.stringify(round.contested)}`);
      round.converged = await converge(room, players, `${label} after build`);
      round.peak = await sample(`${label} PEAK (after build)`, false);
      phaseLabel = `${label} destruction`;
      round.destruction = await destructionCycles(room, A, B, opts.destruction);
      round.convergedAfterDestruction = await converge(room, players, `${label} after destruction`);
      phaseLabel = `${label} kill`;
      for (const p of players) await combatMode(p);
      round.kill = await killPhase(room, A, B);
      log(`round end ${JSON.stringify(round.kill)}`);
      counters.roundsCompleted++;
      report.rounds.push(round);
      return round;
    };

    const waitNextRoundStart = async (label: string) => {
      phaseLabel = `${label} cleanup`;
      await waitUntil(() => room.state.matchPhase === "COUNTDOWN" || room.state.matchPhase === "MATCH_ENDED", 20_000, "round reset");
      if (room.state.matchPhase === "MATCH_ENDED") return "MATCH_ENDED";
      check(room.bld.structures.size === 0 && room.occ.size === 0, `round reset left ${room.bld.structures.size} structures / ${room.occ.size} cells`);
      await waitUntil(() => room.state.matchPhase === "IN_PROGRESS", 20_000, "next round in progress");
      await Promise.all(players.map(p => p.page.waitForFunction(() => document.querySelector(".match-hud__phase")?.textContent === "IN PROGRESS", undefined, { timeout: 20_000 })));
      await converge(room, players, `${label} after reset`);
      return "IN_PROGRESS";
    };

    // Match 1: run rounds until the match ends.
    const roundOpts = { burst: 10, edits: 6, destruction: 4, contested: 2, movement: true, realInput: true };
    let r = 0;
    for (;;) {
      r++;
      if (r > 6) { fail("match did not end within 6 rounds"); break; }
      await runRound(`M1R${r}`, roundOpts);
      const next = await waitNextRoundStart(`M1R${r}`);
      if (next === "MATCH_ENDED") break;
      report[`afterCleanup_M1R${r}`] = await sample(`AFTER CLEANUP M1R${r} (next round start)`, true);
    }
    // Rematch.
    phaseLabel = "rematch";
    check(room.state.matchPhase === "MATCH_ENDED", `expected MATCH_ENDED, got ${room.state.matchPhase}`);
    report.matchEnd = { scores: Object.fromEntries([...room.state.roundScore.entries()].map(([k, v]: [string, any]) => [k === A.sid ? "A" : "B", v.value])) };
    await converge(room, players, "match end");
    report.afterCleanup_matchEnd = await sample("AFTER CLEANUP match end (structures cleared?)", true);
    for (const p of players) {
      const clicked = await p.page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => /play again|rematch/i.test(b.textContent ?? "")), undefined, { timeout: 20_000 })
        .then(() => p.page.evaluate(() => { const b = Array.from(document.querySelectorAll("button")).find(b => /play again|rematch/i.test(b.textContent ?? "")) as HTMLButtonElement | undefined; if (!b || b.disabled) return false; b.click(); return true; }));
      check(clicked, `${p.name} rematch button not clickable`);
    }
    await waitUntil(() => roundEvents.some(e => e.kind === "match_reset"), 15_000, "rematch reset");
    check(room.bld.structures.size === 0 && room.occ.size === 0, "rematch reset left structures/occupancy");
    counters.rematches++;
    await waitUntil(() => room.state.matchPhase === "IN_PROGRESS", 20_000, "rematch round in progress");
    await Promise.all(players.map(p => p.page.waitForFunction(() => document.querySelector(".match-hud__phase")?.textContent === "IN PROGRESS", undefined, { timeout: 20_000 })));
    for (const p of players) await p.page.evaluate(() => { const c = document.querySelector("canvas.game-canvas"); Object.defineProperty(document, "pointerLockElement", { get: () => c, configurable: true }); document.dispatchEvent(new Event("pointerlockchange")); });
    report.afterCleanup_rematch = await sample("AFTER CLEANUP rematch (match 2 round 1 start)", true);
    await runRound("M2R1", { burst: 8, edits: 5, destruction: 2, contested: 1, movement: true, realInput: false });
    const final = await waitNextRoundStart("M2R1");
    check(final === "IN_PROGRESS", `unexpected state after M2R1: ${final}`);
    phaseLabel = "final";
    report.final = await sample("AFTER CLEANUP FINAL (match 2 round 2 start)", true);
    peakSampler.stop = true;
    await peakLoop;
    report.clientPeaks = peakSampler.max;

    // Client-side network health.
    report.clientNetwork = {};
    for (const p of players) {
      const n = await p.page.evaluate(() => { const S = (window as any).__stress; return { seqRegressions: S.seqRegressions, leaves: S.leaves, rejections: S.rejections.length, connected: Boolean((window as any).__buildshiftNetworking.client.deref()?.room?.connection?.isOpen ?? true) }; });
      report.clientNetwork[p.name] = n;
      check(n.seqRegressions.length === 0, `${p.name} client saw sequence regressions: ${n.seqRegressions.slice(0, 5)}`);
      check(n.leaves.length === 0, `${p.name} client left the room: ${JSON.stringify(n.leaves)}`);
    }
  } catch (e: any) {
    fail(`aborted: ${String(e?.stack ?? e).slice(0, 800)}`);
  } finally {
    if (sampler) clearInterval(sampler);
    const durationS = Number(ts());
    phaseLabel = "teardown";
    for (const c of contexts) await c.close().catch(() => {});
    await browser.close().catch(() => {});
    await sleep(500);
    const disposed = rooms.every(r => r.pw === null || r.pw?.disposed === true || r.clients.length === 0);
    await shutdownServer(gameServer).catch(() => {});
    await new Promise<void>(resolve => staticServer.close(() => resolve()));

    // Global acceptance checks.
    phaseLabel = "summary";
    const accepted = placements.filter(p => p.accepted), rejected = placements.filter(p => !p.accepted);
    const energyViolations = rejected.filter(p => p.e1 !== p.e0);
    const chargeViolations = accepted.filter(p => Math.abs((p.e0 - p.e1) - (getStructureConfig(p.buildType)?.cost ?? NaN)) > 1e-9);
    check(energyViolations.length === 0, `${energyViolations.length} rejected placements changed Energy: ${JSON.stringify(energyViolations.slice(0, 3))}`);
    check(chargeViolations.length === 0, `${chargeViolations.length} accepted placements charged a non-canonical cost`);
    check(violationLog.length === 0, `${violationLog.length} server invariant violations: ${violationLog.slice(0, 5).join(" | ")}`);
    check(seqRegressions.length === 0, `server sequence regressions: ${seqRegressions.slice(0, 5).join(", ")}`);
    const midMatchLeaves = leaves.filter(l => l.phase !== "teardown");
    check(midMatchLeaves.length === 0, `players left during the run: ${JSON.stringify(midMatchLeaves)}`);
    check(queueStats.maxDepth <= INPUT_QUEUE_LIMIT, `queue depth ${queueStats.maxDepth} exceeded limit`);
    check(consoleErrors.length === 0, `client console errors: ${consoleErrors.slice(0, 5).join(" | ")}`);
    const rejectReasons: Record<string, number> = {};
    for (const p of rejected) rejectReasons[p.reason ?? "?"] = (rejectReasons[p.reason ?? "?"] ?? 0) + 1;
    const editReject: Record<string, number> = {};
    for (const e of edits.filter(e => !e.ok)) editReject[e.reason ?? "?"] = (editReject[e.reason ?? "?"] ?? 0) + 1;
    counters.accepted = accepted.length;
    counters.rejected = rejected.length;
    report.summary = {
      durationS, counters, rejectReasons, edits: { total: edits.length, ok: edits.filter(e => e.ok).length, rejectReasons: editReject },
      destroyedByCombat: destroyed.length, destroyedByType: destroyed.reduce((m: Record<string, number>, d) => (m[d.buildType] = (m[d.buildType] ?? 0) + 1, m), {}),
      serverPeaks: peaks, queueStats, maxInputGapMs: Object.fromEntries(maxInputGapMs), seqRegressions: seqRegressions.length,
      energy: { rejectedChecked: rejected.length, rejectedChangedEnergy: energyViolations.length, acceptedWrongCharge: chargeViolations.length },
      leaves, roundEvents: roundEvents.map(e => e.kind), consoleErrors: consoleErrors.slice(0, 20), roomsDisposedOrEmpty: disposed,
      violations: violationLog, failures,
    };
    report.raw = { placements, edits, destroyed };
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    log(`report written to ${REPORT_PATH}`);
    log(`SUMMARY ${JSON.stringify(report.summary.counters)}`);
    log(failures.length === 0 ? "STRESS PASS" : `STRESS FAIL (${failures.length}): ${failures.join(" || ")}`);
  }
}

main().then(() => process.exit(failures.length === 0 ? 0 : 1), (e) => { console.error(e); process.exit(1); });
