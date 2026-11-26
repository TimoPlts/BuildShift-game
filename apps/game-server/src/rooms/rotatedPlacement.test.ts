/**
 * Rotated build placement — authoritative server tests.
 *
 * The client preview and the server validator share the canonical placement
 * rules from `@buildshift/game-config` (`normalizePlacementRotation`,
 * `isValidPlacementRotation`, `structureSlots`,
 * `isWithinBuildBounds`). These tests pin the server half:
 *
 *  - walls and ramps place at every quarter-turn rotation;
 *  - floors and cones place with the normalized rotation the client sends
 *    whatever rotation was selected for a previous piece;
 *  - a non-canonical rotation is rejected with no Energy charged;
 *  - the server's occupied cells and bounds verdicts equal the shared rules
 *    the client preview uses (client and server agree);
 *  - fixtures respect the two authoritative geometry gates that are the subject
 *    of `placementValidity.test.ts`: a piece above the ground layer is given a
 *    wall to stand on, and a piece whose footprint is a whole tile is placed
 *    where no body stands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import { BUILD_EVENTS } from "@buildshift/protocol";
import {
  BUILD_BOUNDS,
  getStructureConfig,
  isWithinBuildBounds,
  isWithinPlacementRange,
  normalizePlacementRotation,
  structureSlots,
} from "@buildshift/game-config";
import { TwoPlayerMovementRoom } from "./TwoPlayerMovementRoom.js";

describe("rotated build placement (shared canonical rotation / bounds rules)", () => {
  let room: TwoPlayerMovementRoom;
  let internal: any;
  let a: Client;
  let handlers: Map<string, (client: Client, message: unknown) => Promise<void> | void>;
  let sequence = 1000;

  const rejections = () => (a.send as ReturnType<typeof vi.fn>).mock.calls
    .filter(([type]) => type === BUILD_EVENTS.STRUCTURE_REJECTED)
    .map(([, d]) => d as { sequence: number; reason: string });

  /** Sends one placement request from A; returns the outcome and Energy delta. */
  const place = async (buildType: string, grid: { x: number; y: number; z: number }, rotation: number) => {
    internal.tc += 100; // clear the placement-rate window between requests
    const seq = ++sequence;
    const before = internal.state.players.get("a")!.energy;
    await handlers.get(BUILD_EVENTS.PLACEMENT_REQUEST)!(a, { sequence: seq, buildType, grid, rotation });
    const structure = [...internal.bld.structures.values()].find((s: any) => s.createdSequence === seq);
    return {
      structure,
      rejection: rejections().find(r => r.sequence === seq),
      energyDelta: internal.state.players.get("a")!.energy - before,
    };
  };

  /** A's grid cell, so every test anchor is well inside the placement range. */
  const home = () => {
    const p = internal.state.players.get("a")!;
    return { x: Math.round(p.x / 5.12), z: Math.round(p.z / 5.12) };
  };

  /**
   * Stand A one tile to the −X side of `grid` and B one tile to its +Z side:
   * 5.12 m from the anchor centre (well inside the 10.24 m range) and 2.21 m
   * clear of anything that fills the tile, so the actor-occupancy gate is not
   * what decides these rotation and bounds assertions. A piece whose footprint
   * is a whole tile (a ramp) legally cannot be created around a body standing
   * in it — for EITHER player — which is exactly the rule `placementValidity`
   * pins down; here both bodies are simply out of the way.
   */
  const parkClearOf = (grid: { x: number; z: number }) => {
    const a = internal.state.players.get("a")!;
    a.x = grid.x * 5.12 - 5.12;
    a.z = grid.z * 5.12;
    a.y = 0;
    const b = internal.state.players.get("b")!;
    b.x = grid.x * 5.12;
    b.z = grid.z * 5.12 + 5.12;
    b.y = 0;
  };

  beforeEach(async () => {
    room = new TwoPlayerMovementRoom();
    internal = room as any;
    await internal.pwp;
    handlers = new Map();
    vi.spyOn(room, "onMessage").mockImplementation(((type: string, fn: any) => { handlers.set(type, fn); }) as any);
    vi.spyOn(room, "setFixedTimestep").mockImplementation(() => {});
    vi.spyOn(room, "broadcast").mockImplementation((() => {}) as any);
    a = { sessionId: "a", send: vi.fn() } as unknown as Client;
    const b = { sessionId: "b", send: vi.fn() } as unknown as Client;
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

  it.each([0, 1, 2, 3])("wall places at rotation %i", async (rotation) => {
    const h = home();
    const r = await place("wall", { x: h.x, y: 0, z: h.z }, rotation);
    expect(r.rejection).toBeUndefined();
    expect(r.structure?.rotation).toBe(rotation);
    expect(r.energyDelta).toBe(-getStructureConfig("wall")!.cost);
  });

  it.each([0, 1, 2, 3])("ramp places at rotation %i and occupies exactly its one tile's ramp slot", async (rotation) => {
    const h = home();
    const grid = { x: Math.min(h.x, BUILD_BOUNDS.maxX - 1), y: 0, z: Math.min(h.z, BUILD_BOUNDS.maxZ - 1) };
    parkClearOf(grid); // a ramp fills its tile: the body must be outside it
    const r = await place("ramp", grid, rotation);
    expect(r.rejection).toBeUndefined();
    expect(r.structure?.rotation).toBe(rotation);
    expect([...internal.occ]).toEqual(structureSlots("ramp", grid, rotation));
    expect(structureSlots("ramp", grid, rotation)).toEqual([`ramp:${grid.x},${grid.y},${grid.z}`]);
  });

  it.each(["floor", "cone"])("%s places after a wall/ramp rotation with the normalized rotation", async (type) => {
    const h = home();
    // A rotated wall first (rotation 3 selected), then the piece switch: the
    // client normalizes the still-selected rotation for the new piece.
    expect((await place("wall", { x: h.x, y: 0, z: h.z }, 3)).rejection).toBeUndefined();
    for (const [i, selected] of [1, 2, 3].entries()) {
      const grid = { x: h.x, y: i + 1 <= BUILD_BOUNDS.maxLayer ? i + 1 : 0, z: h.z + (i === 2 ? 1 : 0) };
      // Anything above the ground layer needs something to stand on: a wall at
      // the layer below, which is exactly what the support gate then requires.
      if (grid.y > 0) {
        expect((await place("wall", { x: grid.x, y: grid.y - 1, z: grid.z }, 0)).rejection).toBeUndefined();
      }
      const r = await place(type, grid, normalizePlacementRotation(type, selected));
      expect(r.rejection, `${type} after selecting rotation ${selected}`).toBeUndefined();
      expect(r.structure?.rotation).toBe(0);
    }
  });

  it.each(["floor", "cone"])("a non-canonical %s rotation is rejected without charging Energy", async (type) => {
    const h = home();
    const r = await place(type, { x: h.x, y: 0, z: h.z }, 2);
    expect(r.structure).toBeUndefined();
    expect(r.rejection?.reason).toBe("invalid_grid");
    expect(r.energyDelta).toBe(0);
  });

  it("server bounds verdicts equal the shared rule the client preview uses", async () => {
    const h = home();
    const candidates = [
      { type: "ramp", grid: { x: BUILD_BOUNDS.maxX + 1, y: 0, z: h.z }, rotation: 0 },
      { type: "ramp", grid: { x: BUILD_BOUNDS.maxX, y: 0, z: Math.min(h.z, BUILD_BOUNDS.maxZ - 1) }, rotation: 1 },
      { type: "wall", grid: { x: BUILD_BOUNDS.maxX + 1, y: 0, z: h.z }, rotation: 0 },
      { type: "floor", grid: { x: h.x, y: BUILD_BOUNDS.maxLayer + 1, z: h.z }, rotation: 0 },
    ];
    for (const c of candidates) {
      // Out-of-range anchors would be rejected for range first; keep the
      // player one tile from each anchor so only the bounds rule decides (and
      // never inside the piece's own footprint — see `parkClearOf`).
      parkClearOf(c.grid);
      const r = await place(c.type, c.grid, c.rotation);
      const clientInBounds = isWithinBuildBounds(c.type, c.grid, c.rotation);
      expect(r.structure !== undefined, JSON.stringify(c)).toBe(clientInBounds);
      if (!clientInBounds) {
        expect(r.rejection?.reason).toBe("invalid_grid");
        expect(r.energyDelta).toBe(0);
      }
    }
  });

  describe("placement range (shared full-3D rule)", () => {
    const anchor = { x: 2, y: 0, z: 0 }; // (10.24, 0, 0)
    const cases = [
      { label: "in range horizontally", player: { x: 0, y: 0, z: 0 }, inRange: true },
      { label: "in range vertically", player: { x: 10.24, y: 7.83, z: 0 }, inRange: true },
      { label: "high anchor beyond the 3D limit", player: { x: 0, y: 7.83, z: 0 }, inRange: false },
    ];
    it.each(cases)("$label: server verdict equals the shared rule; no Energy on rejection", async ({ player, inRange }) => {
      const p = internal.state.players.get("a")!;
      Object.assign(p, player);
      expect(isWithinPlacementRange(player, anchor)).toBe(inRange); // the client preview's verdict
      const r = await place("wall", anchor, 0);
      expect(r.structure !== undefined).toBe(inRange);
      if (inRange) {
        expect(r.energyDelta).toBe(-getStructureConfig("wall")!.cost);
      } else {
        expect(r.rejection?.reason).toBe("out_of_range");
        expect(r.energyDelta).toBe(0);
      }
    });
  });
});
