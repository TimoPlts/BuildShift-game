/**
 * Server-side crouch authority tests for the canonical `TwoPlayerMovementRoom`.
 *
 * Covers the crouch feature end-to-end through the production room + shared
 * simulation (no private-state mocks; only the WebSocket transport is stubbed):
 *
 *   1. crouch state is replicated (`crouch` flips on down, off on release);
 *   2. a crouched player moves slower than a standing one (shared-config factor);
 *   3. a head-height shot HITS a standing player;
 *   4. the same head-height shot MISSES a crouched player (reduced hitbox);
 *   5. standing up is DENIED while a low ceiling obstructs the standing capsule;
 *   6. standing up is ALLOWED once the player is clear of that geometry;
 *   7. a crouched player can still fire (at a lowered body-height target);
 *   8. a crouched player can still perform a wall edit.
 *
 * Geometry notes (metres, Y-up, feet on the ground at y=0):
 *   - standing capsule top ≈ 1.8, crouched capsule top ≈ 1.2;
 *   - standing hit sphere: centre y=0.9, r=0.4 → spans [0.5, 1.3];
 *   - crouched hit sphere: centre y=0.6, r=0.35 → spans [0.25, 0.95];
 *   - the ceiling slab bottom sits at y=1.35 (clears crouch, obstructs stand).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import {
  ASSAULT_RIFLE,
  MAX_HEALTH,
  MAX_SHIELD,
  PLAYER_MOVEMENT,
  structureCuboids, wallEdgeCenter,
} from "@buildshift/game-config";
import { BUILD_EVENTS, EVENTS } from "@buildshift/protocol";
import {
  TwoPlayerMovementRoom,
  TWO_PLAYER_MOVEMENT_INPUT,
  EDIT_GRID_ACTION_INPUT,
} from "./TwoPlayerMovementRoom.js";
import { StructureStateSchema, StructureGridSchema } from "../state/buildingState.js";

const A = "a";
const B = "b";

/**
 * Spawn X positions (see onJoin): A at x=-5, B at x=+5, both at y=0, z=0. The
 * head-height aim geometry below assumes the players remain at these positions
 * (10 m apart along +X).
 */
const SPAWN_DX = 10;

describe("TwoPlayerMovementRoom crouch authority", () => {
  let room: TwoPlayerMovementRoom;
  let internal: any;
  let a: Client;
  let b: Client;
  let handlers: Map<string, (client: Client, message: unknown) => Promise<void> | void>;

  const send = (type: string, value: unknown, client: Client = a): Promise<void> | void => {
    const handler = handlers.get(type);
    expect(handler, `registered production route ${type}`).toBeDefined();
    return handler!(client, value);
  };

  /** Send a movement input for `client` and advance exactly one tick. */
  const move = (
    client: Client,
    sequence: number,
    opts: Partial<{
      moveX: number;
      moveZ: number;
      lookYaw: number;
      lookPitch: number;
      jump: boolean;
      crouch: boolean;
      primaryFire: boolean;
    }> = {},
  ): void => {
    send(TWO_PLAYER_MOVEMENT_INPUT, {
      sequence,
      moveX: opts.moveX ?? 0,
      moveZ: opts.moveZ ?? 0,
      lookYaw: opts.lookYaw ?? 0,
      lookPitch: opts.lookPitch ?? 0,
      jump: opts.jump ?? false,
      crouch: opts.crouch ?? false,
      primaryFire: opts.primaryFire ?? false,
    }, client);
    internal.tick();
  };

  const player = (id: string) => room.state.players.get(id)!;

  /** HIT events broadcast with `targetId` as the target. */
  const hitEventsFor = (targetId: string): any[] =>
    (room.broadcast as any).mock.calls.filter(
      (c: any[]) => c[0] === EVENTS.HIT && c[1]?.targetId === targetId,
    );

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
    a = { sessionId: A, send: vi.fn() } as unknown as Client;
    b = { sessionId: B, send: vi.fn() } as unknown as Client;
    room.clients.push(a, b);
    room.onCreate();
    room.onJoin(a);
    room.onJoin(b);
    // Set the round IN_PROGRESS with a clean input buffer (movement + fire
    // inputs are then processed on the next tick).
    internal.br();
  });

  afterEach(() => {
    room.onDispose();
    room.clock.clear();
    vi.restoreAllMocks();
  });

  it("replicates crouch state: crouching down sets crouch, releasing (unobstructed) clears it", () => {
    expect(player(A).crouch).toBe(false);
    move(a, 0, { crouch: true });
    expect(player(A).crouch).toBe(true);
    move(a, 1, { crouch: false });
    expect(player(A).crouch).toBe(false);
  });

  it("moves a crouched player slower than a standing one", () => {
    const z0 = player(A).z;
    move(a, 0, { crouch: false, moveZ: -1 });
    const dzStand = z0 - player(A).z;
    const z1 = player(A).z;
    move(a, 1, { crouch: true, moveZ: -1 });
    const dzCrouch = z1 - player(A).z;

    expect(dzStand).toBeGreaterThan(0);
    expect(dzCrouch).toBeGreaterThan(0);
    // Crouch uses moveSpeed * crouchSpeedFactor, so the per-tick displacement
    // ratio equals the shared factor (0.55) — well inside (0.5, 0.6).
    const factor = PLAYER_MOVEMENT.crouchSpeedFactor;
    expect(dzCrouch / dzStand).toBeGreaterThan(factor - 0.05);
    expect(dzCrouch / dzStand).toBeLessThan(factor + 0.05);
  });

  it("a head-height shot HITS a standing player", () => {
    // A (-5,0,0) standing (origin y=0.9) aims +X at B (5,0,0); the ray rises
    // from y=0.9 to y=1.1 at B — inside the standing sphere [0.5, 1.3].
    const yaw = Math.PI / 2;
    const pitch = Math.atan2(0.2, SPAWN_DX);
    const shieldBefore = player(B).shield;
    move(a, 100, { crouch: false, lookYaw: yaw, lookPitch: pitch, primaryFire: true });

    expect(hitEventsFor(B).length).toBe(1);
    expect(player(B).shield).toBe(shieldBefore - ASSAULT_RIFLE.damage);
  });

  it("a head-height shot MISSES a crouched player (reduced hitbox)", () => {
    move(b, 50, { crouch: true });
    expect(player(B).crouch).toBe(true);
    // Same aim as the standing case: ray at y=1.1 at B, which is above the
    // crouched sphere [0.25, 0.95] → miss.
    const yaw = Math.PI / 2;
    const pitch = Math.atan2(0.2, SPAWN_DX);
    move(a, 100, { crouch: false, lookYaw: yaw, lookPitch: pitch, primaryFire: true });

    expect(hitEventsFor(B).length).toBe(0);
    expect(player(B).shield).toBe(MAX_SHIELD);
    expect(player(B).health).toBe(MAX_HEALTH);
  });

  it("denies standing up while a low ceiling obstructs the standing capsule", () => {
    // Ceiling slab centred over B at y=1.6 with half-height 0.25 → bottom at
    // y=1.35. The crouched capsule (top 1.2) clears it; the standing capsule
    // (top 1.8) is obstructed.
    internal.pw.addStructureCollider("ceil", { x: 5, y: 1.6, z: 0 }, { x: 2, y: 0.25, z: 2 });
    move(b, 50, { crouch: true });
    expect(player(B).crouch).toBe(true);
    // Release crouch under the ceiling → stand-up denied, stays crouched.
    move(b, 60, { crouch: false });
    expect(player(B).crouch).toBe(true);
  });

  it("allows standing up once clear of the obstructing geometry", () => {
    internal.pw.addStructureCollider("ceil", { x: 5, y: 1.6, z: 0 }, { x: 2, y: 0.25, z: 2 });
    move(b, 50, { crouch: true });
    move(b, 60, { crouch: false }); // denied while under the ceiling
    expect(player(B).crouch).toBe(true);
    // Move B clear of the ceiling's footprint (x=5 → x=20).
    player(B).x = 20;
    move(b, 70, { crouch: false }); // now the standing capsule is clear
    expect(player(B).crouch).toBe(false);
  });

  it("can fire while crouched at a lowered body-height target", () => {
    move(b, 50, { crouch: true });
    // A crouches (origin y=0.6) and aims horizontally (+X) at B's crouch centre
    // (y=0.6) → direct hit on the lowered body.
    move(a, 100, { crouch: true, lookYaw: Math.PI / 2, lookPitch: 0, primaryFire: true });

    expect(hitEventsFor(B).length).toBe(1);
    expect(player(B).shield).toBe(MAX_SHIELD - ASSAULT_RIFLE.damage);
  });

  it("can perform a wall edit while crouched", async () => {
    move(a, 50, { crouch: true });
    expect(player(A).crouch).toBe(true);

    // A wall structure owned by A at the origin.
    const s = new StructureStateSchema();
    s.structureId = "wall";
    s.ownerId = A;
    s.buildType = "wall";
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

    await send(EDIT_GRID_ACTION_INPUT, { structureId: "wall", action: "select", tileIndex: 4 });
    expect(s.editTiles[4]).toBe(false);
    expect(room.broadcast).toHaveBeenCalledWith(
      EDIT_GRID_ACTION_INPUT,
      expect.objectContaining({ structureId: "wall", success: true }),
    );
  });

  it("builds while crouched through the canonical placement route", async () => {
    move(a, 60, { crouch: true });
    await send(BUILD_EVENTS.PLACEMENT_REQUEST, {
      sequence: 600, buildType: "wall", grid: { x: -1, y: 0, z: 0 }, rotation: 0,
    });
    expect(player(A).crouch).toBe(true);
    expect([...internal.bld.structures.values()].some((s: any) => s.ownerId === A)).toBe(true);
  });

  it("crosses a low edited opening crouched and rejects standing until clear", () => {
    const p = player(A);
    // Walls are edge pieces: rotation 0 stands on the tile's −Z edge.
    const PZ = wallEdgeCenter({ x: 0, y: 0, z: 0 }, 0).z;
    p.x = 0; p.y = 0; p.z = PZ - 1; p.yaw = 0;
    const wall = structureCuboids({ buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0,
      editGrid: { kind: "wall", tiles: [true, true, true, true, true, true, false, false, false] } });
    internal.pw.setStructureColliders("opening", wall);
    for (let sequence = 1; sequence <= 8; sequence++) move(a, sequence, { moveZ: 1 });
    expect(p.z).toBeLessThan(PZ - 0.7);
    for (let sequence = 9; sequence <= 20; sequence++) move(a, sequence, { moveZ: 1, crouch: true });
    expect(p.z).toBeGreaterThan(PZ - 0.1);
    move(a, 21, { crouch: false });
    expect(p.crouch).toBe(true);
    for (let sequence = 22; sequence <= 40; sequence++) move(a, sequence, { moveZ: 1, crouch: true });
    move(a, 41, { crouch: false });
    expect(p.crouch).toBe(false);
  });
});
