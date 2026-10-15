/**
 * Canonical build slots — authoritative lifecycle tests.
 *
 * Occupancy is per structural slot (shared `structureSlots`): a ramp and the
 * four walls on its tile edges, a floor at the ramp's top layer, adjacent air
 * floors all coexist; only the same slot conflicts. Pins the server half:
 * destruction frees exactly the destroyed piece's slot (and collider), round
 * reset and rematch clear every slot, Energy is charged only on acceptance,
 * and hitscan resolves each coexisting piece's own geometry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import { BUILD_EVENTS } from "@buildshift/protocol";
import { ARENA_COLLIDERS, getStructureConfig, rayStructureIntersection, structureCuboids, structureSlots } from "@buildshift/game-config";
import { TwoPlayerMovementRoom } from "./TwoPlayerMovementRoom.js";

describe("canonical build slots (authoritative)", () => {
  let room: TwoPlayerMovementRoom;
  let internal: any;
  let a: Client;
  let b: Client;
  let handlers: Map<string, (client: Client, message: unknown) => Promise<void> | void>;
  let sequence = 3000;

  const place = async (client: Client, buildType: string, grid: { x: number; y: number; z: number }, rotation = 0) => {
    internal.tc += 20; // clear the per-player placement-rate window
    const seq = ++sequence;
    const before = internal.state.players.get(client.sessionId)!.energy;
    await handlers.get(BUILD_EVENTS.PLACEMENT_REQUEST)!(client, { sequence: seq, buildType, grid, rotation });
    const structure = [...internal.bld.structures.values()].find((s: any) => s.createdSequence === seq);
    const rejection = (client.send as ReturnType<typeof vi.fn>).mock.calls.find(([t, d]) => t === BUILD_EVENTS.STRUCTURE_REJECTED && (d as any).sequence === seq);
    return { structure, reason: rejection ? (rejection[1] as any).reason : null, energyDelta: internal.state.players.get(client.sessionId)!.energy - before };
  };
  const slotsOf = (s: any) => structureSlots(s.buildType, s.grid, s.rotation);
  const expectOccupancyMatchesStructures = () => {
    const expected = [...internal.bld.structures.values()].flatMap(slotsOf).sort();
    expect([...internal.occ].sort()).toEqual(expected);
    expect(new Set(expected).size).toBe(expected.length);
    // Rapier: one collider per canonical cuboid of each live structure.
    const cuboids = [...internal.bld.structures.values()].reduce((n: number, s: any) => n + internal.pw.structureColliderCount(s.structureId), 0);
    expect(internal.pw.world.colliders.len()).toBe(ARENA_COLLIDERS.length + internal.pw.players.size + cuboids);
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
    b = { sessionId: "b", send: vi.fn() } as unknown as Client;
    room.clients.push(a, b);
    room.onCreate();
    room.onJoin(a);
    room.onJoin(b);
    internal.br();
    // Stand A at the ramp tile so every test placement is in range.
    Object.assign(internal.state.players.get("a")!, { x: 0, y: 0, z: 0 });
    Object.assign(internal.state.players.get("b")!, { x: 0, y: 0, z: 2 });
  });

  afterEach(() => {
    room.onDispose();
    room.clock.clear();
    vi.restoreAllMocks();
  });

  /** A ramp at (0,0,0) with walls on all four of its edges and a floor at its top layer. */
  const rampBox = async () => {
    const ramp = await place(a, "ramp", { x: 0, y: 0, z: 0 }, 1);
    const walls = [];
    for (const r of [0, 1, 2, 3]) walls.push(await place(a, "wall", { x: 0, y: 0, z: 0 }, r));
    const floor = await place(a, "floor", { x: 0, y: 1, z: 1 });
    return { ramp, walls, floor };
  };

  it("a ramp, its four edge walls and the floor at its top all place and charge Energy once each", async () => {
    const { ramp, walls, floor } = await rampBox();
    for (const r of [ramp, ...walls, floor]) {
      expect(r.reason).toBeNull();
      expect(r.structure).toBeDefined();
      expect(r.energyDelta).toBe(-getStructureConfig(r.structure.buildType)!.cost);
    }
    expect(internal.bld.structures.size).toBe(6);
    expectOccupancyMatchesStructures();
  });

  it("air floors extend side by side at the next layer; the same floor slot is rejected without Energy", async () => {
    await place(a, "ramp", { x: 0, y: 0, z: 0 }, 1);
    // Above the ramp's tile, then two more tiles out into the air.
    for (const z of [0, 1, 2]) expect((await place(a, "floor", { x: 0, y: 1, z })).reason).toBeNull();
    const dup = await place(b, "floor", { x: 0, y: 1, z: 2 });
    expect(dup.reason).toBe("overlap");
    expect(dup.energyDelta).toBe(0);
    expectOccupancyMatchesStructures();
  });

  it("destroying the ramp leaves every wall slot; destroying a wall leaves the ramp and the other walls", async () => {
    const { ramp, walls } = await rampBox();
    internal.ks(ramp.structure.structureId, "b");
    expect(internal.bld.structures.has(ramp.structure.structureId)).toBe(false);
    for (const w of walls) expect(internal.bld.structures.has(w.structure.structureId)).toBe(true);
    expectOccupancyMatchesStructures();
    // The freed ramp slot accepts a new ramp; the walls' edges stay taken.
    expect((await place(b, "ramp", { x: 0, y: 0, z: 0 }, 3)).reason).toBeNull();
    expect((await place(b, "wall", { x: 0, y: 0, z: 1 }, 0)).reason).toBe("overlap"); // = wall r2's edge
    internal.ks(walls[1]!.structure.structureId, "b");
    expect((await place(b, "wall", { x: 1, y: 0, z: 0 }, 3)).reason).toBeNull(); // the freed +X edge
    expectOccupancyMatchesStructures();
  });

  it("round reset and rematch clear every slot and collider", async () => {
    await rampBox();
    internal.bc(); // round reset
    expect(internal.bld.structures.size).toBe(0);
    expect(internal.occ.size).toBe(0);
    expectOccupancyMatchesStructures();
    internal.br();
    await rampBox();
    internal.resetMatch(); // rematch
    expect(internal.bld.structures.size).toBe(0);
    expect(internal.occ.size).toBe(0);
    expectOccupancyMatchesStructures();
    internal.br();
    const again = await rampBox(); // every slot is placeable again
    expect([again.ramp, ...again.walls, again.floor].every((r) => r.reason === null)).toBe(true);
  });

  it("hitscan resolves each coexisting piece's own geometry (wall panel vs ramp slab)", async () => {
    const { walls } = await rampBox();
    const geometryOf = (s: any) => structureCuboids({ buildType: s.buildType, grid: s.grid, rotation: s.rotation });
    // A level shot from outside the tile through its −Z edge hits that wall's panel first.
    const wall0 = walls.find((w) => w.structure.rotation === 0)!.structure;
    const shot = { origin: { x: 0, y: 1, z: -8 }, dir: { x: 0, y: 0, z: 1 } };
    const hitWall = rayStructureIntersection(shot.origin, shot.dir, 50, geometryOf(wall0))!;
    expect(hitWall.point.z).toBeCloseTo(-2.56 - 0.384, 6);
    // With that wall gone, the same line reaches the thin ramp surface inside the tile
    // only where a slab is (low steps at the −Z end), not an open column.
    const ramp = [...internal.bld.structures.values()].find((s: any) => s.buildType === "ramp");
    const highUnder = rayStructureIntersection({ x: 0, y: 1, z: -8 }, { x: 0, y: 0, z: 1 }, 50, geometryOf(ramp));
    expect(highUnder).not.toBeNull(); // the low end blocks at y = 1
    expect(rayStructureIntersection({ x: -8, y: 0.5, z: 2.0 }, { x: 1, y: 0, z: 0 }, 50, geometryOf(ramp))).toBeNull(); // open under the high end
  });
});
