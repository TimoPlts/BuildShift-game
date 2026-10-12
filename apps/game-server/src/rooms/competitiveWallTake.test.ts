/**
 * Competitive wall-take and replacement — canonical authoritative server tests.
 *
 * Verifies that when a wall is destroyed:
 *  1. Occupancy is freed immediately.
 *  2. Either player may attempt the freed cell.
 *  3. The first valid authoritative request creates exactly one replacement
 *     owned by its builder.
 *  4. The loser receives a deterministic rejection ("overlap").
 *  5. Only the accepted placement charges Energy.
 *
 * Covers: two-player races, repeated packets, no duplicate structures, and
 * ownership/edit permission after replacement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import { BUILD_EVENTS, ENERGY_EVENTS } from "@buildshift/protocol";
import { getStructureConfig } from "@buildshift/game-config";
import {
  TwoPlayerMovementRoom,
  TWO_PLAYER_MOVEMENT_INPUT,
  WALL_PATTERN_INPUT,
  WALL_PATTERN_RESULT,
} from "./TwoPlayerMovementRoom.js";
import { StructureStateSchema, StructureGridSchema, oc } from "../state/buildingState.js";

describe("competitive wall-take and replacement (canonical authoritative path)", () => {
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

  const fire = (client: Client, sequence: number, yaw = 0, pitch = 0) => {
    send(TWO_PLAYER_MOVEMENT_INPUT, {
      sequence, moveX: 0, moveZ: 0, lookYaw: yaw, lookPitch: pitch,
      jump: false, primaryFire: true,
    }, client);
    internal.tick();
  };

  /** Create a wall at the given grid cell owned by `ownerId`. */
  const makeWall = (id: string, ownerId: string, gx = 0, gy = 0, gz = 0, dur = 200) => {
    const s = new StructureStateSchema();
    s.structureId = id;
    s.ownerId = ownerId;
    s.buildType = "wall";
    s.editType = "";
    s.editKind = "";
    s.editRampVariant = "";
    s.maxDurability = dur;
    s.currentDurability = dur;
    const g = new StructureGridSchema();
    g.x = gx; g.y = gy; g.z = gz;
    s.grid = g;
    s.rotation = 0;
    internal.bld.structures.set(id, s);
    // Register the occupancy cells.
    const cfg = getStructureConfig("wall")!;
    for (const cell of oc({ x: gx, y: gy, z: gz }, cfg, 0)) internal.occ.add(cell);
    return s;
  };

  /** Advance the tick counter to clear rate-limiting for both players. */
  const clearRateLimits = () => { internal.tc = 9999; };

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

  // ─── 1. Occupancy is freed on destruction ─────────────────────────────────

  it("frees occupancy cells when a wall is destroyed by fire", () => {
    makeWall("w1", "b", 0, 0, 0);
    const cfg = getStructureConfig("wall")!;
    const cells = oc({ x: 0, y: 0, z: 0 }, cfg, 0);
    // Confirm the cell is occupied before destruction.
    for (const cell of cells) expect(internal.occ.has(cell)).toBe(true);

    // Destroy the wall: set durability to 1 so one shot kills it.
    const s = internal.bld.structures.get("w1")!;
    s.currentDurability = 1;
    // Player a fires at the wall. Player a is at (-5, 0, 0); the wall is at
    // grid (0,0,0) → world collider centre ≈(0, 1.92, 0).
    // Aiming from x=-5 toward +X (yaw=π/2) with a slight upward pitch hits it.
    fire(a, 1, Math.PI / 2, 0.2);

    // Structure is gone and cells are freed.
    expect(internal.bld.structures.get("w1")).toBeUndefined();
    for (const cell of cells) expect(internal.occ.has(cell)).toBe(false);
  });

  // ─── 2. Two-player race: first valid request wins ────────────────────────

  it("two-player race on a freed cell — first request wins, second gets overlap", async () => {
    // B builds a wall at (0,0,0) which A will destroy.
    makeWall("orig", "b", 0, 0, 0);
    const s = internal.bld.structures.get("orig")!;
    s.currentDurability = 1;
    fire(a, 1, Math.PI / 2, 0.2);
    expect(internal.bld.structures.get("orig")).toBeUndefined();

    // Clear rate limits so both players can attempt a build.
    clearRateLimits();

    // Both players attempt the same freed cell. A's request is processed first.
    const ea = internal.state.players.get("a")!.energy;
    const eb = internal.state.players.get("b")!.energy;
    const wallCost = getStructureConfig("wall")!.cost;

    // A's placement (processed first).
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 500, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, a);

    // B's placement (processed second — should be rejected).
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 501, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, b);

    // Exactly one structure now exists at cell (0,0,0).
    const structuresAtCell = [...internal.bld.structures.values()].filter(
      (s: any) => s.grid.x === 0 && s.grid.y === 0 && s.grid.z === 0,
    );
    expect(structuresAtCell).toHaveLength(1);
    expect(structuresAtCell[0].ownerId).toBe("a");

    // B received a deterministic "overlap" rejection.
    const bRejections = (b.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.reason === "overlap");
    expect(bRejections.length).toBe(1);
    expect((bRejections[0][1] as any).sequence).toBe(501);

    // Only A's energy was charged.
    const aEnergyAfter = internal.state.players.get("a")!.energy;
    const bEnergyAfter = internal.state.players.get("b")!.energy;
    expect(aEnergyAfter).toBe(ea - wallCost);
    expect(bEnergyAfter).toBe(eb); // unchanged
  });

  it("race is deterministic regardless of which player destroys the wall", async () => {
    // A builds the wall; B destroys it; B's request goes first.
    makeWall("orig", "a", 0, 0, 0);
    const s = internal.bld.structures.get("orig")!;
    s.currentDurability = 1;
    fire(b, 1, -Math.PI / 2, 0.2); // B fires toward -X (toward the wall at origin)
    expect(internal.bld.structures.get("orig")).toBeUndefined();

    clearRateLimits();

    const ea = internal.state.players.get("a")!.energy;
    const eb = internal.state.players.get("b")!.energy;
    const wallCost = getStructureConfig("wall")!.cost;

    // B's request processed first.
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 600, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, b);

    // A's request processed second.
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 601, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, a);

    // B won the race.
    const structuresAtCell = [...internal.bld.structures.values()].filter(
      (s: any) => s.grid.x === 0 && s.grid.y === 0 && s.grid.z === 0,
    );
    expect(structuresAtCell).toHaveLength(1);
    expect(structuresAtCell[0].ownerId).toBe("b");

    // A got overlap.
    const aRejections = (a.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.reason === "overlap");
    expect(aRejections.length).toBe(1);

    // Only B's energy charged.
    expect(internal.state.players.get("b")!.energy).toBe(eb - wallCost);
    expect(internal.state.players.get("a")!.energy).toBe(ea);
  });

  // ─── 3. Repeated packets ─────────────────────────────────────────────────

  it("repeated identical placement packet does not create a duplicate structure", async () => {
    // Player A sends the same placement request twice in quick succession.
    clearRateLimits();
    const ea = internal.state.players.get("a")!.energy;
    const wallCost = getStructureConfig("wall")!.cost;

    // First packet — accepted.
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 700, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, a);

    // Second packet (duplicate/retry of the same logical action).
    // The occupancy check catches this because the first placement already
    // occupies the cell.
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 700, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, a);

    // Exactly one structure exists.
    const structuresAtCell = [...internal.bld.structures.values()].filter(
      (s: any) => s.grid.x === 0 && s.grid.y === 0 && s.grid.z === 0,
    );
    expect(structuresAtCell).toHaveLength(1);
    expect(structuresAtCell[0].ownerId).toBe("a");

    // Energy was charged exactly once.
    expect(internal.state.players.get("a")!.energy).toBe(ea - wallCost);

    // The duplicate was rejected with "overlap" (occupancy check fires first).
    const rejections = (a.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.sequence === 700 && (d as any)?.reason);
    expect(rejections.length).toBe(1);
    expect((rejections[0][1] as any).reason).toBe("overlap");
  });

  it("repeated packet after rate-limit window still gets overlap (not duplicate)", async () => {
    clearRateLimits();
    const ea = internal.state.players.get("a")!.energy;
    const wallCost = getStructureConfig("wall")!.cost;

    // First placement.
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 800, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, a);
    expect(internal.state.players.get("a")!.energy).toBe(ea - wallCost);

    // Advance past the rate-limit window (10 ticks).
    internal.tc = 9999 + 11;

    // Second identical packet — past rate limit, but the cell is still occupied.
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 800, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, a);

    // Still exactly one structure.
    const structuresAtCell = [...internal.bld.structures.values()].filter(
      (s: any) => s.grid.x === 0 && s.grid.y === 0 && s.grid.z === 0,
    );
    expect(structuresAtCell).toHaveLength(1);

    // Energy NOT charged again.
    expect(internal.state.players.get("a")!.energy).toBe(ea - wallCost);

    // Rejected with "overlap" this time (past rate limit).
    const rejections = (a.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.sequence === 800 && (d as any)?.reason === "overlap");
    expect(rejections.length).toBe(1);
  });

  // ─── 4. No duplicate structures ──────────────────────────────────────────

  it("exactly one replacement exists after a competitive race (no duplicates)", async () => {
    makeWall("orig", "b", 0, 0, 0);
    const s = internal.bld.structures.get("orig")!;
    s.currentDurability = 1;
    fire(a, 1, Math.PI / 2, 0.2);
    expect(internal.bld.structures.get("orig")).toBeUndefined();

    clearRateLimits();

    // Three rapid-fire attempts (A, B, A again) on the same cell.
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 900, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, a);
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 901, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, b);
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 902, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, a);

    // Exactly one structure at the cell.
    const structuresAtCell = [...internal.bld.structures.values()].filter(
      (s: any) => s.grid.x === 0 && s.grid.y === 0 && s.grid.z === 0,
    );
    expect(structuresAtCell).toHaveLength(1);

    // Total structure count is exactly 1.
    expect(internal.bld.structures.size).toBe(1);

    // Occupancy has exactly one entry for this cell.
    const cfg = getStructureConfig("wall")!;
    const cells = oc({ x: 0, y: 0, z: 0 }, cfg, 0);
    for (const cell of cells) {
      // The cell key appears in occ exactly once (it's a Set).
      expect(internal.occ.has(cell)).toBe(true);
    }
    expect(internal.occ.size).toBe(cells.size);
  });

  // ─── 5. Ownership and edit permission after replacement ─────────────────

  it("replacement wall is owned by the winning player; loser cannot edit it", async () => {
    makeWall("orig", "b", 0, 0, 0);
    const s = internal.bld.structures.get("orig")!;
    s.currentDurability = 1;
    fire(a, 1, Math.PI / 2, 0.2);

    clearRateLimits();

    // A wins the race.
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 1000, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, a);
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 1001, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, b);

    const replacement = [...internal.bld.structures.values()].find(
      (s: any) => s.grid.x === 0 && s.grid.y === 0 && s.grid.z === 0,
    )!;
    expect(replacement.ownerId).toBe("a");

    // B (the loser) cannot edit the replacement wall.
    const newId = replacement.structureId;
    // Set up edit state so the edit check reaches the ownership gate.
    replacement.currentDurability = replacement.maxDurability;
    send(WALL_PATTERN_INPUT, { structureId: newId, pattern: "door" }, b);
    expect(b.send).toHaveBeenLastCalledWith(
      WALL_PATTERN_RESULT,
      expect.objectContaining({ structureId: newId, success: false, reason: "not_owned" }),
    );

    // A (the owner) CAN edit the replacement wall.
    replacement.editKind = "wall";
    replacement.editTiles.length = 0;
    for (let i = 0; i < 9; i++) replacement.editTiles.push(true);
    send(WALL_PATTERN_INPUT, { structureId: newId, pattern: "door" }, a);
    expect(a.send).not.toHaveBeenCalledWith(
      WALL_PATTERN_RESULT,
      expect.objectContaining({ success: false }),
    );
    // The wall pattern was applied.
    expect(replacement.editType).toBe("door");
  });

  it("ownership/edit permission after replacement is preserved through subsequent edits", async () => {
    makeWall("orig", "a", 0, 0, 0);
    const s = internal.bld.structures.get("orig")!;
    s.currentDurability = 1;
    fire(b, 1, -Math.PI / 2, 0.2); // B destroys A's wall.

    clearRateLimits();

    // B wins the race.
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 1100, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, b);
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 1101, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, a);

    const replacement = [...internal.bld.structures.values()].find(
      (s: any) => s.grid.x === 0 && s.grid.y === 0 && s.grid.z === 0,
    )!;
    expect(replacement.ownerId).toBe("b");

    // B can edit it (owner).
    replacement.editKind = "wall";
    replacement.editTiles.length = 0;
    for (let i = 0; i < 9; i++) replacement.editTiles.push(true);
    send(WALL_PATTERN_INPUT, { structureId: replacement.structureId, pattern: "window" }, b);
    expect(replacement.editType).toBe("window");
    expect(replacement.ownerId).toBe("b"); // ownership unchanged after edit

    // A cannot edit it.
    send(WALL_PATTERN_INPUT, { structureId: replacement.structureId, pattern: "door" }, a);
    expect(a.send).toHaveBeenLastCalledWith(
      WALL_PATTERN_RESULT,
      expect.objectContaining({ structureId: replacement.structureId, success: false, reason: "not_owned" }),
    );
  });

  // ─── 6. Only accepted placement charges Energy ────────────────────────────

  it("only the accepted placement charges Energy; rejected placements are free", async () => {
    makeWall("orig", "b", 0, 0, 0);
    const s = internal.bld.structures.get("orig")!;
    s.currentDurability = 1;
    fire(a, 1, Math.PI / 2, 0.2);

    clearRateLimits();
    const ea = internal.state.players.get("a")!.energy;
    const eb = internal.state.players.get("b")!.energy;
    const wallCost = getStructureConfig("wall")!.cost;

    // A wins, B loses.
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 1200, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, a);
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 1201, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, b);

    expect(internal.state.players.get("a")!.energy).toBe(ea - wallCost);
    expect(internal.state.players.get("b")!.energy).toBe(eb);

    // Verify the ENERGY_UPDATE broadcast was sent only for player A.
    const energyEvents = broadcastCalls.filter(([ev]) => ev === ENERGY_EVENTS.ENERGY_UPDATE);
    expect(energyEvents.length).toBe(1);
    expect((energyEvents[0][1] as any).playerId).toBe("a");
    expect((energyEvents[0][1] as any).energy).toBe(ea - wallCost);
  });

  it("repeated packet does not double-charge Energy", async () => {
    clearRateLimits();
    const ea = internal.state.players.get("a")!.energy;
    const wallCost = getStructureConfig("wall")!.cost;

    // Send the same packet twice (rate-limited second time).
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 1300, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, a);
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 1300, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, a);

    // Energy charged exactly once.
    expect(internal.state.players.get("a")!.energy).toBe(ea - wallCost);

    // Exactly one ENERGY_UPDATE broadcast.
    const energyEvents = broadcastCalls.filter(([ev]) => ev === ENERGY_EVENTS.ENERGY_UPDATE);
    expect(energyEvents).toHaveLength(1);
  });

  // ─── 7. STRUCTURE_PLACED broadcast on accepted replacement ───────────────

  it("broadcasts STRUCTURE_PLACED exactly once for the accepted replacement", async () => {
    makeWall("orig", "b", 0, 0, 0);
    const s = internal.bld.structures.get("orig")!;
    s.currentDurability = 1;
    fire(a, 1, Math.PI / 2, 0.2);

    clearRateLimits();

    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 1400, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, a);
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 1401, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, b);

    const placedEvents = broadcastCalls.filter(
      ([ev]) => ev === BUILD_EVENTS.STRUCTURE_PLACED,
    );
    expect(placedEvents).toHaveLength(1);
    const placed = (placedEvents[0][1] as any).structure;
    expect(placed.ownerId).toBe("a");
    expect(placed.grid).toEqual({ x: 0, y: 0, z: 0 });
    expect(placed.buildType).toBe("wall");
  });

  // ─── 8. Deterministic rejection reasons ──────────────────────────────────

  it("loser receives STRUCTURE_REJECTED with reason 'overlap' targeted only to that client", async () => {
    makeWall("orig", "b", 0, 0, 0);
    const s = internal.bld.structures.get("orig")!;
    s.currentDurability = 1;
    fire(a, 1, Math.PI / 2, 0.2);

    clearRateLimits();

    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 1500, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, a);
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 1501, buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
    }, b);

    // B received the targeted rejection.
    const bCalls = (b.send as ReturnType<typeof vi.fn>).mock.calls;
    const bRejection = bCalls.find(
      ([, d]) => (d as any)?.sequence === 1501 && (d as any)?.reason === "overlap",
    );
    expect(bRejection).toBeDefined();
    expect(bRejection![0]).toBe(BUILD_EVENTS.STRUCTURE_REJECTED);

    // A did NOT receive an overlap rejection (A won).
    const aCalls = (a.send as ReturnType<typeof vi.fn>).mock.calls;
    const aOverlap = aCalls.find(
      ([, d]) => (d as any)?.reason === "overlap",
    );
    expect(aOverlap).toBeUndefined();

    // No overlap rejection was broadcast (it's targeted).
    const overlapBroadcasts = broadcastCalls.filter(
      ([, d]) => (d as any)?.reason === "overlap",
    );
    expect(overlapBroadcasts).toHaveLength(0);
  });
});
