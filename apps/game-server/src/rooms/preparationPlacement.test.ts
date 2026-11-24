/**
 * Preparation-phase build placement — authoritative server contract.
 *
 * Build preparation is the reused `COUNTDOWN` lifecycle phase and spans TWO
 * stretches with the SAME placement rules:
 *  - WAITING: the countdown is frozen because not both players are connected
 *    yet (the 8 s clock must never run while a player cannot act); and
 *  - ACTIVE: both clients are connected and the shared 8 s countdown runs.
 *
 * In BOTH stretches a player may build and edit inside their OWN preparation
 * row (the outermost build-grid X row, CONTRACT.md §6); enemy and centre
 * rows are denied with `preparation_zone`, out-of-reach anchors with
 * `out_of_range`, and combat stays blocked. Structures accepted in ANY
 * COUNTDOWN stretch SURVIVE the gates-drop into IN_PROGRESS (lifecycle
 * persistence): cleanup happens once per round boundary, never at the
 * preparation→fight transition.
 *
 * Uses the direct-room pattern of `rotatedPlacement.test.ts` (handlers
 * captured from `onMessage`, physics awaited) — no network stack.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import { BUILD_EVENTS, MatchPhase } from "@buildshift/protocol";
import {
  BUILD_BOUNDS,
  BOX_FIGHT_PREPARATION,
  getPreparationZone,
  getStructureConfig,
} from "@buildshift/game-config";
import { TwoPlayerMovementRoom } from "./TwoPlayerMovementRoom.js";

const TICK_RATE = 30;
const PREP_TICKS = Math.round(BOX_FIGHT_PREPARATION.durationSeconds * TICK_RATE);

describe("preparation-phase placement (own row while waiting/active, persistence across the gate drop)", () => {
  let room: TwoPlayerMovementRoom;
  let internal: any;
  let a: Client;
  let b: Client;
  let handlers: Map<string, (client: Client, message: unknown) => Promise<void> | void>;
  let sequence = 100;

  const rejectionsFor = (client: Client) => (client.send as ReturnType<typeof vi.fn>).mock.calls
    .filter(([type]) => type === BUILD_EVENTS.STRUCTURE_REJECTED)
    .map(([, d]) => d as { sequence: number; reason: string });

  /** Sends one placement request from `c`; returns the outcome and energy delta. */
  const place = async (c: Client, buildType: string, grid: { x: number; y: number; z: number }, rotation: number) => {
    internal.tc += 100; // clear the placement-rate window between requests
    const seq = ++sequence;
    const before = internal.state.players.get(c.sessionId)!.energy;
    await handlers.get(BUILD_EVENTS.PLACEMENT_REQUEST)!(c, { sequence: seq, buildType, grid, rotation });
    const structure = [...internal.bld.structures.values()].find((s: any) => s.createdSequence === seq);
    return {
      structure,
      rejection: rejectionsFor(c).find(r => r.sequence === seq),
      energyDelta: internal.state.players.get(c.sessionId)!.energy - before,
    };
  };

  /** Spin N authoritative ticks WITHOUT letting the room's own clock run. */
  const ticks = (n: number) => { for (let i = 0; i < n; i++) internal.tick(); };

  const NEG_ROW = getPreparationZone("negative").gridX; // = BUILD_BOUNDS.minX
  const POS_ROW = getPreparationZone("positive").gridX; // = BUILD_BOUNDS.maxX

  beforeEach(async () => {
    room = new TwoPlayerMovementRoom();
    internal = room as any;
    a = { sessionId: "a", send: vi.fn() } as unknown as Client;
    b = { sessionId: "b", send: vi.fn() } as unknown as Client;
    await internal.pwp;
    handlers = new Map();
    vi.spyOn(room, "onMessage").mockImplementation(((type: string, fn: any) => { handlers.set(type, fn); }) as any);
    vi.spyOn(room, "setFixedTimestep").mockImplementation(() => {});
    vi.spyOn(room, "broadcast").mockImplementation((() => {}) as any);
    room.clients.push(a, b);
    room.onCreate(); // registers the message handlers through the spy
    room.onJoin(a); // slot 0 → negative row
    room.onJoin(b); // slot 1 → positive row
  });

  afterEach(() => {
    room.onDispose();
    room.clock.clear();
    vi.restoreAllMocks();
  });

  describe("active preparation (both connected, countdown running)", () => {
    it("accepts an own-row placement during COUNTDOWN (and charges energy)", async () => {
      expect(room.state.matchPhase).toBe(MatchPhase.COUNTDOWN);
      const r = await place(a, "wall", { x: NEG_ROW, y: 0, z: 1 }, 0);
      expect(r.rejection).toBeUndefined();
      expect(r.structure?.grid.x).toBe(NEG_ROW);
      expect(r.energyDelta).toBe(-getStructureConfig("wall")!.cost);
      // B prepares at the opposite end and may build there too.
      const rb = await place(b, "floor", { x: POS_ROW, y: 0, z: -1 }, 0);
      expect(rb.rejection).toBeUndefined();
    });

    it("denies the centre and the enemy row with preparation_zone and charges nothing", async () => {
      for (const grid of [{ x: 0, y: 0, z: 0 }, { x: POS_ROW, y: 0, z: 0 }]) {
        const r = await place(a, "floor", grid, 0);
        expect(r.rejection?.reason, JSON.stringify(grid)).toBe("preparation_zone");
        expect(r.structure).toBeUndefined();
        expect(r.energyDelta).toBe(0);
      }
    });

    it("rejects an own-row anchor beyond the shared reach with out_of_range (no energy)", async () => {
      // A spawns at the row centre (x = −10.24, z = 0); the row corner two
      // layers up is hypot(10.24, 7.68) ≈ 12.8 m > the 10.24 m canonical
      // reach. The prep rule passes (own row) so the range rule decides.
      const r = await place(a, "floor", { x: NEG_ROW, y: 2, z: -2 }, 0);
      expect(r.rejection?.reason).toBe("out_of_range");
      expect(r.energyDelta).toBe(0);
      // The near part of the same row is comfortably inside reach.
      expect((await place(a, "floor", { x: NEG_ROW, y: 0, z: -1 }, 0)).rejection).toBeUndefined();
    });

    it("pre-builds SURVIVE the gates drop into IN_PROGRESS (lifecycle persistence)", async () => {
      const r = await place(a, "wall", { x: NEG_ROW, y: 0, z: 0 }, 0);
      expect(r.structure).toBeDefined();
      internal.br(); // the authoritative "preparation ended" transition
      expect(room.state.matchPhase).toBe(MatchPhase.IN_PROGRESS);
      // Same structure, same slots, still mirrored — cleanup only happens at
      // round boundaries, never on the preparation → fight transition.
      expect([...internal.bld.structures.values()]).toEqual([expect.objectContaining({ buildType: "wall" })]);
      expect(internal.occ.size).toBeGreaterThan(0);
      // And the fight opens build options the prep row denied (own side is free now).
      expect((await place(a, "floor", { x: 0, y: 0, z: 0 }, 0)).rejection).toBeUndefined();
    });
  });

  describe("waiting for the opponent (single connected client)", () => {
    beforeEach(() => {
      // Drop back to ONE connected client: B is gone (state and client).
      room.clients.length = 0;
      room.clients.push(a);
      room.state.players.delete("b");
      internal.reconnectGrace.clearAll();
    });

    it("keeps the countdown frozen while fewer than two clients are connected", () => {
      expect(internal.ptl).toBe(PREP_TICKS);
      ticks(30);
      expect(internal.ptl).toBe(PREP_TICKS);
      expect(room.state.preparationActive).toBe(false);
      expect(room.state.matchPhase).toBe(MatchPhase.COUNTDOWN);
    });

    it("accepts own-row placement into the waiting phase, then the clock runs once BOTH are back", async () => {
      const r = await place(a, "wall", { x: NEG_ROW, y: 0, z: -1 }, 0);
      expect(r.rejection).toBeUndefined();
      expect(r.structure?.grid.x).toBe(NEG_ROW);
      // Reconnect the second client: the 8 s countdown starts fairly.
      room.clients.push(b);
      room.onJoin(b);
      ticks(3);
      expect(internal.ptl).toBe(PREP_TICKS - 3);
      expect(room.state.preparationActive).toBe(true);
    });

    it("still denies enemy/centre rows while waiting (preparation_zone)", async () => {
      const r = await place(a, "floor", { x: POS_ROW, y: 0, z: 0 }, 0);
      expect(r.rejection?.reason).toBe("preparation_zone");
      expect(r.energyDelta).toBe(0);
    });
  });

  it("refuses placement outside COUNTDOWN/IN_PROGRESS (MATCH_ENDED)", async () => {
    room.state.matchPhase = MatchPhase.MATCH_ENDED;
    const r = await place(a, "floor", { x: NEG_ROW, y: 0, z: 0 }, 0);
    expect(r.rejection).toBeDefined();
    expect(r.structure).toBeUndefined();
    expect(r.energyDelta).toBe(0);
  });

  it("preparation rows are the outermost build-grid columns (bounds sanity)", () => {
    expect(NEG_ROW).toBe(BUILD_BOUNDS.minX);
    expect(POS_ROW).toBe(BUILD_BOUNDS.maxX);
  });
});
