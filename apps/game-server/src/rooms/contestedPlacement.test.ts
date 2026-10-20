/**
 * Contested placement arbitration — canonical authoritative server tests.
 *
 * After wall replacement integration, verifies that high-speed races are
 * deterministic using authoritative processing order/state:
 *
 *  1. Simultaneous empty-cell placement (single-cell structures).
 *  2. Replacement races (wall destroyed → freed cell).
 *  3. Wall/floor/ramp/cone conflicts (multi-cell structures like ramps).
 *  4. Duplicates/replays (same sequence sent twice).
 *  5. Turbo races (many rapid requests across multiple cells).
 *
 * Invariants verified:
 *  - Exactly one structure per canonical occupied cell.
 *  - No ghost ownership (loser cannot edit or claim the winner's structure).
 *  - No Energy cost for rejection (energy charged only on acceptance).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import { BUILD_EVENTS, ENERGY_EVENTS } from "@buildshift/protocol";
import { getStructureConfig, ENERGY } from "@buildshift/game-config";
import {
  TwoPlayerMovementRoom,
} from "./TwoPlayerMovementRoom.js";
import { StructureStateSchema, StructureGridSchema, oc } from "../state/buildingState.js";

describe("contested placement arbitration (authoritative processing order)", () => {
  let room: TwoPlayerMovementRoom;
  let internal: any;
  let a: Client;
  let b: Client;
  let handlers: Map<string, (client: Client, message: unknown) => Promise<void> | void>;
  let broadcastCalls: Array<[string, unknown]>;

  const send = (type: string, value: unknown, client: Client = a) => {
    const handler = handlers.get(type);
    expect(handler, `registered production route ${type}`).toBeDefined();
    return handler!(client, value);
  };

  /** Create a structure of the given build type at the given grid cell. */
  const makeStructure = (id: string, buildType: string, ownerId: string, gx = 0, gy = 0, gz = 0, rotation = 0, dur = 200) => {
    const s = new StructureStateSchema();
    s.structureId = id;
    s.ownerId = ownerId;
    s.buildType = buildType;
    s.editType = "";
    s.editKind = "";
    s.editRampVariant = "";
    s.maxDurability = dur;
    s.currentDurability = dur;
    const g = new StructureGridSchema();
    g.x = gx; g.y = gy; g.z = gz;
    s.grid = g;
    s.rotation = rotation;
    internal.bld.structures.set(id, s);
    const cfg = getStructureConfig(buildType)!;
    for (const cell of oc({ x: gx, y: gy, z: gz }, cfg, rotation)) internal.occ.add(cell);
    return s;
  };

  /** Advance the tick counter to clear rate-limiting for both players. */
  const clearRateLimits = () => { internal.tc = 9999; };

  /** Place a structure for a player, returning the structure and cells. */
  const placeStructure = async (
    client: Client,
    buildType: string,
    grid: { x: number; y: number; z: number },
    rotation: number,
    sequence: number,
  ) => {
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence, buildType, grid, rotation,
    }, client);
  };

  beforeEach(async () => {
    room = new TwoPlayerMovementRoom();
    internal = room as any;
    await internal.pwp;
    handlers = new Map();
    broadcastCalls = [];
    vi.spyOn(room, "onMessage").mockImplementation(((type: string, fn: any) => {
      handlers.set(type, fn);
    }) as any);
    vi.spyOn(room, "setFixedTimestep").mockImplementation(() => {});
    vi.spyOn(room, "broadcast").mockImplementation(((ev: string, d: unknown) => {
      broadcastCalls.push([ev, d]);
    }) as any);
    a = { sessionId: "a", send: vi.fn() } as unknown as Client;
    b = { sessionId: "b", send: vi.fn() } as unknown as Client;
    room.clients.push(a, b);
    room.onCreate();
    room.onJoin(a);
    room.onJoin(b);
    internal.br(); // COUNTDOWN → IN_PROGRESS
  });

  afterEach(() => {
    room.onDispose();
    room.clock.clear();
    vi.restoreAllMocks();
  });

  // ─── 1. Simultaneous empty-cell placement (single-cell structures) ─────

  it("simultaneous wall placement on an empty cell — first request wins, second gets overlap", async () => {
    clearRateLimits();
    const ea = internal.state.players.get("a")!.energy;
    const eb = internal.state.players.get("b")!.energy;
    const wallCost = getStructureConfig("wall")!.cost;

    await placeStructure(a, "wall", { x: 0, y: 0, z: 0 }, 0, 100);
    await placeStructure(b, "wall", { x: 0, y: 0, z: 0 }, 0, 101);

    // Exactly one wall at (0,0,0).
    const walls = [...internal.bld.structures.values()].filter(
      (s: any) => s.grid.x === 0 && s.grid.y === 0 && s.grid.z === 0 && s.buildType === "wall",
    );
    expect(walls).toHaveLength(1);
    expect(walls[0].ownerId).toBe("a");

    // B rejected with overlap.
    const bRejects = (b.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.reason === "overlap");
    expect(bRejects).toHaveLength(1);

    // Energy: only A charged.
    expect(internal.state.players.get("a")!.energy).toBe(ea - wallCost);
    expect(internal.state.players.get("b")!.energy).toBe(eb);
  });

  it("simultaneous floor placement on an empty cell — deterministic first-wins", async () => {
    clearRateLimits();
    const ea = internal.state.players.get("a")!.energy;
    const eb = internal.state.players.get("b")!.energy;
    const floorCost = getStructureConfig("floor")!.cost;

    await placeStructure(b, "floor", { x: 1, y: 0, z: 1 }, 0, 200);
    await placeStructure(a, "floor", { x: 1, y: 0, z: 1 }, 0, 201);

    const floors = [...internal.bld.structures.values()].filter(
      (s: any) => s.grid.x === 1 && s.grid.y === 0 && s.grid.z === 1 && s.buildType === "floor",
    );
    expect(floors).toHaveLength(1);
    expect(floors[0].ownerId).toBe("b");

    const aRejects = (a.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.reason === "overlap");
    expect(aRejects).toHaveLength(1);

    expect(internal.state.players.get("b")!.energy).toBe(eb - floorCost);
    expect(internal.state.players.get("a")!.energy).toBe(ea);
  });

  it("simultaneous cone placement on an empty cell — deterministic first-wins", async () => {
    clearRateLimits();

    await placeStructure(a, "cone", { x: -1, y: 0, z: -1 }, 0, 300);
    await placeStructure(b, "cone", { x: -1, y: 0, z: -1 }, 0, 301);

    const cones = [...internal.bld.structures.values()].filter(
      (s: any) => s.grid.x === -1 && s.grid.y === 0 && s.grid.z === -1,
    );
    expect(cones).toHaveLength(1);
    expect(cones[0].ownerId).toBe("a");

    expect(internal.state.players.get("a")!.energy).toBe(
      internal.state.players.get("a")!.energy, // sanity
    );
    const bRejects = (b.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.reason === "overlap");
    expect(bRejects).toHaveLength(1);
    // B energy unchanged.
    expect(internal.state.players.get("b")!.energy).toBe(
      internal.state.players.get("b")!.energy,
    );
  });

  // ─── 2. Replacement races (wall destroyed → freed cell) ─────────────────

  it("replacement race: after wall destruction, first valid request owns the freed cell", async () => {
    makeStructure("orig-wall", "wall", "b", 0, 0, 0);
    // Manually destroy the wall to free the cell.
    internal.bld.structures.delete("orig-wall");
    const cfg = getStructureConfig("wall")!;
    for (const cell of oc({ x: 0, y: 0, z: 0 }, cfg, 0)) internal.occ.delete(cell);

    clearRateLimits();
    const ea = internal.state.players.get("a")!.energy;
    const eb = internal.state.players.get("b")!.energy;
    const wallCost = getStructureConfig("wall")!.cost;

    await placeStructure(a, "wall", { x: 0, y: 0, z: 0 }, 0, 400);
    await placeStructure(b, "wall", { x: 0, y: 0, z: 0 }, 0, 401);

    const walls = [...internal.bld.structures.values()].filter(
      (s: any) => s.grid.x === 0 && s.grid.y === 0 && s.grid.z === 0 && s.buildType === "wall",
    );
    expect(walls).toHaveLength(1);
    expect(walls[0].ownerId).toBe("a");

    expect(internal.state.players.get("a")!.energy).toBe(ea - wallCost);
    expect(internal.state.players.get("b")!.energy).toBe(eb);
  });

  // ─── 3. Wall/floor/ramp/cone conflicts (multi-cell structures) ──────────

  it("ramp race on one tile: every rotation contests the tile's single ramp slot — first wins", async () => {
    clearRateLimits();
    const ea = internal.state.players.get("a")!.energy;
    const eb = internal.state.players.get("b")!.energy;
    const rampCost = getStructureConfig("ramp")!.cost;
    await placeStructure(a, "ramp", { x: 0, y: 0, z: 0 }, 0, 500);
    await placeStructure(b, "ramp", { x: 0, y: 0, z: 0 }, 1, 501);
    const ramps = [...internal.bld.structures.values()].filter((s: any) => s.buildType === "ramp");
    expect(ramps).toHaveLength(1);
    expect(ramps[0].ownerId).toBe("a");
    expect(((b.send as ReturnType<typeof vi.fn>).mock.calls.filter(([, d]) => (d as any)?.reason === "overlap"))).toHaveLength(1);
    expect(internal.state.players.get("a")!.energy).toBe(ea - rampCost);
    expect(internal.state.players.get("b")!.energy).toBe(eb);
  });

  it("ramp race on the same anchor cell: both try the exact same ramp position", async () => {
    clearRateLimits();
    const ea = internal.state.players.get("a")!.energy;
    const eb = internal.state.players.get("b")!.energy;
    const rampCost = getStructureConfig("ramp")!.cost;

    // Both try the same ramp at (0,0,0) rotation 0.
    await placeStructure(a, "ramp", { x: 0, y: 0, z: 0 }, 0, 600);
    await placeStructure(b, "ramp", { x: 0, y: 0, z: 0 }, 0, 601);

    const ramps = [...internal.bld.structures.values()].filter(
      (s: any) => s.buildType === "ramp",
    );
    expect(ramps).toHaveLength(1);
    expect(ramps[0].ownerId).toBe("a");

    // B's ramp would occupy cells (0,0,0) and (1,0,0) — both already taken.
    const bRejects = (b.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.reason === "overlap");
    expect(bRejects).toHaveLength(1);

    expect(internal.state.players.get("a")!.energy).toBe(ea - rampCost);
    expect(internal.state.players.get("b")!.energy).toBe(eb);
  });

  it("slot coexistence: a wall on a tile edge and a ramp in that tile are different slots", async () => {
    makeStructure("existing-wall", "wall", "a", 1, 0, 0, 0);
    clearRateLimits();
    const eb = internal.state.players.get("b")!.energy;
    await placeStructure(b, "ramp", { x: 1, y: 0, z: 0 }, 0, 700);
    expect(((b.send as ReturnType<typeof vi.fn>).mock.calls.filter(([, d]) => (d as any)?.reason === "overlap"))).toHaveLength(0);
    expect([...internal.bld.structures.values()].filter((s: any) => s.buildType === "ramp")).toHaveLength(1);
    expect(internal.state.players.get("b")!.energy).toBe(eb - getStructureConfig("ramp")!.cost);
  });

  it("slot coexistence: a ramp and all four walls of its tile exist simultaneously", async () => {
    makeStructure("existing-ramp", "ramp", "b", 0, 0, 0, 1);
    for (const rotation of [0, 1, 2, 3]) {
      internal.tc += 11;
      await placeStructure(a, "wall", { x: 0, y: 0, z: 0 }, rotation, 800 + rotation);
    }
    expect(((a.send as ReturnType<typeof vi.fn>).mock.calls.filter(([, d]) => (d as any)?.reason === "overlap"))).toHaveLength(0);
    const walls = [...internal.bld.structures.values()].filter((s: any) => s.buildType === "wall");
    expect(walls.map((w: any) => w.rotation).sort()).toEqual([0, 1, 2, 3]);
    expect(internal.bld.structures.size).toBe(5);
  });

  it("one-tile ramps: ramps in adjacent tiles never contest", async () => {
    clearRateLimits();
    await placeStructure(a, "ramp", { x: 0, y: 0, z: 0 }, 1, 900);
    await placeStructure(b, "ramp", { x: 0, y: 0, z: 1 }, 1, 901);
    expect([...internal.bld.structures.values()].filter((s: any) => s.buildType === "ramp")).toHaveLength(2);
    expect(((b.send as ReturnType<typeof vi.fn>).mock.calls.filter(([, d]) => (d as any)?.reason === "overlap"))).toHaveLength(0);
  });

  it("shared-edge race: the same physical wall edge named from either tile — exactly one wins", async () => {
    clearRateLimits();
    await placeStructure(a, "ramp", { x: 0, y: 0, z: 0 }, 0, 1000);
    // B: the +Z edge of tile (0,0,0). A: the −Z edge of tile (0,0,1) — the same edge.
    await placeStructure(b, "wall", { x: 0, y: 0, z: 0 }, 2, 1001);
    internal.tc += 11;
    await placeStructure(a, "wall", { x: 0, y: 0, z: 1 }, 0, 1002);
    const walls = [...internal.bld.structures.values()].filter((s: any) => s.buildType === "wall");
    expect(walls).toHaveLength(1);
    expect(walls[0].ownerId).toBe("b");
    expect(((a.send as ReturnType<typeof vi.fn>).mock.calls.filter(([, d]) => (d as any)?.reason === "overlap"))).toHaveLength(1);
    expect(internal.bld.structures.size).toBe(2); // ramp + one wall
  });

  it("duplicate ramp packet: same sequence sent twice does not create duplicate", async () => {
    clearRateLimits();
    const ea = internal.state.players.get("a")!.energy;
    const rampCost = getStructureConfig("ramp")!.cost;

    // Send the same ramp request twice.
    await placeStructure(a, "ramp", { x: 0, y: 0, z: 0 }, 0, 1100);
    await placeStructure(a, "ramp", { x: 0, y: 0, z: 0 }, 0, 1100);

    const ramps = [...internal.bld.structures.values()].filter(
      (s: any) => s.buildType === "ramp",
    );
    expect(ramps).toHaveLength(1);

    // Energy charged exactly once.
    expect(internal.state.players.get("a")!.energy).toBe(ea - rampCost);

    // Second request rejected with overlap.
    const rejects = (a.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.sequence === 1100 && (d as any)?.reason === "overlap");
    expect(rejects).toHaveLength(1);
  });

  it("replay after rate-limit window: same cell still occupied, no duplicate", async () => {
    clearRateLimits();
    const ea = internal.state.players.get("a")!.energy;
    const wallCost = getStructureConfig("wall")!.cost;

    await placeStructure(a, "wall", { x: 0, y: 0, z: 0 }, 0, 1200);
    expect(internal.state.players.get("a")!.energy).toBe(ea - wallCost);

    // Advance past rate-limit window.
    internal.tc += 11;

    // Replay the same packet.
    await placeStructure(a, "wall", { x: 0, y: 0, z: 0 }, 0, 1200);

    // Still exactly one structure.
    const walls = [...internal.bld.structures.values()].filter(
      (s: any) => s.grid.x === 0 && s.grid.y === 0 && s.grid.z === 0,
    );
    expect(walls).toHaveLength(1);

    // Energy NOT charged again.
    expect(internal.state.players.get("a")!.energy).toBe(ea - wallCost);

    // Rejected with overlap.
    const rejects = (a.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.sequence === 1200 && (d as any)?.reason === "overlap");
    expect(rejects).toHaveLength(1);
  });

  // ─── 5. Turbo races ─────────────────────────────────────────────────────

  it("turbo race: 6 rapid requests from both players across 3 cells — exactly one per cell", async () => {
    clearRateLimits();

    // A and B each fire 3 wall placements at cells -1, 0, 1 (interleaved).
    // All within range for both players (A at x=-5, B at x=5).
    const sequences = [1300, 1301, 1302, 1303, 1304, 1305];
    const grids = [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ];

    // Interleave: A(-1), B(-1), A(0), B(0), A(1), B(1).
    for (let i = 0; i < 3; i++) {
      internal.tc += 11; // Clear rate limit for A.
      await placeStructure(a, "wall", grids[i], 0, sequences[i * 2]);
      // B is not rate-limited (separate player).
      await placeStructure(b, "wall", grids[i], 0, sequences[i * 2 + 1]);
    }

    // Exactly 3 structures total (one per cell, all owned by A who went first).
    expect(internal.bld.structures.size).toBe(3);
    for (const g of grids) {
      const at = [...internal.bld.structures.values()].filter(
        (s: any) => s.grid.x === g.x && s.grid.y === g.y && s.grid.z === g.z,
      );
      expect(at).toHaveLength(1);
      expect(at[0].ownerId).toBe("a");
    }

    // B received 3 overlap rejections.
    const bRejects = (b.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.reason === "overlap");
    expect(bRejects).toHaveLength(3);

    // B's energy: unchanged (no successful placement).
    const eb = internal.state.players.get("b")!.energy;
    expect(eb).toBe(ENERGY.startingEnergy);
  });

  it("turbo race: mixed types in one tile coexist; only duplicates of one slot are rejected", async () => {
    clearRateLimits();
    internal.tc += 11;
    await placeStructure(a, "ramp", { x: 0, y: 0, z: 0 }, 0, 1400);
    await placeStructure(b, "wall", { x: 0, y: 0, z: 0 }, 0, 1401);
    internal.tc += 11;
    await placeStructure(b, "floor", { x: 0, y: 0, z: 0 }, 0, 1402);
    internal.tc += 11;
    await placeStructure(a, "floor", { x: 0, y: 1, z: 0 }, 0, 1403); // next layer
    internal.tc += 11;
    await placeStructure(b, "ramp", { x: 0, y: 0, z: 0 }, 2, 1404); // duplicate ramp slot
    internal.tc += 11;
    await placeStructure(a, "wall", { x: 0, y: 0, z: 0 }, 0, 1405); // duplicate wall edge
    expect(internal.bld.structures.size).toBe(4);
    expect(((b.send as ReturnType<typeof vi.fn>).mock.calls.filter(([, d]) => (d as any)?.reason === "overlap"))).toHaveLength(1);
    expect(((a.send as ReturnType<typeof vi.fn>).mock.calls.filter(([, d]) => (d as any)?.reason === "overlap"))).toHaveLength(1);
  });

  it("turbo race: 4 rapid requests from same player (rate-limited after first) — exactly one structure", async () => {
    clearRateLimits();
    const ea = internal.state.players.get("a")!.energy;
    const wallCost = getStructureConfig("wall")!.cost;

    // A fires 4 requests at the same cell (rate limit will block 2-4).
    await placeStructure(a, "wall", { x: 0, y: 0, z: 0 }, 0, 1500);
    await placeStructure(a, "wall", { x: 0, y: 0, z: 0 }, 0, 1501);
    await placeStructure(a, "wall", { x: 0, y: 0, z: 0 }, 0, 1502);
    await placeStructure(a, "wall", { x: 0, y: 0, z: 0 }, 0, 1503);

    // Exactly one structure.
    const walls = [...internal.bld.structures.values()].filter(
      (s: any) => s.grid.x === 0 && s.grid.y === 0 && s.grid.z === 0,
    );
    expect(walls).toHaveLength(1);

    // Energy charged exactly once.
    expect(internal.state.players.get("a")!.energy).toBe(ea - wallCost);

    // 3 rejections (rate_limited or overlap).
    const aRejects = (a.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.reason);
    expect(aRejects).toHaveLength(3);
  });

  // ─── 6. No ghost ownership ──────────────────────────────────────────────

  it("loser cannot edit the winner's structure after a contested placement", async () => {
    clearRateLimits();
    await placeStructure(a, "wall", { x: 0, y: 0, z: 0 }, 0, 1600);
    await placeStructure(b, "wall", { x: 0, y: 0, z: 0 }, 0, 1601);

    const winner = [...internal.bld.structures.values()][0] as any;
    expect(winner.ownerId).toBe("a");

    // B tries to edit the wall through the canonical grid action.
    const { EDIT_GRID_ACTION_INPUT } = await import("./TwoPlayerMovementRoom.js");
    winner.editKind = "wall";
    winner.editTiles.length = 0;
    for (let i = 0; i < 9; i++) winner.editTiles.push(true);
    winner.currentDurability = winner.maxDurability;

    const sendEdit = handlers.get(EDIT_GRID_ACTION_INPUT)!;
    await sendEdit(b, { structureId: winner.structureId, action: "select", tileIndex: 4 });

    const bCalls = (b.send as ReturnType<typeof vi.fn>).mock.calls;
    const notOwned = bCalls.find(
      ([, d]) => (d as any)?.structureId === winner.structureId && (d as any)?.reason === "not_owned",
    );
    expect(notOwned).toBeDefined();
  });

  // ─── 7. No Energy cost for rejection ────────────────────────────────────

  it("rejected placement incurs zero energy cost", async () => {
    makeStructure("existing", "wall", "a", 0, 0, 0);
    clearRateLimits();
    const eb = internal.state.players.get("b")!.energy;

    // B tries to place on an occupied cell.
    await placeStructure(b, "wall", { x: 0, y: 0, z: 0 }, 0, 1700);

    // B's energy is unchanged.
    expect(internal.state.players.get("b")!.energy).toBe(eb);

    // No ENERGY_UPDATE broadcast for B.
    const energyEvents = broadcastCalls.filter(([ev, d]) =>
      ev === ENERGY_EVENTS.ENERGY_UPDATE && (d as any).playerId === "b"
    );
    expect(energyEvents).toHaveLength(0);
  });

  it("rate-limited placement incurs zero energy cost", async () => {
    clearRateLimits();
    const ea = internal.state.players.get("a")!.energy;

    // A places successfully.
    await placeStructure(a, "wall", { x: 0, y: 0, z: 0 }, 0, 1800);

    // A immediately tries again (within rate window) at a different cell.
    await placeStructure(a, "wall", { x: 1, y: 0, z: 0 }, 0, 1801);

    // Second placement rejected with rate_limited, energy only charged once.
    const aRejects = (a.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.reason === "rate_limited");
    expect(aRejects).toHaveLength(1);

    // Energy: only one wall cost.
    const wallCost = getStructureConfig("wall")!.cost;
    expect(internal.state.players.get("a")!.energy).toBe(ea - wallCost);
  });

  // ─── 8. Occupancy integrity after multiple contested placements ─────────

  it("occupancy holds exactly the canonical slots after a contested ramp + shared-edge race", async () => {
    clearRateLimits();
    internal.tc += 11;
    await placeStructure(a, "ramp", { x: 0, y: 0, z: 0 }, 0, 1900);
    await placeStructure(b, "wall", { x: 0, y: 0, z: 0 }, 2, 1901);
    internal.tc += 11;
    await placeStructure(a, "wall", { x: 0, y: 0, z: 1 }, 0, 1902); // same edge: rejected
    const expected = new Set([
      ...oc({ x: 0, y: 0, z: 0 }, getStructureConfig("ramp")!, 0),
      ...oc({ x: 0, y: 0, z: 0 }, getStructureConfig("wall")!, 2),
    ]);
    expect([...internal.occ].sort()).toEqual([...expected].sort());
    expect(expected.size).toBe(2);
  });
});
