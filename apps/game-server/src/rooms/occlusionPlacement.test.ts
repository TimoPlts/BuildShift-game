/**
 * Placement OCCLUSION — authoritative server contract.
 *
 * A structure may only be placed where it is VISIBLE from the canonical
 * shared eye (standing 1.2 / crouch 0.9 above the replicated feet position)
 * against the canonical, edit-aware solids (`structureCuboids` — retained
 * tiles only, so edited doors/windows are real holes). The check is the
 * shared `placementIsVisible` policy, fed ONLY with server state: a forged
 * placement packet for a slot behind a closed wall is rejected with
 * `occluded` and ZERO side effects — no Energy spend, no structure, no
 * physics collider, no broadcast. Both ownerships are blocked identically
 * (obstruction is pure geometry). Candidates touching a wall's own face,
 * adjacent cells, and slots seen through a real edited hole stay accepted
 * on the usual rules.
 *
 * Direct-room pattern of `preparationPlacement.test.ts` — no network stack.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import { BUILD_EVENTS, MatchPhase } from "@buildshift/protocol";
import { EDIT_GRID_ACTION_INPUT } from "./TwoPlayerMovementRoom.js";
import { ENERGY, getStructureConfig } from "@buildshift/game-config";
import { TwoPlayerMovementRoom } from "./TwoPlayerMovementRoom.js";

describe("placement occlusion (through-solid-wall rejection, server-authoritative)", () => {
  let room: TwoPlayerMovementRoom;
  let internal: any;
  let a: Client;
  let b: Client;
  let handlers: Map<string, (client: Client, message: unknown) => Promise<void> | void>;
  let sequence = 100;
  let placedEvents: unknown[] = [];

  const rejectionsFor = (client: Client) => (client.send as ReturnType<typeof vi.fn>).mock.calls
    .filter(([type]) => type === BUILD_EVENTS.STRUCTURE_REJECTED)
    .map(([, d]) => d as { sequence: number; reason: string });

  const place = async (c: Client, buildType: string, grid: { x: number; y: number; z: number }, rotation: number) => {
    internal.tc += 100; // clear the placement-rate window between requests
    const seq = ++sequence;
    const before = internal.state.players.get(c.sessionId)!.energy;
    await handlers.get(BUILD_EVENTS.PLACEMENT_REQUEST)!(c, { sequence: seq, buildType, grid, rotation });
    const structure = [...internal.bld.structures.values()].find((s: any) => s.createdSequence === seq);
    return {
      structure,
      rejection: rejectionsFor(c).find(r => r.sequence === seq),
      energyDelta: internal.state.players.get(c.sessionId)!.energy - before,
    };
  };

  /** Feet position of a player (the replicated pose the server eye is built from). */
  const moveTo = (sid: string, x: number, z: number) => {
    const pl = internal.state.players.get(sid)!;
    pl.x = x; pl.y = 0; pl.z = z;
  };

  /** The wall between grid rows z=1 and z=2 (rotation 0 stands on the −Z edge of (0,·,1)). */
  const WALL = { x: 0, y: 0, z: 1 };
  const BEHIND = { x: 0, y: 0, z: 2 };
  const IN_FRONT = { x: 0, y: 0, z: 0 };

  beforeEach(async () => {
    room = new TwoPlayerMovementRoom();
    internal = room as any;
    a = { sessionId: "a", send: vi.fn() } as unknown as Client;
    b = { sessionId: "b", send: vi.fn() } as unknown as Client;
    await internal.pwp;
    handlers = new Map();
    vi.spyOn(room, "onMessage").mockImplementation(((type: string, fn: any) => { handlers.set(type, fn); }) as any);
    vi.spyOn(room, "setFixedTimestep").mockImplementation(() => {});
    placedEvents = [];
    vi.spyOn(room, "broadcast").mockImplementation(((ev: string, data: any) => {
      if (ev === BUILD_EVENTS.STRUCTURE_PLACED) placedEvents.push(data);
    }) as any);
    room.clients.push(a, b);
    room.onCreate();
    room.onJoin(a);
    room.onJoin(b);
    // Fight phase: the occlusion gate applies identically here, and the
    // preparation-row rule is out of the way.
    internal.br(); // gates drop → IN_PROGRESS
    expect(room.state.matchPhase).toBe(MatchPhase.IN_PROGRESS);
    for (const sid of ["a", "b"]) {
      const pl = internal.state.players.get(sid)!;
      pl.energy = ENERGY.maxEnergy;
      pl.crouch = false;
    }
    // A stands in front of the future wall (feet y = 0, eye 1.2); B behind it.
    moveTo("a", 0, 1);
    moveTo("b", 0, 10);
  });

  afterEach(() => {
    room.onDispose();
    room.clock.clear();
    vi.restoreAllMocks();
  });

  it("rejects an in-range forged placement on the FAR side of an enemy wall — occluded, zero side effects", async () => {
    const wall = await place(b, "wall", WALL, 0);
    expect(wall.rejection).toBeUndefined(); // B legitimately owns the wall

    // A forges a placement two cells away, straight THROUGH the closed panel
    // (in range, own candidate, valid rotation, affordable — everything but
    // visibility passes; only the shared line-of-sight rule can refuse).
    const r = await place(a, "floor", BEHIND, 0);
    expect(r.rejection?.reason).toBe("occluded");
    expect(r.structure).toBeUndefined();
    expect(r.energyDelta).toBe(0); // no Energy spent
    expect(placedEvents.filter((d: any) => d.structure?.createdSequence !== undefined)
      .some((d: any) => d.structure.createdSequence > 101)).toBe(false); // no broadcast past the legit wall
    // No physics collider exists for the refused structure.
    const ids = [...internal.bld.structures.keys()];
    expect(ids).toHaveLength(1); // only B's wall
  });

  it("rejects a player placing THROUGH their own wall from the other side (both ownerships)", async () => {
    expect((await place(a, "wall", WALL, 0)).rejection).toBeUndefined(); // A owns the wall
    // B behind the wall forges the cell in front of it.
    const r = await place(b, "floor", IN_FRONT, 0);
    expect(r.rejection?.reason).toBe("occluded");
    expect(r.energyDelta).toBe(0);
    expect(r.structure).toBeUndefined();
  });

  it("accepts the near-face / adjacent candidates a wall legitimately supports", async () => {
    expect((await place(b, "wall", WALL, 0)).rejection).toBeUndefined();
    // The cell in FRONT of the wall (the eye sees its own ground; nothing is
    // crossed) — placed by the player on that side.
    const near = await place(a, "floor", IN_FRONT, 0);
    expect(near.rejection).toBeUndefined();
    expect(near.energyDelta).toBe(-getStructureConfig("floor")!.cost);
  });

  it("a real edited hole passes: floor placed through the opened door tile", async () => {
    const wall = await place(b, "wall", WALL, 0);
    expect(wall.rejection).toBeUndefined();
    expect(await place(a, "floor", BEHIND, 0)).toMatchObject({ rejection: { reason: "occluded" } });

    // Apply the edit exactly as the edit pipeline replicates it: remove the
    // bottom-middle tile (row 2, col 1 → i = 7) → a 1.7 × 1.28 m doorway.
    const schema = [...internal.bld.structures.values()][0]!;
    schema.editTiles[7] = false;

    const through = await place(a, "floor", BEHIND, 0);
    expect(through.rejection).toBeUndefined();
    expect(through.energyDelta).toBe(-getStructureConfig("floor")!.cost);
    expect(through.structure).toBeDefined();
    // And B can place the front cell through the same hole, from behind.
    expect((await place(b, "floor", IN_FRONT, 0)).rejection).toBeUndefined();
  });

  it("the eye is the authoritative pose — a standing eye cannot see what a crouched one could and vice versa is the SERVER's flag", async () => {
    expect((await place(b, "wall", WALL, 0)).rejection).toBeUndefined();
    // A forges crouch=false etc. — irrelevant: the request carries NO pose.
    // With A's REPLICATED pose standing (eye 1.2) the behind cell is hidden.
    expect((await place(a, "floor", BEHIND, 0)).rejection?.reason).toBe("occluded");
    // Crouching on the server lowers the shared eye to 0.9 — still behind a
    // full closed panel, still occluded (the wall spans the whole layer).
    internal.state.players.get("a")!.crouch = true;
    expect((await place(a, "floor", BEHIND, 0)).rejection?.reason).toBe("occluded");
  });

  it("structures never place through a SECOND closed wall either (multi-blocker)", async () => {
    expect((await place(b, "wall", WALL, 0)).rejection).toBeUndefined();
    // Row z=2 wall behind the first (both closed); the target cell is z=3.
    expect((await place(b, "wall", { x: 0, y: 0, z: 2 }, 3)).rejection).toBeUndefined(); // rot 3: −X edge of (0,·,2) — perpendicular, does not close this aim
    moveTo("b", 0, 1); // keep both walls' owner able to act; A stays in front
    moveTo("a", 0, 1);
    const r = await place(a, "floor", { x: 0, y: 0, z: 2 }, 0);
    // Cell (0,0,2) sits BETWEEN the two panels: it is visible over nothing…
    // the −Z-edge panel of row 1 blocks the low samples from A in front.
    expect(r.rejection?.reason).toBe("occluded");
  });

  // ─── EDIT-INTENT AUTHORITY (repair pass) ────────────────────────────────
  // Placement LOS alone is not authority: a forged `hega` packet could edit
  // a far-away structure or punch a hole through a panel from its covered
  // side. The room now gates every edit on canonical edit reach (10.24 m
  // from the authoritative eye to the target region) and exact-geometry LOS
  // to a real face of the addressed tile. Rejections mutate nothing and
  // broadcast nothing; Energy is never touched by edits.

  const edit = async (c: Client, structureId: string, action: string, tileIndex?: number) => {
    await handlers.get(EDIT_GRID_ACTION_INPUT)!(c, { structureId, action, ...(tileIndex === undefined ? {} : { tileIndex }) });
    // Rejections come back on the requester's socket; successes broadcast.
    const calls = [...(c.send as ReturnType<typeof vi.fn>).mock.calls,
      ...(room.broadcast as ReturnType<typeof vi.fn>).mock.calls]
      .filter(([type]) => type === EDIT_GRID_ACTION_INPUT).map(([, d]) => d as { structureId: string; success: boolean; reason?: string });
    return calls[calls.length - 1];
  };
  const editBroadcasts = () => (room.broadcast as ReturnType<typeof vi.fn>).mock.calls
    .filter(([ev]) => ev === EDIT_GRID_ACTION_INPUT);
  const resetEditCalls = () => { // isolate broadcast counting per assertion
    (room.broadcast as ReturnType<typeof vi.fn>).mockClear();
    (a.send as ReturnType<typeof vi.fn>).mockClear();
    (b.send as ReturnType<typeof vi.fn>).mockClear();
  };

  it("a facing owner edit succeeds: the tile's real face is visible from the shared eye", async () => {
    const wall = await place(a, "wall", WALL, 0);
    expect(wall.rejection).toBeUndefined();
    const before = internal.state.players.get("a").energy;
    const r = await edit(a, wall.structure.structureId, "select", 4); // centre tile
    expect(r.success).toBe(true);
    const s = [...internal.bld.structures.values()][0] as any;
    expect(s.editTiles[4]).toBe(false); // removal applied
    expect(internal.state.players.get("a").energy).toBe(before); // edits never cost Energy
  });

  it("rejects a forged through-panel edit of the owner's OWN tile from the covered side — occluded, no mutation, no broadcast", async () => {
    const wall = await place(a, "wall", WALL, 0); // A's wall between rows 1/2
    expect(wall.rejection).toBeUndefined();
    // B raises a closed screen wall one row in front of A — from the front
    // side, so B's own placement is legitimate (not through A's wall).
    moveTo("b", 0, -1);
    const shield = await place(b, "wall", { x: 0, y: 0, z: 0 }, 0);
    expect(shield.rejection).toBeUndefined();
    moveTo("a", 0, -3.6); // A behind the screen: its own wall is 5.8 m away — IN RANGE but unseen
    resetEditCalls();
    const before = internal.state.players.get("a").energy;
    const bcasts = editBroadcasts().length;
    const r = await edit(a, wall.structure.structureId, "select", 4);
    expect(r.success).toBe(false);
    expect(r.reason).toBe("occluded");
    const s = internal.bld.structures.get(wall.structure.structureId) as any;
    expect([...s.editTiles].every(Boolean)).toBe(true); // last valid state preserved
    expect(internal.state.players.get("a").energy).toBe(before); // zero Energy movement
    expect(editBroadcasts().length).toBe(bcasts); // nothing broadcast
  });

  it("rejects an out-of-range edit intent even when plainly visible — out_of_range before any mutation", async () => {
    const wall = await place(a, "wall", WALL, 0);
    expect(wall.rejection).toBeUndefined();
    moveTo("a", 0, -9.4); // eye 11.7 m from the panel face — beyond the shared 10.24 m edit range
    const r = await edit(a, wall.structure.structureId, "select", 4);
    expect(r.success).toBe(false);
    expect(r.reason).toBe("out_of_range");
    const s = internal.bld.structures.get(wall.structure.structureId) as any;
    expect([...s.editTiles].every(Boolean)).toBe(true);
  });

  it("the edit eye honours the authoritative crouch — a crouched owner still faces its near tile", async () => {
    const wall = await place(a, "wall", WALL, 0);
    expect(wall.rejection).toBeUndefined();
    internal.state.players.get("a").crouch = true; // server-side crouch: shared eye 0.9
    const r = await edit(a, wall.structure.structureId, "select", 1); // bottom-centre tile
    expect(r.success).toBe(true);
    const s = internal.bld.structures.get(wall.structure.structureId) as any;
    expect(s.editTiles[1]).toBe(false);
  });

  it("an edit that would remove ALL cone tiles is rejected (invisible-ghost rule); the corner and reset stay valid", async () => {
    const cone = await place(a, "cone", WALL, 0);
    expect(cone.rejection).toBeUndefined();
    const id = cone.structure.structureId;
    const s = internal.bld.structures.get(id) as any;
    moveTo("a", 0, 9.5); // face the cone from behind (+Z side), close and in range
    for (const tile of [3, 2, 1]) {
      expect((await edit(a, id, "select", tile)).success).toBe(true); // three corners come off
    }
    expect([...s.editTiles]).toEqual([true, false, false, false]);
    resetEditCalls();
    const before = internal.state.players.get("a").energy;
    const bcasts = editBroadcasts().length;
    const last = await edit(a, id, "select", 0); // the final corner would empty the cone
    expect(last.success).toBe(false);
    expect(last.reason).toBe("invalid_form");
    expect([...s.editTiles]).toEqual([true, false, false, false]); // last valid state, colliders intact
    expect(internal.state.players.get("a").energy).toBe(before);
    expect(editBroadcasts().length).toBe(bcasts);
    const reset = await edit(a, id, "reset"); // full reset is always a legal facing action
    expect(reset.success).toBe(true);
    expect([...s.editTiles]).toEqual([true, true, true, true]);
  });
});
