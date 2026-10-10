import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import { MatchPhase } from "@buildshift/protocol";
import {
  TwoPlayerMovementRoom,
  WALL_PATTERN_INPUT,
  WALL_PATTERN_RESULT,
} from "./TwoPlayerMovementRoom.js";
import { StructureStateSchema, StructureGridSchema } from "../state/buildingState.js";

// Server-authoritative wall edit pattern authority: the production handler
// validates pattern + ownership + integrity and applies canonical tile
// geometry, without touching cost (energy) or durability (HP).
describe("wall edit pattern authority", () => {
  let room: TwoPlayerMovementRoom;
  let internal: any;
  let a: Client;
  let b: Client;
  let handlers: Map<string, (client: Client, message: unknown) => void>;

  const send = (type: string, value: unknown, client = a) => {
    const handler = handlers.get(type);
    expect(handler, `registered production route ${type}`).toBeDefined();
    handler!(client, value);
  };

  function wall(ownerId = "a", buildType = "wall") {
    const s = new StructureStateSchema();
    s.structureId = "wall";
    s.ownerId = ownerId;
    s.buildType = buildType;
    s.editType = "";
    s.editKind = "";
    s.editRampVariant = "";
    s.maxDurability = 100;
    s.currentDurability = 100;
    const g = new StructureGridSchema();
    g.x = 0;
    g.y = 0;
    g.z = 0;
    s.grid = g;
    s.rotation = 0;
    internal.bld.structures.set("wall", s);
    return s;
  }

  beforeEach(async () => {
    room = new TwoPlayerMovementRoom();
    internal = room as any;
    await internal.pwp;
    handlers = new Map();
    vi.spyOn(room, "onMessage").mockImplementation(((type: string, fn: any) => {
      handlers.set(type, fn);
    }) as any);
    vi.spyOn(room, "setFixedTimestep").mockImplementation(() => {});
    vi.spyOn(room, "broadcast").mockImplementation(() => {});
    a = { sessionId: "a", send: vi.fn() } as unknown as Client;
    b = { sessionId: "b", send: vi.fn() } as unknown as Client;
    room.clients.push(a, b);
    room.onCreate();
    room.onJoin(a);
    room.onJoin(b);
    internal.br();
  });

  afterEach(() => {
    room.onDispose();
    room.clock.clear();
    vi.restoreAllMocks();
  });

  it("registers the canonical wall pattern routes", () => {
    expect(handlers.has(WALL_PATTERN_INPUT)).toBe(true);
  });

  it("applies a valid pattern authoritatively with canonical tiles and geometry", () => {
    const s = wall();
    const energyBefore = room.state.players.get("a")!.energy;
    send(WALL_PATTERN_INPUT, { structureId: "wall", pattern: "door" });

    expect(s.editKind).toBe("wall");
    expect([...s.editTiles]).toEqual([true, true, true, true, false, true, true, false, true]);
    expect(s.editType).toBe("door");
    // Cost and HP are preserved by an edit.
    expect(room.state.players.get("a")!.energy).toBe(energyBefore);
    expect(s.currentDurability).toBe(100);
    expect(s.maxDurability).toBe(100);

    expect(room.broadcast).toHaveBeenCalledWith(
      WALL_PATTERN_RESULT,
      expect.objectContaining({
        structureId: "wall",
        success: true,
        pattern: "door",
        editState: { kind: "wall", tiles: [true, true, true, true, false, true, true, false, true] },
        geometry: expect.objectContaining({
          pattern: "door",
          tiles: [true, true, true, true, false, true, true, false, true],
          removedTiles: [4, 7],
          solidTiles: expect.arrayContaining([]),
        }),
      }),
    );
    const geo = ((room.broadcast as any).mock.calls.find((c: any[]) => c[0] === WALL_PATTERN_RESULT)?.[1]) as any;
    expect(geo.geometry.pattern).toBe("door");
    expect(geo.geometry.tileGeometry).toHaveLength(9);
    expect(geo.geometry.solidTiles).toHaveLength(7);
  });

  it("applies every valid pattern through the production route", () => {
    const expected: Array<[string, number[]]> = [
      ["window", [4]],
      ["door", [4, 7]],
      ["half_top", [0, 1, 2]],
      ["half_left", [0, 3, 6]],
      ["half_right", [2, 5, 8]],
      ["corner_top", [0, 1, 3]],
      ["wide_opening", [6, 7, 8]],
      ["practical_arch", [3, 5, 6, 7, 8]],
    ];
    for (const [pattern, removed] of expected) {
      const s = wall();
      send(WALL_PATTERN_INPUT, { structureId: "wall", pattern });
      expect(s.editType, pattern).toBe(pattern);
      const tiles = [...s.editTiles];
      expect(tiles).toHaveLength(9);
      expect(tiles.every((t, i) => t === !removed.includes(i)), pattern).toBe(true);
    }
  });

  it("reset restores the full solid wall and clears editType", () => {
    const s = wall();
    send(WALL_PATTERN_INPUT, { structureId: "wall", pattern: "practical_arch" });
    expect(s.editType).toBe("practical_arch");
    send(WALL_PATTERN_INPUT, { structureId: "wall", pattern: "reset" });
    expect([...s.editTiles]).toEqual(new Array(9).fill(true));
    expect(s.editKind).toBe("wall");
    expect(s.editType).toBe("");
    expect(s.editRampVariant).toBe("");
  });

  it("rejects unknown patterns without mutating state", () => {
    const s = wall();
    send(WALL_PATTERN_INPUT, { structureId: "wall", pattern: "arch" });
    expect(a.send).toHaveBeenLastCalledWith(
      WALL_PATTERN_RESULT,
      expect.objectContaining({ structureId: "wall", success: false, reason: "unknown_pattern" }),
    );
    expect(s.editType).toBe("");
    expect(s.editKind).toBe("");
    expect(room.broadcast).not.toHaveBeenCalledWith(WALL_PATTERN_RESULT, expect.anything());
  });

  it.each(["floor", "cone", "ramp"])("rejects patterns on %s structures with not_wall", (buildType) => {
    const s = wall("a", buildType);
    send(WALL_PATTERN_INPUT, { structureId: "wall", pattern: "window" });
    expect(a.send).toHaveBeenLastCalledWith(
      WALL_PATTERN_RESULT,
      expect.objectContaining({ structureId: "wall", success: false, reason: "not_wall" }),
    );
    expect(s.editType).toBe("");
    expect(s.editKind).toBe("");
  });

  it.each(["ownership", "missing", "phase", "dead", "damaged", "destroyed"])(
    "rejects invalid wall pattern request: %s",
    (reason) => {
      const s = wall();
      if (reason === "ownership") s.ownerId = "b";
      if (reason === "missing") internal.bld.structures.delete("wall");
      if (reason === "phase") room.state.matchPhase = MatchPhase.COUNTDOWN;
      if (reason === "dead") room.state.players.get("a")!.alive = false;
      if (reason === "damaged") s.currentDurability = 50;
      if (reason === "destroyed") s.currentDurability = 0;
      send(WALL_PATTERN_INPUT, { structureId: "wall", pattern: "door" });
      expect(a.send).toHaveBeenLastCalledWith(
        WALL_PATTERN_RESULT,
        expect.objectContaining({ success: false }),
      );
      if (reason !== "missing") {
        expect(s.editType).toBe("");
        expect(s.editKind).toBe("");
      }
      expect(room.broadcast).not.toHaveBeenCalledWith(WALL_PATTERN_RESULT, expect.anything());
    },
  );

  it("ignores malformed payloads without throwing", () => {
    const s = wall();
    send(WALL_PATTERN_INPUT, null);
    send(WALL_PATTERN_INPUT, {});
    send(WALL_PATTERN_INPUT, { structureId: 42, pattern: "door" });
    expect(a.send).not.toHaveBeenCalled();
    expect(s.editType).toBe("");
    expect(s.editKind).toBe("");
    expect(s.editTiles.length).toBe(0);
  });
});
