/**
 * Authoritative Box Fight world bounds.
 *
 * Regression: the room integrated movement with no boundary, so sustained
 * input walked a player out to x ≈ 185. Every simulated input now confines
 * the capsule to PLAYABLE_ARENA_BOUNDS (the shared foundation-slab
 * footprint, applied identically by client prediction), and placements
 * outside the build volume are rejected before any Energy is charged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import { PLAYABLE_ARENA_BOUNDS, PLAYER_COLLIDER, BUILD_BOUNDS } from "@buildshift/game-config";
import { BUILD_EVENTS } from "@buildshift/protocol";

import { TWO_PLAYER_MOVEMENT_INPUT, TwoPlayerMovementRoom } from "./TwoPlayerMovementRoom.js";

const A = "a";
const B = "b";
const R = PLAYER_COLLIDER.radius;

describe("TwoPlayerMovementRoom authoritative arena bounds", () => {
  let room: TwoPlayerMovementRoom;
  let internal: any;
  let a: Client;
  let b: Client;
  let handlers: Map<string, (client: Client, message: unknown) => Promise<void> | void>;
  let seq = 0;

  const input = (client: Client, opts: Partial<{ moveX: number; moveZ: number }>) =>
    handlers.get(TWO_PLAYER_MOVEMENT_INPUT)!(client, { sequence: seq++, moveX: opts.moveX ?? 0, moveZ: opts.moveZ ?? 0, lookYaw: 0, lookPitch: 0, jump: false, crouch: false, primaryFire: false });
  const player = (id: string) => room.state.players.get(id)!;
  /** One input per tick for `ticks` ticks; returns every authoritative pose. */
  const hold = (opts: Partial<{ moveX: number; moveZ: number }>, ticks: number) => {
    const poses: { x: number; z: number }[] = [];
    for (let i = 0; i < ticks; i++) {
      input(a, opts);
      internal.tick();
      poses.push({ x: player(A).x, z: player(A).z });
    }
    return poses;
  };
  const inside = (p: { x: number; z: number }) =>
    p.x >= PLAYABLE_ARENA_BOUNDS.minX + R - 1e-9 && p.x <= PLAYABLE_ARENA_BOUNDS.maxX - R + 1e-9 &&
    p.z >= PLAYABLE_ARENA_BOUNDS.minZ + R - 1e-9 && p.z <= PLAYABLE_ARENA_BOUNDS.maxZ - R + 1e-9;

  beforeEach(async () => {
    room = new TwoPlayerMovementRoom();
    internal = room as any;
    await internal.pwp;
    handlers = new Map();
    vi.spyOn(room, "onMessage").mockImplementation(((type: string, fn: any) => { handlers.set(type, fn); }) as any);
    vi.spyOn(room, "setFixedTimestep").mockImplementation(() => {});
    vi.spyOn(room, "broadcast").mockImplementation(() => {});
    a = { sessionId: A, send: vi.fn() } as unknown as Client;
    b = { sessionId: B, send: vi.fn() } as unknown as Client;
    room.clients.push(a, b);
    room.onCreate();
    room.onJoin(a);
    room.onJoin(b);
    internal.br();
    seq = 0;
  });

  afterEach(() => {
    room.onDispose();
    room.clock.clear();
    vi.restoreAllMocks();
  });

  it("sustained forward movement stops at the authoritative boundary (−Z)", () => {
    const poses = hold({ moveZ: -1 }, 200); // 40 m of input
    expect(poses.every(inside)).toBe(true);
    expect(player(A).z).toBeCloseTo(PLAYABLE_ARENA_BOUNDS.minZ + R, 9);
  });

  it("sustained strafing stops at the authoritative boundary on X and diagonals", () => {
    const strafe = hold({ moveX: 1 }, 200); // yaw 0: +moveX is world −X
    expect(strafe.every(inside)).toBe(true);
    expect(player(A).x).toBeCloseTo(PLAYABLE_ARENA_BOUNDS.minX + R, 9);
    const diagonal = hold({ moveX: -1, moveZ: 1 }, 400);
    expect(diagonal.every(inside)).toBe(true);
    expect(player(A).x).toBeCloseTo(PLAYABLE_ARENA_BOUNDS.maxX - R, 9);
    expect(player(A).z).toBeCloseTo(PLAYABLE_ARENA_BOUNDS.maxZ - R, 9);
  });

  it("a queued input burst (catch-up) is confined by the same rule", () => {
    hold({ moveZ: -1 }, 70); // at the boundary
    internal.tick(); internal.tick(); internal.tick(); // bank catch-up credit
    for (let i = 0; i < 10; i++) input(a, { moveZ: -1 });
    internal.tick();
    expect(inside(player(A))).toBe(true);
    expect(player(A).z).toBeCloseTo(PLAYABLE_ARENA_BOUNDS.minZ + R, 9);
  });

  it("a rematch reset spawns inside and the boundary still holds afterwards", () => {
    hold({ moveZ: -1 }, 200);
    internal.resetMatch();
    internal.br();
    expect(inside(player(A))).toBe(true);
    hold({ moveZ: 1 }, 200);
    expect(player(A).z).toBeCloseTo(PLAYABLE_ARENA_BOUNDS.maxZ - R, 9);
  });

  it("rejects a placement outside the build volume without charging Energy", async () => {
    const energy = player(A).energy;
    const send = a.send as unknown as ReturnType<typeof vi.fn>;
    await handlers.get(BUILD_EVENTS.PLACEMENT_REQUEST)!(a, { sequence: 1, buildType: "wall", grid: { x: BUILD_BOUNDS.maxX + 1, y: 0, z: 0 }, rotation: 0 });
    expect(send).toHaveBeenCalledWith(BUILD_EVENTS.STRUCTURE_REJECTED, expect.objectContaining({ sequence: 1, reason: "invalid_grid" }));
    expect(player(A).energy).toBe(energy);
    expect(room.state.structures.size).toBe(0);
  });
});
