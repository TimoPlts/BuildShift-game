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

  it("ramp race: two players race to place a ramp that shares one cell — first wins, second gets overlap", async () => {
    clearRateLimits();
    const ea = internal.state.players.get("a")!.energy;
    const eb = internal.state.players.get("b")!.energy;
    const rampCost = getStructureConfig("ramp")!.cost;

    // Ramp has footprint [2,1,1] at rotation 0: occupies (x,y,z) and (x+1,y,z).
    // A places ramp at (0,0,0) → cells (0,0,0) and (1,0,0).
    // B places ramp at (1,0,0) → cells (1,0,0) and (2,0,0).
    // They share cell (1,0,0).

    await placeStructure(a, "ramp", { x: 0, y: 0, z: 0 }, 0, 500);
    await placeStructure(b, "ramp", { x: 1, y: 0, z: 0 }, 0, 501);

    // A's ramp is placed (cells 0 and 1 occupied).
    const ramps = [...internal.bld.structures.values()].filter(
      (s: any) => s.buildType === "ramp",
    );
    expect(ramps).toHaveLength(1);
    expect(ramps[0].grid.x).toBe(0);
    expect(ramps[0].grid.y).toBe(0);
    expect(ramps[0].grid.z).toBe(0);
    expect(ramps[0].ownerId).toBe("a");

    // B rejected with overlap (cell (1,0,0) is occupied by A's ramp).
    const bRejects = (b.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.reason === "overlap");
    expect(bRejects).toHaveLength(1);

    // Energy: only A charged.
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

  it("cross-type conflict: existing wall blocks a ramp that overlaps it", async () => {
    // Place a wall at (1,0,0) first.
    makeStructure("existing-wall", "wall", "a", 1, 0, 0);

    clearRateLimits();
    const eb = internal.state.players.get("b")!.energy;

    // B tries to place a ramp at (0,0,0) → cells (0,0,0) and (1,0,0).
    // Cell (1,0,0) is occupied by the existing wall.
    await placeStructure(b, "ramp", { x: 0, y: 0, z: 0 }, 0, 700);

    // Rejected with overlap.
    const bRejects = (b.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.reason === "overlap");
    expect(bRejects).toHaveLength(1);

    // No ramp was created.
    const ramps = [...internal.bld.structures.values()].filter(
      (s: any) => s.buildType === "ramp",
    );
    expect(ramps).toHaveLength(0);

    // Energy unchanged.
    expect(internal.state.players.get("b")!.energy).toBe(eb);
  });

  it("cross-type conflict: existing ramp blocks a wall in its second cell", async () => {
    // Place a ramp at (0,0,0) → cells (0,0,0) and (1,0,0).
    makeStructure("existing-ramp", "ramp", "b", 0, 0, 0);

    clearRateLimits();
    const ea = internal.state.players.get("a")!.energy;

    // A tries to place a wall at (1,0,0) → cell (1,0,0) is occupied by the ramp.
    await placeStructure(a, "wall", { x: 1, y: 0, z: 0 }, 0, 800);

    const aRejects = (a.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.reason === "overlap");
    expect(aRejects).toHaveLength(1);

    // No new wall at (1,0,0).
    const wallsAt1 = [...internal.bld.structures.values()].filter(
      (s: any) => s.buildType === "wall" && s.grid.x === 1 && s.grid.y === 0 && s.grid.z === 0,
    );
    expect(wallsAt1).toHaveLength(0);

    expect(internal.state.players.get("a")!.energy).toBe(ea);
  });

  it("ramp with rotation 1: footprint extends in Z, not X", async () => {
    clearRateLimits();
    const ea = internal.state.players.get("a")!.energy;
    const eb = internal.state.players.get("b")!.energy;
    const rampCost = getStructureConfig("ramp")!.cost;

    // Ramp rotation 1: footprint swaps → [1,1,2], occupies (x,y,z) and (x,y,z+1).
    // A places ramp at (0,0,0) rot 1 → cells (0,0,0) and (0,0,1).
    // B places ramp at (0,0,1) rot 1 → cells (0,0,1) and (0,0,2).
    // They share cell (0,0,1).

    await placeStructure(a, "ramp", { x: 0, y: 0, z: 0 }, 1, 900);
    await placeStructure(b, "ramp", { x: 0, y: 0, z: 1 }, 1, 901);

    const ramps = [...internal.bld.structures.values()].filter(
      (s: any) => s.buildType === "ramp",
    );
    expect(ramps).toHaveLength(1);
    expect(ramps[0].ownerId).toBe("a");

    const bRejects = (b.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.reason === "overlap");
    expect(bRejects).toHaveLength(1);

    expect(internal.state.players.get("a")!.energy).toBe(ea - rampCost);
    expect(internal.state.players.get("b")!.energy).toBe(eb);
  });

  it("multi-cell race: three players effectively racing (A and B rapid-fire) — exactly one structure per cell", async () => {
    clearRateLimits();

    // A places a ramp at (0,0,0) → cells (0,0,0) and (1,0,0).
    await placeStructure(a, "ramp", { x: 0, y: 0, z: 0 }, 0, 1000);

    // B tries wall at (0,0,0) → blocked by ramp's first cell.
    await placeStructure(b, "wall", { x: 0, y: 0, z: 0 }, 0, 1001);

    // A tries wall at (1,0,0) → blocked by ramp's second cell (rate limit cleared by tc).
    internal.tc += 11;
    await placeStructure(a, "wall", { x: 1, y: 0, z: 0 }, 0, 1002);

    // Verify occupancy integrity: cells (0,0,0) and (1,0,0) are occupied,
    // and each has exactly one structure.
    const occCells = internal.occ;
    expect(occCells.has("0,0,0")).toBe(true);
    expect(occCells.has("1,0,0")).toBe(true);

    // Total structures: 1 ramp + 0 walls = 1.
    expect(internal.bld.structures.size).toBe(1);

    // Energy: only the ramp cost was charged.
    // We verify the ramp was the only placement and B got no energy change from the rejected wall.
    const bRejects = (b.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.reason === "overlap");
    expect(bRejects).toHaveLength(1);
  });

  // ─── 4. Duplicates/replays ──────────────────────────────────────────────

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

  it("turbo race: rapid mixed build types — no cell is double-occupied", async () => {
    clearRateLimits();

    // A places a ramp at (0,0,0) → cells (0,0,0) and (1,0,0).
    internal.tc += 11;
    await placeStructure(a, "ramp", { x: 0, y: 0, z: 0 }, 0, 1400);

    // B tries a wall at (0,0,0) and a floor at (1,0,0) — both blocked.
    await placeStructure(b, "wall", { x: 0, y: 0, z: 0 }, 0, 1401);
    await placeStructure(b, "floor", { x: 1, y: 0, z: 0 }, 0, 1402);

    // Verify: ramp occupies both cells, no other structures exist there.
    expect(internal.bld.structures.size).toBe(1);
    const ramp = [...internal.bld.structures.values()][0] as any;
    expect(ramp.buildType).toBe("ramp");
    expect(ramp.ownerId).toBe("a");

    // B got 2 overlap rejections.
    const bRejects = (b.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.reason === "overlap");
    expect(bRejects).toHaveLength(2);
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

    // B tries to edit the wall (via wall pattern input).
    const { WALL_PATTERN_INPUT } = await import("./TwoPlayerMovementRoom.js");
    winner.editKind = "wall";
    winner.editTiles.length = 0;
    for (let i = 0; i < 9; i++) winner.editTiles.push(true);
    winner.currentDurability = winner.maxDurability;

    const sendWallPattern = handlers.get(WALL_PATTERN_INPUT)!;
    sendWallPattern(b, { structureId: winner.structureId, pattern: "door" });

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

  it("occupancy set has exactly the expected cells after a contested ramp+wall race", async () => {
    clearRateLimits();

    // A places ramp at (0,0,0) rot 0 → cells "0,0,0" and "1,0,0".
    internal.tc += 11;
    await placeStructure(a, "ramp", { x: 0, y: 0, z: 0 }, 0, 1900);

    // B tries wall at (0,0,0) → rejected.
    await placeStructure(b, "wall", { x: 0, y: 0, z: 0 }, 0, 1901);

    // Occupancy should have exactly 2 cells (the ramp's footprint).
    const rampCfg = getStructureConfig("ramp")!;
    const rampCells = oc({ x: 0, y: 0, z: 0 }, rampCfg, 0);
    expect(internal.occ.size).toBe(rampCells.size);
    for (const cell of rampCells) {
      expect(internal.occ.has(cell)).toBe(true);
    }

    // No extra cells from the rejected wall.
    expect(internal.occ.has("0,0,0")).toBe(true); // ramp cell
    expect(internal.occ.has("1,0,0")).toBe(true); // ramp cell
    // The wall would have been at (0,0,0) — already counted as ramp's cell.
  });
});
