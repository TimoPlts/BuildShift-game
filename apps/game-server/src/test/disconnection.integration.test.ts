/**
 * Server integration tests for player disconnection semantics.
 */
import { describe, expect, it } from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";
import { MatchPhase, BUILD_EVENTS, ENERGY_EVENTS, EVENTS, type StructurePlacedEvent, type StructureDestroyedEvent } from "@buildshift/protocol";
import { MAX_HEALTH, MAX_SHIELD, ENERGY, VERTICAL_MOVEMENT } from "@buildshift/game-config";
import { MATCH_EVENTS } from "../match/matchLifecycle.js";
import { startServer, shutdownServer } from "../server.js";
import { TWO_PLAYER_MOVEMENT_ROOM } from "../rooms/TwoPlayerMovementRoom.js";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function wfs(room: ClientRoom, pred: (s: unknown) => boolean, timeoutMs = 5000): Promise<void> {
  const t0 = Date.now();
  if (room.state && pred(room.state)) return;
  while (Date.now() - t0 < timeoutMs) {
    await wait(25);
    if (room.state && pred(room.state)) return;
  }
  throw new Error(`wfs timeout ${timeoutMs}ms`);
}

function pf(s: unknown, sid: string): any {
  const p = (s as Record<string, any>)?.players;
  if (!p) return undefined;
  return typeof p.get === "function" ? p.get(sid) : p[sid];
}
function ph(s: unknown): string { return (s as Record<string, any>)?.matchPhase as string ?? ""; }
function sc(s: unknown, sid: string): number {
  const rs = (s as Record<string, any>)?.roundScore;
  if (!rs) return 0;
  const e = typeof rs.get === "function" ? rs.get(sid) : rs[sid];
  return e?.value ?? 0;
}
function cr(s: unknown): number { return (s as Record<string, any>)?.currentRound as number ?? 0; }

async function td(r: ClientRoom | null): Promise<void> {
  if (!r) return;
  r.leave().catch(() => {});
  try { r.connection.close(); } catch {}
}

/** Force a disconnect that prevents Colyseus SDK auto-reconnection. */
async function disconnect(room: ClientRoom): Promise<void> {
  await room.leave().catch(() => {});
  try { room.connection.close(); } catch {}
}

async function dl<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rj) => { t = setTimeout(() => rj(new Error(label)), ms); })]);
  } finally { if (t) clearTimeout(t); }
}

async function setup() {
  const st = await dl(startServer(0), 10_000, "startServer");
  const url = `ws://127.0.0.1:${st.port}`;
  const a = await dl(new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM), 10_000, "joinA");
  const b = await dl(new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM), 10_000, "joinB");
  await wfs(a, (s) => pf(s, a.sessionId) && pf(s, b.sessionId));
  return { server: st.server, url, a, b };
}

async function jn(url: string): Promise<ClientRoom> {
  return await dl(new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM), 10_000, "join");
}

async function wp(room: ClientRoom, timeoutMs = 8000): Promise<void> {
  await wfs(room, (s) => ph(s) === MatchPhase.IN_PROGRESS, timeoutMs);
}

function sb(room: ClientRoom, seq: number, bt: string, g: { x: number; y: number; z: number }) {
  room.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: seq, buildType: bt, grid: g, rotation: 0 });
}

describe("Disconnection integration", () => {
  it("mid-round disconnect: no duplicate round-win, build cleanup, remaining-player consistency", async () => {
    const { server, a, b } = await setup();
    const sidA = a.sessionId, sidB = b.sessionId;
    const ro: any[] = [], el: any[] = [], pl: StructurePlacedEvent[] = [], ds: StructureDestroyedEvent[] = [];
    a.onMessage(MATCH_EVENTS.ROUND_OVER, (m) => ro.push(m));
    b.onMessage(MATCH_EVENTS.ROUND_OVER, (m) => ro.push(m));
    a.onMessage(EVENTS.ELIMINATED, (m) => el.push(m));
    b.onMessage(EVENTS.ELIMINATED, (m) => el.push(m));
    a.onMessage(BUILD_EVENTS.STRUCTURE_PLACED, (m) => pl.push(m as StructurePlacedEvent));
    a.onMessage(ENERGY_EVENTS.STRUCTURE_DESTROYED, (m) => ds.push(m as StructureDestroyedEvent));
    b.onMessage(ENERGY_EVENTS.STRUCTURE_DESTROYED, (m) => ds.push(m as StructureDestroyedEvent));
    try {
      await wp(a);
      expect(ph(a.state)).toBe(MatchPhase.IN_PROGRESS);
      expect(cr(a.state)).toBe(1);
      // A builds wall + floor
      sb(a, 100, "wall", { x: -4, y: 0, z: 0 });
      await wfs(a, () => pl.length >= 1, 5000);
      expect(pl[0].structure.ownerId).toBe(sidA);
      await wait(500);
      sb(a, 200, "floor", { x: -3, y: 0, z: 1 });
      await wfs(a, () => pl.length >= 2, 5000);
      expect(pl[1].structure.ownerId).toBe(sidA);
      // Wait for the state patch to reflect the reduced energy before asserting.
      // The STRUCTURE_PLACED event arrives before the state delta, so we must
      // poll until the client schema shows energy below the starting value.
      await wfs(a, (s) => (pf(s, sidA)?.energy ?? ENERGY.startingEnergy) < ENERGY.startingEnergy, 5000);
      expect(pf(a.state, sidA)?.energy).toBeLessThan(ENERGY.startingEnergy);
      // A disconnects mid-round
      try { a.connection.close(); } catch {}
      await wfs(b, (s) => ph(s) === MatchPhase.ROUND_ENDED, 6000);
      await wait(100);
      // (a) No duplicate round-win
      expect(sc(b.state, sidB)).toBe(1);
      expect(ro.length).toBe(1);
      expect(ro[0].winnerId).toBe(sidB);
      expect(ro[0].loserId).toBe(sidA);
      expect(el.length).toBe(0);
      expect(pf(b.state, sidA)).toBeUndefined();
      const lrr = (b.state as Record<string, any>)?.lastRoundResult;
      expect(lrr).toBeDefined();
      expect(lrr.winnerId).toBe(sidB);
      expect(lrr.roundNumber).toBe(1);
      // (c) Match still active
      expect(ph(b.state)).toBe(MatchPhase.ROUND_ENDED);
      expect(ph(b.state)).not.toBe(MatchPhase.MATCH_ENDED);
      // Wait for round reset
      await wfs(b, (s) => ph(s) === MatchPhase.COUNTDOWN, 10_000);
      // (b) All A-owned structures destroyed
      const aIds = new Set(pl.filter((e) => e.structure.ownerId === sidA).map((e) => e.structure.structureId));
      expect(aIds.size).toBe(2);
      const dIds = new Set(ds.map((e) => e.structureId));
      for (const id of aIds) expect(dIds.has(id)).toBe(true);
      // (c) B state consistent
      const ba = pf(b.state, sidB);
      expect(ba).toBeDefined();
      expect(ba.health).toBe(MAX_HEALTH);
      expect(ba.shield).toBe(MAX_SHIELD);
      expect(ba.energy).toBe(ENERGY.startingEnergy);
      expect(ba.alive).toBe(true);
      expect(ba.isEliminated).toBe(false);
      expect(ba.x).toBeCloseTo(5, 1);
      expect(ba.y).toBeCloseTo(VERTICAL_MOVEMENT.groundY, 1);
      expect(ba.z).toBeCloseTo(0, 1);
      expect(sc(b.state, sidB)).toBe(1);
    } finally {
      await dl(td(a), 5000, "tdA");
      await dl(td(b), 5000, "tdB");
      await dl(shutdownServer(server), 8000, "shutdown");
    }
  }, 45_000);

  it("mid-countdown disconnect: countdown not corrupted, no round re-awarded", async () => {
    const { server, url, a, b } = await setup();
    const sidA = a.sessionId, sidB = b.sessionId;
    const ro: any[] = [];
    a.onMessage(MATCH_EVENTS.ROUND_OVER, (m) => ro.push(m));
    b.onMessage(MATCH_EVENTS.ROUND_OVER, (m) => ro.push(m));
    try {
      await wp(a);
      // B disconnects → A wins round 1
      try { b.connection.close(); } catch {}
      await wfs(a, (s) => ph(s) === MatchPhase.ROUND_ENDED, 6000);
      expect(sc(a.state, sidA)).toBe(1);
      expect(ro.length).toBe(1);
      // Wait for reset → COUNTDOWN
      await wfs(a, (s) => ph(s) === MatchPhase.COUNTDOWN, 10_000);
      expect(ph(a.state)).toBe(MatchPhase.COUNTDOWN);
      expect(cr(a.state)).toBe(1);
      // B returns with a FRESH session and its join must be confirmed BEFORE
      // A drops. With maxPlayers = 2 and Colyseus autoDispose, a
      // mid-countdown disconnect by the last remaining client disposes the
      // room (the disconnect grace only preserves state, it does not reserve
      // the seat), making the countdown unobservable. A confirmed second
      // client keeps the room alive deterministically.
      const b2 = await jn(url);
      b2.onMessage(MATCH_EVENTS.ROUND_OVER, (m) => ro.push(m));
      await wfs(b2, (s) => pf(s, b2.sessionId) !== undefined, 5000);
      // A disconnects during countdown
      try { a.connection.close(); } catch {}
      try {
        // Synchronize on the authoritative transition into an active round
        // at or past round 2. Do NOT assert an exact round number after this
        // async boundary: A's 3s reconnect grace may expire almost as soon
        // as round 2 begins (A dropped near the end of the countdown) and
        // legitimately award round 2 — a NEW round, not a re-award of round
        // 1 — to the remaining player, after which the match resets (2s)
        // and counts down (3s) into round 3. Both outcomes satisfy the same
        // contract; the invariants below hold in either case.
        await wfs(b2, (s) => ph(s) === MatchPhase.IN_PROGRESS && cr(s) >= 2, 12_000);
        // (1) Countdown not corrupted: the mid-countdown disconnect did not
        // stop the lifecycle — the match still transitioned COUNTDOWN →
        // IN_PROGRESS and advanced to round 2 or later.
        expect(ph(b2.state)).toBe(MatchPhase.IN_PROGRESS);
        expect(cr(b2.state)).toBeGreaterThanOrEqual(2);
        // (2) No round re-awarded: round 1's win is preserved exactly once.
        expect(sc(b2.state, sidA)).toBe(1);
        // (3) Both disconnected sessions are gone from authoritative state.
        expect(pf(b2.state, sidA)).toBeUndefined();
        expect(pf(b2.state, sidB)).toBeUndefined();
        // (4) Round 1 was awarded exactly once, to A. Any further ROUND_OVER
        // must belong to a later round with the disconnected session as the
        // loser (the disconnect consequence), never a duplicate of round 1.
        // If the state already reflects round 3, the round-2 award event was
        // broadcast earlier on the same connection, so it is guaranteed
        // delivered; if we snapped during round 2 it may not have arrived
        // yet, so only validate the events that are present.
        const round1 = ro.filter((m) => m.roundNumber === 1);
        expect(round1.length).toBe(1);
        expect(round1[0].winnerId).toBe(sidA);
        expect(round1[0].loserId).toBe(sidB);
        for (const m of ro) {
          if (m.roundNumber > 1) {
            expect(m.loserId).toBe(sidA);
            expect(m.reason).toBe("disconnect");
          }
        }
      } finally {
        await dl(td(b2), 5000, "tdB2");
      }
    } finally {
      await dl(td(a), 5000, "tdA");
      await dl(td(b), 5000, "tdB");
      await dl(shutdownServer(server), 8000, "shutdown");
    }
  }, 45_000);

  it("reconnect after round-win: previously granted win is NOT re-awarded", async () => {
    const { server, url, a, b } = await setup();
    const sidA = a.sessionId, sidB = b.sessionId;
    const ro: any[] = [];
    a.onMessage(MATCH_EVENTS.ROUND_OVER, (m) => ro.push(m));
    b.onMessage(MATCH_EVENTS.ROUND_OVER, (m) => ro.push(m));
    try {
      await wp(a);
      // B disconnects → A wins round 1
      try { b.connection.close(); } catch {}
      await wfs(a, (s) => ph(s) === MatchPhase.ROUND_ENDED, 6000);
      expect(sc(a.state, sidA)).toBe(1);
      expect(ro.length).toBe(1);
      // Wait for reset → COUNTDOWN
      await wfs(a, (s) => ph(s) === MatchPhase.COUNTDOWN, 10_000);
      // A disconnects during countdown (proper leave prevents reconnection).
      await disconnect(a);
      await wait(500);
      // A reconnects with a brand-new Client (new session).
      const a2 = await jn(url);
      const sidA2 = a2.sessionId;
      expect(sidA2).not.toBe(sidA);
      try {
        // Wait for the reconnected client to see its own player AND full state.
        await wfs(a2, (s) => pf(s, sidA2) !== undefined && ph(s) !== "", 5000);
        // Allow a short settle for any late state patches.
        await wait(300);
        // The reconnected player's score is 0 (new session, no prior wins).
        expect(sc(a2.state, sidA2)).toBe(0);
        // The previously granted round win is NOT re-awarded to the new session.
        expect(sc(a2.state, sidA2)).toBe(0);
        // Match state is still valid (COUNTDOWN or IN_PROGRESS).
        const p = ph(a2.state);
        expect([MatchPhase.COUNTDOWN, MatchPhase.IN_PROGRESS, MatchPhase.MATCH_ENDED]).toContain(p);
        // B is not in the room.
        expect(pf(a2.state, sidB)).toBeUndefined();
        // A's new session IS in the room.
        expect(pf(a2.state, sidA2)).toBeDefined();
        // No additional ROUND_OVER was broadcast (only the 1 from round 1).
        expect(ro.length).toBe(1);
      } finally {
        await dl(td(a2), 5000, "tdA2");
      }
    } finally {
      await dl(td(a), 5000, "tdA");
      await dl(td(b), 5000, "tdB");
      await dl(shutdownServer(server), 8000, "shutdown");
    }
  }, 45_000);
});
