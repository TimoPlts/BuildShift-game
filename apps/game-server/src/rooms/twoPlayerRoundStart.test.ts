/**
 * Round-preparation contract (Task A — CONTRACT.md §1-4).
 *
 * Deterministic, tick-driven coverage of the authoritative preparation
 * phase: every round opens with a fixed 8 s build preparation during which
 * each player is confined to ONE outermost build-grid X row at their end of
 * the arena. There is NO active-fight timer and NO anti-stall resolution —
 * rounds end on elimination only (plus the disconnect-forfeit exception,
 * covered in the lifecycle/disconnection suites).
 *
 * Uses production handlers and the production fixed-timestep body with a
 * manually advanced server clock (same pattern as the canonical weapon /
 * build-edit suite). No sleeps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import {
  ASSAULT_RIFLE,
  BOX_FIGHT_PREPARATION,
  MAX_HEALTH,
  MAX_SHIELD,
  VERTICAL_MOVEMENT,
  getPreparationZone,
} from "@buildshift/game-config";
import { BUILD_EVENTS, ENERGY_EVENTS, MatchPhase } from "@buildshift/protocol";
import { TwoPlayerMovementRoom, TWO_PLAYER_MOVEMENT_INPUT } from "./TwoPlayerMovementRoom.js";
import { MATCH_EVENTS } from "../match/matchLifecycle.js";

const TICK_HZ = 30;
const PREP_TICKS = Math.round(BOX_FIGHT_PREPARATION.durationSeconds * TICK_HZ);
const NEG = getPreparationZone("negative");
const POS = getPreparationZone("positive");

describe("round preparation phase contract", () => {
  let room: TwoPlayerMovementRoom;
  let internal: any;
  let a: Client;
  let b: Client;
  let handlers: Map<string, (client: Client, message: unknown) => void | Promise<void>>;
  let broadcasts: Array<{ event: string; payload: any }>;
  let sent: Array<{ sid: string; type: string; payload: any }>;

  const advance = (ticks: number) => {
    for (let i = 0; i < ticks; i++) internal.tick();
  };
  const flush = async () => {
    // let pending microtasks (e.g. the awaited physics world in hpr) settle
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };
  const phase = () => room.state.matchPhase as MatchPhase;
  const player = (sid: string) => room.state.players.get(sid)!;
  const broadcastsOf = (event: string) => broadcasts.filter((b2) => b2.event === event);

  const input = async (client: Client, sequence: number, over: Record<string, unknown> = {}) => {
    await handlers.get(TWO_PLAYER_MOVEMENT_INPUT)!(client, {
      sequence,
      moveX: 0,
      moveZ: 0,
      lookYaw: 0,
      lookPitch: 0,
      jump: false,
      sprint: false,
      crouch: false,
      primaryFire: false,
      secondaryFire: false,
      ...over,
    });
  };
  const inputTick = async (client: Client, sequence: number, over: Record<string, unknown> = {}) => {
    await input(client, sequence, over);
    internal.tick();
  };
  const place = async (client: Client, sequence: number, grid: { x: number; y: number; z: number }) => {
    await handlers.get(BUILD_EVENTS.PLACEMENT_REQUEST)!(client, {
      sequence,
      buildType: "wall",
      grid,
      rotation: 0,
    });
    await flush();
  };
  /** Move b's vitals to the brink and have a open fire — one canonical shot. */
  const killB = async () => {
    const pb = player("b");
    pb.shield = 0;
    pb.health = 1;
    await input(a, 9000, { lookYaw: Math.PI / 2, primaryFire: true });
    advance(12); // weapon cooldown window passes; the shot is resolved
  };

  beforeEach(async () => {
    room = new TwoPlayerMovementRoom();
    internal = room as any;
    await internal.pwp;
    handlers = new Map();
    broadcasts = [];
    sent = [];
    vi.spyOn(room, "onMessage").mockImplementation(((type: string, fn: any) => {
      handlers.set(type, fn);
    }) as any);
    vi.spyOn(room, "setFixedTimestep").mockImplementation(() => {});
    vi.spyOn(room, "broadcast").mockImplementation(((event: string, payload: any) => {
      broadcasts.push({ event, payload });
    }) as any);
    a = { sessionId: "a", send: vi.fn((type: string, payload: any) => sent.push({ sid: "a", type, payload })) } as unknown as Client;
    b = { sessionId: "b", send: vi.fn((type: string, payload: any) => sent.push({ sid: "b", type, payload })) } as unknown as Client;
    room.clients.push(a, b);
    room.onCreate({}); // authoritative default: 8 s preparation
    room.onJoin(a);
    room.onJoin(b);
  });

  afterEach(() => {
    room.onDispose();
    room.clock.clear();
    vi.restoreAllMocks();
  });

  // ─── 1: both players get the SAME authoritative 8 s preparation ───────────

  it("runs one shared 8 s preparation countdown, then opens the round", async () => {
    expect(phase()).toBe(MatchPhase.COUNTDOWN);
    expect(room.state.currentRound).toBe(0);

    advance(1);
    expect(room.state.preparationActive).toBe(true);
    advance(239); // total = 240 ticks = 8 s × 30 Hz

    const ticks = broadcastsOf(MATCH_EVENTS.COUNTDOWN_TICK);
    expect(ticks).toHaveLength(PREP_TICKS);
    expect(PREP_TICKS).toBe(BOX_FIGHT_PREPARATION.durationSeconds * TICK_HZ);
    for (const t of ticks) expect(t.payload.totalTicks).toBe(PREP_TICKS);
    // Both players observe the SAME countdown total.
    expect(new Set(ticks.map((t) => t.payload.totalTicks)).size).toBe(1);

    expect(phase()).toBe(MatchPhase.IN_PROGRESS);
    expect(room.state.currentRound).toBe(1);
    expect(room.state.preparationActive).toBe(false);
  });

  it("preparation only advances while BOTH players are connected", async () => {
    // Solo room: leave b — the countdown must freeze, never open a 1-player fight.
    room.onLeave(b);
    advance(PREP_TICKS + 60);
    expect(phase()).toBe(MatchPhase.COUNTDOWN);
    expect(room.state.currentRound).toBe(0);
    expect(room.state.preparationActive).toBe(false);
    expect(broadcastsOf(MATCH_EVENTS.COUNTDOWN_TICK)).toHaveLength(0);

    // b returns → the shared preparation runs again and the round opens.
    room.onJoin(b);
    advance(PREP_TICKS);
    expect(phase()).toBe(MatchPhase.IN_PROGRESS);
    expect(room.state.currentRound).toBe(1);
  });

  // ─── 2: each player prepares in their own outermost build row ─────────────

  it("spawns players at the centres of opposite outermost build rows", async () => {
    const pa = player("a");
    const pb = player("b");
    expect(pa.preparationSide).toBe("negative");
    expect(pb.preparationSide).toBe("positive");
    expect(pa.x).toBeCloseTo(NEG.spawn.x, 1);
    expect(pb.x).toBeCloseTo(POS.spawn.x, 1);
    expect(pa.y).toBeCloseTo(VERTICAL_MOVEMENT.groundY, 1);
    expect(pa.z).toBeCloseTo(0, 1);
    // Rows are the outermost BUILD_BOUNDS columns of the build grid.
    expect(NEG.gridX).toBeLessThan(POS.gridX);
    expect(NEG.minX).toBeLessThan(NEG.maxX);
  });

  it("allows movement inside the preparation row but clamps the whole capsule to it", async () => {
    // A (negative side) runs toward the arena centre for many ticks, then
    // along the row in Z. Movement is ACTIVE during preparation (unlike the
    // old frozen countdown), but can never leave the assigned row.
    let seq = 0;
    for (let i = 0; i < 90; i++) await inputTick(a, seq++, { moveX: -1 }); // world +X
    const pa = player("a");
    expect(pa.x).toBeGreaterThan(NEG.spawn.x); // actively moved
    expect(pa.x).toBeLessThanOrEqual(NEG.maxX); // never left the strip
    expect(pa.x).toBeLessThan(0); // never crossed into the enemy half

    for (let i = 0; i < 60; i++) await inputTick(a, seq++, { moveZ: -1 });
    expect(player("a").z).not.toBeCloseTo(0, 1); // free along the row
    expect(Math.abs(player("a").z)).toBeLessThanOrEqual(NEG.maxZ);

    // B on the positive side likewise.
    let bseq = 0;
    for (let i = 0; i < 90; i++) await inputTick(b, bseq++, { moveX: 1 }); // world −X
    const pb = player("b");
    expect(pb.x).toBeLessThan(POS.spawn.x);
    expect(pb.x).toBeGreaterThanOrEqual(POS.minX);
    expect(pb.x).toBeGreaterThan(0);
  });

  // ─── 3: no pre-combat damage, no ammo spent during preparation ────────────

  it("fire during preparation deals no damage and spends no ammo", async () => {
    const ammoBefore = player("a").ammo;
    for (let i = 0; i < 5; i++) {
      await input(a, i, { lookYaw: Math.PI / 2, primaryFire: true });
      internal.tick();
    }
    expect(player("a").ammo).toBe(ammoBefore);
    expect(player("b").health).toBe(MAX_HEALTH);
    expect(player("b").shield).toBe(MAX_SHIELD);

    // The blocked shots are gone: at GO nothing retroactively fires.
    advance(PREP_TICKS); // preparation completes
    expect(phase()).toBe(MatchPhase.IN_PROGRESS);
    expect(player("a").ammo).toBe(ammoBefore); // stale prep inputs were dropped
    expect(player("b").health).toBe(MAX_HEALTH);
    expect(player("b").shield).toBe(MAX_SHIELD);
  });

  // ─── 4: builds are confined to the assigned row, and SURVIVE the opening ──

  it("accepts same-row placements and rejects out-of-row placements with preparation_zone", async () => {
    const before = room.state.structures.size;

    // Own row (negative column) → accepted during preparation.
    await place(a, 1, { x: NEG.gridX, y: 0, z: 1 });
    expect(room.state.structures.size).toBe(before + 1);

    // Centre of the arena → rejected: not in the assigned preparation row.
    await place(a, 2, { x: 0, y: 0, z: 1 });
    const rejected = sent.filter((s2) => s2.sid === "a" && s2.type === BUILD_EVENTS.STRUCTURE_REJECTED);
    expect(rejected.some((r) => r.payload.reason === "preparation_zone")).toBe(true);
    expect(room.state.structures.size).toBe(before + 1);

    // Enemy row → also rejected.
    await place(a, 3, { x: POS.gridX, y: 0, z: 2 });
    const rejected2 = sent.filter((s2) => s2.sid === "a" && s2.type === BUILD_EVENTS.STRUCTURE_REJECTED);
    expect(rejected2.filter((r) => r.payload.reason === "preparation_zone")).toHaveLength(2);
    expect(room.state.structures.size).toBe(before + 1);
  });

  it("pre-built structures survive the opening and are cleared ONCE at the round boundary", async () => {
    await place(a, 1, { x: NEG.gridX, y: 0, z: 1 });
    const placedIds = [...room.state.structures.keys()];
    expect(placedIds).toHaveLength(1);

    // Opening: preparation ends, structures are NOT cleared.
    advance(PREP_TICKS);
    expect(phase()).toBe(MatchPhase.IN_PROGRESS);
    expect(room.state.structures.size).toBe(1);

    // Round ends on elimination → reset clears every structure exactly once.
    await killB();
    expect(phase()).toBe(MatchPhase.ROUND_ENDED);
    expect(room.state.structures.size).toBe(1); // still standing until reset

    advance(PREP_TICKS + 200); // reset delay → COUNTDOWN → new 8 s prep → GO
    expect(broadcastsOf(MATCH_EVENTS.ROUND_RESET)).toHaveLength(1);
    const destroyed = broadcasts.filter((x) => x.event === ENERGY_EVENTS.STRUCTURE_DESTROYED);
    expect(destroyed).toHaveLength(1); // exactly one cleanup sweep
    expect(destroyed[0].payload.destroyedByPlayerId).toBe("");
    // Cleanup precedes the fresh preparation countdown for the next round.
    expect(broadcastsOf(MATCH_EVENTS.COUNTDOWN_TICK).length).toBeGreaterThan(PREP_TICKS);
  });

  // ─── 5: no timed resolution — fights end on elimination only ──────────────

  it("a long fight past the old round/stall limits stays IN_PROGRESS with no score", async () => {
    advance(PREP_TICKS);
    expect(phase()).toBe(MatchPhase.IN_PROGRESS);

    // Idle for 130 simulated seconds: far beyond the removed ROUND_DURATION
    // and ANTI_STALL_TIMEOUT constants. Nothing may resolve the round.
    advance(130 * TICK_HZ);

    expect(phase()).toBe(MatchPhase.IN_PROGRESS);
    expect(room.state.currentRound).toBe(1);
    expect(room.state.roundScore.get("a")?.value ?? 0).toBe(0);
    expect(room.state.roundScore.get("b")?.value ?? 0).toBe(0);
    expect(broadcastsOf(MATCH_EVENTS.ROUND_OVER)).toHaveLength(0);
    expect(broadcastsOf(MATCH_EVENTS.ROUND_RESET)).toHaveLength(0);
    // No timed-resolution channel exists any more at all.
    const events = new Set(broadcasts.map((x) => x.event));
    expect([...events].some((e) => e.includes("timer") || e.includes("stall"))).toBe(false);
  });

  it("elimination ends the round exactly once and re-opens preparation for the next round", async () => {
    advance(PREP_TICKS);
    expect(phase()).toBe(MatchPhase.IN_PROGRESS);

    await killB();

    expect(phase()).toBe(MatchPhase.ROUND_ENDED);
    expect(broadcastsOf(MATCH_EVENTS.ROUND_OVER)).toHaveLength(1);
    expect(broadcastsOf(MATCH_EVENTS.ROUND_OVER)[0].payload.winnerId).toBe("a");
    expect(room.state.roundScore.get("a")?.value).toBe(1);
    expect(room.state.roundScore.get("b")?.value ?? 0).toBe(0);

    // Reset → fresh, symmetric preparation for the next round.
    // Reset delay may already be partially elapsed (kill resolves mid-tick
    // stream) — run until the reset fires, then verify the fresh countdown.
    let guard = 0;
    while (phase() === MatchPhase.ROUND_ENDED && guard++ < 200) advance(1);
    expect(phase()).toBe(MatchPhase.COUNTDOWN);
    expect(room.state.preparationActive).toBe(false);
    advance(1);
    expect(room.state.preparationActive).toBe(true); // both connected again
    // Both players respawn at their preparation row centres.
    expect(player("a").x).toBeCloseTo(NEG.spawn.x, 1);
    expect(player("b").x).toBeCloseTo(POS.spawn.x, 1);
    expect(player("b").health).toBe(MAX_HEALTH);

    const ticks2 = broadcastsOf(MATCH_EVENTS.COUNTDOWN_TICK);
    const totals = new Set(ticks2.map((t) => t.payload.totalTicks));
    expect(totals).toEqual(new Set([PREP_TICKS])); // same 8 s budget every round
    advance(PREP_TICKS + 1);
    expect(phase()).toBe(MatchPhase.IN_PROGRESS);
    expect(room.state.currentRound).toBe(2);
  });

  // ─── 6: reconnect during preparation cannot bypass the row gate ───────────

  it("a player reconnecting during preparation is clamped back into their row", async () => {
    // A shoves itself to the very edge of its strip (still legal).
    let seq = 0;
    for (let i = 0; i < 90; i++) await inputTick(a, seq++, { moveX: -1 });
    const edge = player("a").x;
    expect(edge).toBeLessThanOrEqual(NEG.maxX);

    // Authoritative drift (spoof scenario): teleport into the open arena and
    // reconnect — the restore clamps back into the assigned row.
    player("a").x = 0;
    room.onLeave(a);
    room.onJoin(a);
    const back = player("a");
    expect(back.preparationSide).toBe("negative");
    expect(back.x).toBeGreaterThanOrEqual(NEG.minX);
    expect(back.x).toBeLessThanOrEqual(NEG.maxX);
  });
});

// ASSAULT_RIFLE import guards the ammo semantics above; also assert the
// preparation constant is the single source of truth for the room default.
describe("BOX_FIGHT_PREPARATION constant", () => {
  it("declares the authoritative 8 second preparation", () => {
    expect(BOX_FIGHT_PREPARATION.durationSeconds).toBe(8);
    expect(ASSAULT_RIFLE).toBeDefined();
  });
});
