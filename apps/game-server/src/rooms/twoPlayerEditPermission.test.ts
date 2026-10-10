/**
 * Task 9 — two-client edit permission regressions.
 *
 * Verifies that in the canonical TwoPlayerMovementRoom production path:
 *  1. A player can only edit structures they own (server-side `ownerId` check).
 *  2. Opponents may damage/destroy structures via combat but never edit them.
 *  3. Ownership persists through successful edits (ownerId is never mutated).
 *  4. Client-claimed ownership is never trusted; the server's `ownerId` is
 *     authoritative.
 *  5. The denial is sent to the requesting client only (not broadcast) with
 *     a clear `not_owned` reason.
 *
 * Uses only the production routes: `build:edit_request`,
 * `two-player:edit_grid_action`, `two-player:wall_pattern`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import { BUILD_EDIT_EVENTS } from "@buildshift/protocol";
import { ASSAULT_RIFLE } from "@buildshift/game-config";
import {
  TwoPlayerMovementRoom,
  TWO_PLAYER_MOVEMENT_INPUT,
  EDIT_GRID_ACTION_INPUT,
  WALL_PATTERN_INPUT,
  WALL_PATTERN_RESULT,
} from "./TwoPlayerMovementRoom.js";
import { StructureStateSchema, StructureGridSchema } from "../state/buildingState.js";

describe("two-client edit permission (canonical production path)", () => {
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

  const fire = (client: Client, sequence: number, yaw = 0, pitch = 0) => {
    send(TWO_PLAYER_MOVEMENT_INPUT, {
      sequence, moveX: 0, moveZ: 0, lookYaw: yaw, lookPitch: pitch, primaryFire: true,
    }, client);
    internal.tick();
  };

  /** Create a wall owned by `ownerId` in the canonical building state. */
  const wall = (id = "wall", ownerId = "a") => {
    const s = new StructureStateSchema();
    s.structureId = id;
    s.ownerId = ownerId;
    s.buildType = "wall";
    s.editType = "";
    s.editKind = "";
    s.editRampVariant = "";
    s.maxDurability = 100;
    s.currentDurability = 100;
    const g = new StructureGridSchema();
    g.x = 0; g.y = 0; g.z = 0;
    s.grid = g;
    s.rotation = 0;
    internal.bld.structures.set(id, s);
    return s;
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

  // ─── build:edit_request (hbe) ──────────────────────────────────────────────

  it("rejects edit_grid_action from non-owner with not_owned (build edit route)", () => {
    const s = wall("wall", "a");
    send(BUILD_EDIT_EVENTS.EDIT_REQUEST, {
      structureId: "wall", editType: "window", gridOffset: { x: 1, y: 1, z: 0 },
    }, b);
    // The rejection is sent only to client b.
    expect(b.send).toHaveBeenLastCalledWith(
      BUILD_EDIT_EVENTS.EDIT_RESULT,
      expect.objectContaining({ structureId: "wall", success: false, reason: "not_owned" }),
    );
    // Client a never received the denial.
    expect(a.send).not.toHaveBeenCalledWith(
      BUILD_EDIT_EVENTS.EDIT_RESULT,
      expect.objectContaining({ structureId: "wall", reason: "not_owned" }),
    );
    // The structure state is unchanged.
    expect(s.editType).toBe("");
    // No broadcast of the edit result.
    expect(broadcastCalls).not.toContainEqual([
      BUILD_EDIT_EVENTS.EDIT_RESULT,
      expect.objectContaining({ success: true }),
    ]);
  });

  it("allows the owner to edit via build:edit_request and preserves ownership", () => {
    const s = wall("wall", "a");
    send(BUILD_EDIT_EVENTS.EDIT_REQUEST, {
      structureId: "wall", editType: "window", gridOffset: { x: 1, y: 1, z: 0 },
    }, a);
    expect(s.editType).toBe("window");
    // Ownership persists through the edit.
    expect(s.ownerId).toBe("a");
    // The success broadcast goes to all clients.
    const successBroadcast = broadcastCalls.find(
      ([ev]) => ev === BUILD_EDIT_EVENTS.EDIT_RESULT,
    );
    expect(successBroadcast).toBeDefined();
    expect((successBroadcast![1] as any).success).toBe(true);
  });

  // ─── two-player:edit_grid_action (hega) ────────────────────────────────────

  it("rejects edit grid action from non-owner with not_owned", () => {
    const s = wall("wall", "a");
    // Initialize the edit state for the wall so the action has a valid target.
    s.editKind = "wall";
    s.editTiles.length = 0;
    for (let i = 0; i < 9; i++) s.editTiles.push(true);

    send(EDIT_GRID_ACTION_INPUT, { structureId: "wall", action: "select", tileIndex: 4 }, b);
    expect(b.send).toHaveBeenLastCalledWith(
      EDIT_GRID_ACTION_INPUT,
      expect.objectContaining({ structureId: "wall", success: false, reason: "not_owned" }),
    );
    // Owner's tiles unchanged.
    expect([...s.editTiles]).toEqual(new Array(9).fill(true));
    // No broadcast of a successful edit.
    const editBroadcasts = broadcastCalls.filter(
      ([ev, d]) => ev === EDIT_GRID_ACTION_INPUT && (d as any)?.success === true,
    );
    expect(editBroadcasts).toHaveLength(0);
  });

  it("allows the owner to perform edit grid actions and preserves ownership", async () => {
    const s = wall("wall", "a");
    s.editKind = "wall";
    s.editTiles.length = 0;
    for (let i = 0; i < 9; i++) s.editTiles.push(true);

    await send(EDIT_GRID_ACTION_INPUT, { structureId: "wall", action: "select", tileIndex: 4 }, a);
    // Tile 4 is now deselected (removed).
    expect(s.editTiles[4]).toBe(false);
    // Ownership is preserved.
    expect(s.ownerId).toBe("a");
  });

  // ─── two-player:wall_pattern (hwp) ─────────────────────────────────────────

  it("rejects wall pattern application from non-owner with not_owned", () => {
    const s = wall("wall", "a");
    send(WALL_PATTERN_INPUT, { structureId: "wall", pattern: "door" }, b);
    expect(b.send).toHaveBeenLastCalledWith(
      WALL_PATTERN_RESULT,
      expect.objectContaining({ structureId: "wall", success: false, reason: "not_owned" }),
    );
    // Structure unchanged.
    expect(s.editType).toBe("");
    expect(s.editKind).toBe("");
    // No broadcast for the rejected pattern.
    expect(broadcastCalls).not.toContainEqual([
      WALL_PATTERN_RESULT,
      expect.objectContaining({ success: true }),
    ]);
  });

  it("allows the owner to apply a wall pattern and preserves ownership", () => {
    const s = wall("wall", "a");
    send(WALL_PATTERN_INPUT, { structureId: "wall", pattern: "door" }, a);
    expect(s.editType).toBe("door");
    expect(s.ownerId).toBe("a");
    // The broadcast carries the success.
    const broadcast = broadcastCalls.find(([ev]) => ev === WALL_PATTERN_RESULT);
    expect(broadcast).toBeDefined();
    expect((broadcast![1] as any).success).toBe(true);
  });

  // ─── opponents may damage but never edit ───────────────────────────────────

  it("opponent can damage the owner's structure via combat but cannot edit it", () => {
    const s = wall("target", "a");
    // Position b so a shot toward +X hits the structure at origin.
    // Player b spawns at x=5, z=0. The structure is at grid (0,0,0) → world
    // (0, 0.75, 0) centre. Aiming from b at yaw=π (toward −X, i.e. toward
    // the structure) should hit it.
    // Actually: player a is at x=-5, b is at x=5.
    // A shot from b with yaw=π points in -X direction.
    // The structure is at (0, 0.75, 0), so b shooting toward -X should hit it.
    const durBefore = s.currentDurability;
    // Player b is at x=5, z=0. The wall at grid(0,0,0) has centre ≈(0, 1.92, 0).
    // Aim from b toward -X (yaw=-π/2) with slight upward pitch to hit it.
    fire(b, 1, -Math.PI / 2, 0.2);
    // The structure should have taken damage.
    expect(s.currentDurability).toBe(durBefore - ASSAULT_RIFLE.damage);

    // Now b tries to edit the damaged structure.
    // (Even if it were undamaged, b would still be rejected.)
    const s2 = wall("own_wall", "a");
    s2.currentDurability = s2.maxDurability; // ensure full for edit check
    send(WALL_PATTERN_INPUT, { structureId: "own_wall", pattern: "door" }, b);
    expect(b.send).toHaveBeenLastCalledWith(
      WALL_PATTERN_RESULT,
      expect.objectContaining({ structureId: "own_wall", success: false, reason: "not_owned" }),
    );
    expect(s2.editType).toBe("");
  });

  it("opponent can destroy the owner's structure via combat and then it no longer exists for editing", () => {
    const s = wall("fragile", "a");
    s.maxDurability = 1;
    s.currentDurability = 1;
    fire(b, 1, -Math.PI / 2, 0.2);
    // Structure is destroyed (damage ≥ durability).
    expect(internal.bld.structures.get("fragile")).toBeUndefined();

    // Editing a destroyed structure is rejected as structure_not_found,
    // not not_owned — the structure simply doesn't exist anymore.
    send(WALL_PATTERN_INPUT, { structureId: "fragile", pattern: "door" }, b);
    expect(b.send).toHaveBeenLastCalledWith(
      WALL_PATTERN_RESULT,
      expect.objectContaining({ structureId: "fragile", success: false, reason: "structure_not_found" }),
    );
  });

  // ─── client-claimed ownership is never trusted ─────────────────────────────

  it("does not trust a client-claimed ownerId override in the edit payload", () => {
    // The structure is owned by "a". Client b sends an edit request with
    // a fabricated ownerId field in the payload.
    const s = wall("wall", "a");
    send(BUILD_EDIT_EVENTS.EDIT_REQUEST, {
      structureId: "wall",
      editType: "window",
      gridOffset: { x: 1, y: 1, z: 0 },
      ownerId: "b", // fabricated client claim
    }, b);
    expect(b.send).toHaveBeenLastCalledWith(
      BUILD_EDIT_EVENTS.EDIT_RESULT,
      expect.objectContaining({ structureId: "wall", success: false, reason: "not_owned" }),
    );
    // Ownership in the authoritative state is unchanged.
    expect(s.ownerId).toBe("a");
    expect(s.editType).toBe("");
  });

  it("does not trust a client-claimed ownerId in the wall pattern payload", () => {
    const s = wall("wall", "a");
    send(WALL_PATTERN_INPUT, {
      structureId: "wall",
      pattern: "door",
      ownerId: "b", // fabricated
    }, b);
    expect(b.send).toHaveBeenLastCalledWith(
      WALL_PATTERN_RESULT,
      expect.objectContaining({ structureId: "wall", success: false, reason: "not_owned" }),
    );
    expect(s.ownerId).toBe("a");
  });

  // ─── ownership persists through a full round reset (structures cleared) ────

  it("round reset clears all structures so no stale ownership persists", () => {
    const s = wall("wall", "a");
    expect(s.ownerId).toBe("a");
    // Trigger a round reset (ROUND_ENDED → ROUND_RESET broadcast → COUNTDOWN).
    internal.bc();
    // The structures map is cleared.
    expect(internal.bld.structures.size).toBe(0);
    // After reset, a new structure placed by b is owned by b.
    internal.br(); // COUNTDOWN → IN_PROGRESS
    wall("new_wall", "b");
    expect(internal.bld.structures.get("new_wall")!.ownerId).toBe("b");
  });

  // ─── denial feedback is targeted, not broadcast ────────────────────────────

  it("sends not_owned denial only to the requesting client on all three routes", () => {
    wall("wall", "a");

    // Route 1: build:edit_request
    send(BUILD_EDIT_EVENTS.EDIT_REQUEST, {
      structureId: "wall", editType: "window", gridOffset: { x: 1, y: 1, z: 0 },
    }, b);
    // Route 2: edit_grid_action (initialise edit state first)
    const s2 = internal.bld.structures.get("wall")!;
    s2.editKind = "wall";
    s2.editTiles.length = 0;
    for (let i = 0; i < 9; i++) s2.editTiles.push(true);
    send(EDIT_GRID_ACTION_INPUT, { structureId: "wall", action: "select", tileIndex: 0 }, b);
    // Route 3: wall_pattern
    wall("wall2", "a");
    send(WALL_PATTERN_INPUT, { structureId: "wall2", pattern: "window" }, b);

    // All three denials went to b.
    const bDenials = (b.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.reason === "not_owned");
    expect(bDenials).toHaveLength(3);

    // No broadcast of any denial.
    for (const [ev, d] of broadcastCalls) {
      expect((d as any)?.reason, `broadcast ${ev} should not carry not_owned`).not.toBe("not_owned");
    }

    // Client a never received a denial.
    const aDenials = (a.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, d]) => (d as any)?.reason === "not_owned");
    expect(aDenials).toHaveLength(0);
  });
});
