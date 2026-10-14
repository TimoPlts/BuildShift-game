import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import { ASSAULT_RIFLE, MAX_SHIELD, structureCuboids } from "@buildshift/game-config";
import { TwoPlayerMovementRoom, TWO_PLAYER_MOVEMENT_INPUT } from "./TwoPlayerMovementRoom.js";
import { StructureGridSchema, StructureStateSchema } from "../state/buildingState.js";

describe("authoritative edited-structure hitscan", () => {
  let room: TwoPlayerMovementRoom;
  let internal: any;
  let a: Client;
  let b: Client;
  let input: (client: Client, payload: unknown) => void;

  beforeEach(async () => {
    room = new TwoPlayerMovementRoom();
    internal = room as any;
    await internal.pwp;
    vi.spyOn(room, "setFixedTimestep").mockImplementation(() => {});
    vi.spyOn(room, "onMessage").mockImplementation(((type: string, fn: any) => {
      if (type === TWO_PLAYER_MOVEMENT_INPUT) input = fn;
    }) as any);
    vi.spyOn(room, "broadcast").mockImplementation(() => {});
    a = { sessionId: "a", send: vi.fn() } as unknown as Client;
    b = { sessionId: "b", send: vi.fn() } as unknown as Client;
    room.clients.push(a, b);
    room.onCreate(); room.onJoin(a); room.onJoin(b); internal.br();
    // The ray crosses the wall's middle row at the centre opening.
    for (const id of ["a", "b"]) {
      const p = room.state.players.get(id)!;
      p.y = 1.02;
      p.velocityY = 0;
    }
  });

  afterEach(() => { room.onDispose(); room.clock.clear(); vi.restoreAllMocks(); });

  function wall(tiles: boolean[]) {
    const s = new StructureStateSchema();
    s.structureId = "wall"; s.buildType = "wall"; s.ownerId = "b";
    s.maxDurability = 200; s.currentDurability = 200;
    s.editKind = "wall"; s.editTiles.push(...tiles);
    const g = new StructureGridSchema(); g.x = 0; g.y = 0; g.z = 0;
    s.grid = g; s.rotation = 1;
    internal.bld.structures.set("wall", s);
    internal.pw.setStructureColliders("wall", structureCuboids({ buildType: "wall", grid: g, rotation: 1, editGrid: { kind: "wall", tiles } }));
    return s;
  }

  function fire(sequence: number) {
    input(a, { sequence, moveX: 0, moveZ: 0, lookYaw: Math.PI / 2, lookPitch: 0, primaryFire: true });
    internal.tick();
  }

  it("passes through a window to the player, then a reset wall blocks and takes damage", () => {
    const s = wall([true, true, true, true, false, true, true, true, true]);
    fire(1);
    const victim = room.state.players.get("b")!;
    expect(victim.shield).toBe(MAX_SHIELD - ASSAULT_RIFLE.damage);
    expect(s.currentDurability).toBe(200);

    s.editTiles[4] = true;
    internal.pw.setStructureColliders("wall", structureCuboids({ buildType: "wall", grid: s.grid, rotation: 1, editGrid: { kind: "wall", tiles: [...s.editTiles] } }));
    internal.tc += ASSAULT_RIFLE.fireIntervalTicks;
    fire(1 + ASSAULT_RIFLE.fireIntervalTicks);
    expect(victim.shield).toBe(MAX_SHIELD - ASSAULT_RIFLE.damage);
    expect(s.currentDurability).toBe(200 - ASSAULT_RIFLE.damage);
  });
});
