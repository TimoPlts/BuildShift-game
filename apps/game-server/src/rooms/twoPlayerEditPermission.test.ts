import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import { TwoPlayerMovementRoom, EDIT_GRID_ACTION_INPUT } from "./TwoPlayerMovementRoom.js";
import { StructureStateSchema, StructureGridSchema } from "../state/buildingState.js";

describe("canonical two-client edit permission", () => {
  let room: TwoPlayerMovementRoom;
  let internal: any;
  let a: Client;
  let b: Client;
  let handlers: Map<string, (client: Client, payload: unknown) => Promise<void>>;

  beforeEach(async () => {
    room = new TwoPlayerMovementRoom();
    internal = room as any;
    await internal.pwp;
    handlers = new Map();
    vi.spyOn(room, "onMessage").mockImplementation(((type: string, fn: any) => { handlers.set(type, fn); }) as any);
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

  afterEach(() => { room.onDispose(); room.clock.clear(); vi.restoreAllMocks(); });

  function wall() {
    const s = new StructureStateSchema();
    s.structureId = "wall";
    s.ownerId = "a";
    s.buildType = "wall";
    s.maxDurability = 100;
    s.currentDurability = 100;
    s.editKind = "wall";
    s.editTiles.push(...Array<boolean>(9).fill(true));
    const g = new StructureGridSchema();
    g.x = 0; g.y = 0; g.z = 0;
    s.grid = g;
    s.rotation = 0;
    internal.bld.structures.set("wall", s);
    return s;
  }

  it("registers one edit route and rejects both retired transports", () => {
    expect(handlers.has(EDIT_GRID_ACTION_INPUT)).toBe(true);
    expect(handlers.has("build:edit_request")).toBe(false);
    expect(handlers.has("two-player:wall_pattern")).toBe(false);
  });

  it("rejects an opponent only to that client and preserves owner and tiles", async () => {
    const s = wall();
    await handlers.get(EDIT_GRID_ACTION_INPUT)!(b, { structureId: "wall", action: "select", tileIndex: 4, ownerId: "b" });
    expect(b.send).toHaveBeenCalledWith(EDIT_GRID_ACTION_INPUT, expect.objectContaining({ reason: "not_owned", success: false }));
    expect(a.send).not.toHaveBeenCalledWith(EDIT_GRID_ACTION_INPUT, expect.objectContaining({ reason: "not_owned" }));
    expect(s.ownerId).toBe("a");
    expect([...s.editTiles]).toEqual(Array(9).fill(true));
    expect(room.broadcast).not.toHaveBeenCalledWith(EDIT_GRID_ACTION_INPUT, expect.objectContaining({ success: true }));
  });

  it("lets the owner edit and reset without transferring ownership", async () => {
    const s = wall();
    const edit = handlers.get(EDIT_GRID_ACTION_INPUT)!;
    await edit(a, { structureId: "wall", action: "select", tileIndex: 4 });
    expect(s.editTiles[4]).toBe(false);
    expect(s.ownerId).toBe("a");
    await edit(a, { structureId: "wall", action: "reset" });
    expect([...s.editTiles]).toEqual(Array(9).fill(true));
    expect(s.ownerId).toBe("a");
  });
});
