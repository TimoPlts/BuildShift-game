/**
 * Rotated build placement — authoritative server tests.
 *
 * The client preview and the server validator share the canonical placement
 * rules from `@buildshift/game-config` (`normalizePlacementRotation`,
 * `isValidPlacementRotation`, `structureFootprintCells`,
 * `isWithinBuildBounds`). These tests pin the server half:
 *
 *  - walls and ramps place at every quarter-turn rotation;
 *  - floors and cones place with the normalized rotation the client sends
 *    whatever rotation was selected for a previous piece;
 *  - a non-canonical rotation is rejected with no Energy charged;
 *  - the server's occupied cells and bounds verdicts equal the shared rules
 *    the client preview uses (client and server agree).
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
  structureFootprintCells,
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

  it.each([0, 1, 2, 3])("ramp places at rotation %i and occupies its rotated footprint", async (rotation) => {
    const h = home();
    const grid = { x: Math.min(h.x, BUILD_BOUNDS.maxX - 1), y: 0, z: Math.min(h.z, BUILD_BOUNDS.maxZ - 1) };
    const r = await place("ramp", grid, rotation);
    expect(r.rejection).toBeUndefined();
    expect(r.structure?.rotation).toBe(rotation);
    const cells = structureFootprintCells("ramp", grid, rotation).map(c => `${c.x},${c.y},${c.z}`).sort();
    expect([...internal.occ].sort()).toEqual(cells);
  });

  it.each(["floor", "cone"])("%s places after a wall/ramp rotation with the normalized rotation", async (type) => {
    const h = home();
    // A rotated wall first (rotation 3 selected), then the piece switch: the
    // client normalizes the still-selected rotation for the new piece.
    expect((await place("wall", { x: h.x, y: 0, z: h.z }, 3)).rejection).toBeUndefined();
    for (const [i, selected] of [1, 2, 3].entries()) {
      const r = await place(type, { x: h.x, y: i + 1 <= BUILD_BOUNDS.maxLayer ? i + 1 : 0, z: h.z + (i === 2 ? 1 : 0) }, normalizePlacementRotation(type, selected));
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
      { type: "ramp", grid: { x: BUILD_BOUNDS.maxX, y: 0, z: h.z }, rotation: 0 },
      { type: "ramp", grid: { x: BUILD_BOUNDS.maxX, y: 0, z: Math.min(h.z, BUILD_BOUNDS.maxZ - 1) }, rotation: 1 },
      { type: "wall", grid: { x: BUILD_BOUNDS.maxX + 1, y: 0, z: h.z }, rotation: 0 },
      { type: "floor", grid: { x: h.x, y: BUILD_BOUNDS.maxLayer + 1, z: h.z }, rotation: 0 },
    ];
    for (const c of candidates) {
      // Out-of-range anchors would be rejected for range first; keep the
      // player next to each anchor so only the bounds rule decides.
      const p = internal.state.players.get("a")!;
      p.x = c.grid.x * 5.12 - 2; p.z = c.grid.z * 5.12; p.y = 0;
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
