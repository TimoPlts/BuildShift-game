/**
 * Task 4 — floor edit system: authoritative 2×2 tile-driven floor edits in
 * the canonical two-player room.
 *
 * Exercises the production routes only (placement via `build:placement_request`,
 * edits via `two-player:edit_grid_action`): valid floor forms are applied to
 * the canonical edit state and regenerate the structure's collision geometry
 * (one quarter-cell cuboid per remaining tile); the invalid empty form is
 * rejected server-side; reset/cancel/full_reset restore the full floor; and
 * all existing placement/authority rules keep applying.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import { BUILD_EVENTS, MatchPhase } from "@buildshift/protocol";
import { TwoPlayerMovementRoom, EDIT_GRID_ACTION_INPUT } from "./TwoPlayerMovementRoom.js";

describe("authoritative 2×2 floor edit system", () => {
  let room: TwoPlayerMovementRoom;
  let internal: any;
  let a: Client;
  let b: Client;
  let handlers: Map<string, (client: Client, message: unknown) => void>;
  let broadcastCalls: Array<[string, unknown]>;

  const send = (type: string, value: unknown, client: Client = a) => {
    const handler = handlers.get(type);
    expect(handler, `registered production route ${type}`).toBeDefined();
    return handler!(client, value);
  };
  const edit = (value: unknown, client: Client = a) => send(EDIT_GRID_ACTION_INPUT, value, client);
  const placedStructure = (sequence: number) =>
    broadcastCalls
      .find(([ev, d]) => ev === BUILD_EVENTS.STRUCTURE_PLACED && (d as any)?.structure?.createdSequence === sequence)?.[1] as any;
  const rejectedStructure = (sequence: number) =>
    (a.send as unknown as ReturnType<typeof vi.fn>).mock.calls
      .find(([ev, d]) => ev === BUILD_EVENTS.STRUCTURE_REJECTED && (d as any)?.sequence === sequence)?.[1] as any;
  const editResults = () =>
    broadcastCalls.filter(([ev]) => ev === EDIT_GRID_ACTION_INPUT).map(([, d]) => d as any);
  const floorTiles = (id: string) => Array.from(internal.bld.structures.get(id).editTiles as boolean[]);
  const colliderCount = (id: string) => internal.pw.structureColliderCount(id);

  /** Places a floor through the production placement route and returns its id. */
  const placeFloor = async (grid: { x: number; y: number; z: number }, sequence = 1): Promise<string> => {
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence, buildType: "floor", grid, rotation: 0 });
    const placed = placedStructure(sequence);
    expect(placed, `floor placement ${sequence} accepted`).toBeDefined();
    return placed.structure.structureId as string;
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

  it("generates quarter-tile collision geometry from the canonical edit state", async () => {
    const id = await placeFloor({ x: 0, y: 0, z: 0 });
    expect(colliderCount(id)).toBe(1); // plain placement collider

    await edit({ structureId: id, action: "select", tileIndex: 1 });
    const result = editResults().at(-1);
    expect(result.success).toBe(true);
    expect(result.editState).toEqual({ kind: "floor_cone", tiles: [true, false, true, true] });

    const s = internal.bld.structures.get(id);
    expect(s.editKind).toBe("floor_cone");
    expect(floorTiles(id)).toEqual([true, false, true, true]);
    expect(colliderCount(id)).toBe(3);
  });

  it("rejects an edit that would empty the floor (invalid form)", async () => {
    const id = await placeFloor({ x: 0, y: 0, z: 0 });
    for (const tile of [0, 1, 2]) {
      await edit({ structureId: id, action: "select", tileIndex: tile });
    }
    expect(editResults().slice(-3).every((r) => r.success)).toBe(true);
    expect(colliderCount(id)).toBe(1);

    await edit({ structureId: id, action: "select", tileIndex: 3 });
    expect(a.send).toHaveBeenLastCalledWith(
      EDIT_GRID_ACTION_INPUT,
      expect.objectContaining({ structureId: id, success: false, reason: "invalid_form" }),
    );
    // The canonical state and geometry are untouched.
    expect(floorTiles(id)).toEqual([false, false, false, true]);
    expect(colliderCount(id)).toBe(1);
    // Rejections are not broadcast.
    expect(editResults().length).toBe(3);
  });

  it("reset, cancel, and full_reset restore the full floor form and geometry", async () => {
    const id = await placeFloor({ x: 0, y: 0, z: 0 });

    await edit({ structureId: id, action: "select", tileIndex: 0 });
    expect(colliderCount(id)).toBe(3);
    await edit({ structureId: id, action: "reset" });
    expect(floorTiles(id)).toEqual([true, true, true, true]);
    expect(colliderCount(id)).toBe(1); // full floor coalesces to its exact default slab

    await edit({ structureId: id, action: "select", tileIndex: 2 });
    await edit({ structureId: id, action: "cancel" });
    expect(floorTiles(id)).toEqual([true, true, true, true]);
    expect(colliderCount(id)).toBe(1); // restored full slab

    await edit({ structureId: id, action: "select", tileIndex: 3 });
    await edit({ structureId: id, action: "full_reset" });
    expect(floorTiles(id)).toEqual([true, true, true, true]);
    expect(colliderCount(id)).toBe(1); // full reset restores the default slab
  });

  it("deselect restores a removed tile and its geometry", async () => {
    const id = await placeFloor({ x: 0, y: 0, z: 0 });
    await edit({ structureId: id, action: "select", tileIndex: 0 });
    expect(colliderCount(id)).toBe(3);
    await edit({ structureId: id, action: "deselect", tileIndex: 0 });
    expect(floorTiles(id)).toEqual([true, true, true, true]);
    expect(colliderCount(id)).toBe(1); // restored full slab
  });

  it("begin re-initializes a modified floor to the full form", async () => {
    const id = await placeFloor({ x: 0, y: 0, z: 0 });
    await edit({ structureId: id, action: "select", tileIndex: 0 });
    await edit({ structureId: id, action: "select", tileIndex: 2 });
    expect(colliderCount(id)).toBe(2);
    await edit({ structureId: id, action: "begin" });
    expect(floorTiles(id)).toEqual([true, true, true, true]);
    expect(colliderCount(id)).toBe(1); // begin restores the default slab
  });

  it("keeps the diagonal (corner opening) and half forms on the floor", async () => {
    const id = await placeFloor({ x: 0, y: 0, z: 0 });
    // Diagonal pair removed → diagonal form.
    await edit({ structureId: id, action: "select", tileIndex: 0 });
    await edit({ structureId: id, action: "select", tileIndex: 3 });
    expect(editResults().at(-1).success).toBe(true);
    expect(floorTiles(id)).toEqual([false, true, true, false]);
    expect(colliderCount(id)).toBe(2);
    // Adjacent pair removed → half form (advance past the placement rate
    // window so the second floor can be placed).
    for (let i = 0; i < 11; i++) internal.tick();
    const id2 = await placeFloor({ x: -1, y: 0, z: 0 }, 2);
    await edit({ structureId: id2, action: "select", tileIndex: 0 });
    await edit({ structureId: id2, action: "select", tileIndex: 1 });
    expect(floorTiles(id2)).toEqual([false, false, true, true]);
    expect(colliderCount(id2)).toBe(2);
  });

  it("preserves authority: rejects non-owner, out-of-phase, and dead-player edits", async () => {
    const id = await placeFloor({ x: 0, y: 0, z: 0 });

    await edit({ structureId: id, action: "select", tileIndex: 0 }, b);
    expect(b.send).toHaveBeenLastCalledWith(
      EDIT_GRID_ACTION_INPUT,
      expect.objectContaining({ success: false, reason: "not_owned" }),
    );
    expect(editResults()).toHaveLength(0);

    room.state.matchPhase = MatchPhase.COUNTDOWN;
    await edit({ structureId: id, action: "select", tileIndex: 0 });
    expect(a.send).toHaveBeenLastCalledWith(
      EDIT_GRID_ACTION_INPUT,
      expect.objectContaining({ success: false, reason: "invalid_player_state" }),
    );

    room.state.matchPhase = MatchPhase.IN_PROGRESS;
    room.state.players.get("a")!.alive = false;
    await edit({ structureId: id, action: "select", tileIndex: 0 });
    expect(a.send).toHaveBeenLastCalledWith(
      EDIT_GRID_ACTION_INPUT,
      expect.objectContaining({ success: false, reason: "invalid_player_state" }),
    );

    // No edit was applied; the floor keeps its canonical default (full) form.
    expect(internal.bld.structures.get(id).editKind).toBe("floor_cone");
    expect([...internal.bld.structures.get(id).editTiles]).toEqual([true, true, true, true]);
    expect(colliderCount(id)).toBe(1);
  });

  it("rejects out-of-range tiles and malformed floor edit payloads", async () => {
    const id = await placeFloor({ x: 0, y: 0, z: 0 });

    await edit({ structureId: id, action: "select", tileIndex: 4 });
    expect(a.send).toHaveBeenLastCalledWith(
      EDIT_GRID_ACTION_INPUT,
      expect.objectContaining({ success: false, reason: "tile_out_of_range" }),
    );

    await edit({ structureId: id, action: "bogus" });
    expect(a.send).toHaveBeenLastCalledWith(
      EDIT_GRID_ACTION_INPUT,
      expect.objectContaining({ success: false }),
    );

    await edit(null);
    expect(a.send).toHaveBeenLastCalledWith(
      EDIT_GRID_ACTION_INPUT,
      expect.objectContaining({ structureId: "", success: false }),
    );

    // No edit was applied; the floor keeps its canonical default (full) form.
    expect(internal.bld.structures.get(id).editKind).toBe("floor_cone");
    expect([...internal.bld.structures.get(id).editTiles]).toEqual([true, true, true, true]);
    expect(colliderCount(id)).toBe(1);
    expect(editResults()).toHaveLength(0);
  });

  it("rejects edits to unknown structures", async () => {
    await edit({ structureId: "missing", action: "select", tileIndex: 0 });
    expect(a.send).toHaveBeenLastCalledWith(
      EDIT_GRID_ACTION_INPUT,
      expect.objectContaining({ structureId: "missing", success: false, reason: "structure_not_found" }),
    );
    expect(editResults()).toHaveLength(0);
  });

  it("preserves placement authority rules around edited floors", async () => {
    const id = await placeFloor({ x: 0, y: 0, z: 0 }, 1);
    await edit({ structureId: id, action: "select", tileIndex: 0 });
    expect(editResults().at(-1).success).toBe(true);

    // Overlap on the same cell is still rejected.
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 2, buildType: "floor", grid: { x: 0, y: 0, z: 0 }, rotation: 0 });
    expect(rejectedStructure(2)).toEqual({ sequence: 2, reason: "overlap" });

    // Rate limit still applies within the placement window.
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 3, buildType: "floor", grid: { x: 1, y: 0, z: 0 }, rotation: 0 });
    expect(rejectedStructure(3)).toEqual({ sequence: 3, reason: "rate_limited" });

    // After the rate window, a valid placement still succeeds.
    for (let i = 0; i < 11; i++) internal.tick();
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 4, buildType: "floor", grid: { x: 1, y: 0, z: 0 }, rotation: 0 });
    expect(placedStructure(4)).toBeDefined();
  });
});
