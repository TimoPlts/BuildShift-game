/**
 * Authoritative placement geometry — the two reported bugs, end to end.
 *
 *  1. BUILD INSIDE A BODY. A piece used to be refused only when another piece
 *     already held the same canonical slot, so a wall could be created straight
 *     through the placer's own capsule (and through an opponent standing in the
 *     tile), after which the movement resolver had to shove the capsule out of
 *     solid geometry that was never supposed to be there. The gate is now the
 *     exact capsule↔cuboid clearance of the shared `placementActorsBlockCandidate`
 *     rule, run against EVERY authoritative actor, at the authoritative stance.
 *
 *  2. FLOATING PIECES. A piece two layers up with nothing under it used to be
 *     accepted — the anchor cell being empty was the whole test — so builds
 *     could hang in mid air. The gate is now the shared `placementIsSupported`
 *     face-contact search from the arena build foundation through the real,
 *     edit-aware solids of the existing pieces.
 *
 * Both gates run before Energy is spent, before the structure exists, before
 * any physics write and before any broadcast, so a request that passes wire
 * validation, bounds, prep-row, range and slot occupancy still has literally
 * zero side effects when the geometry refuses it — asserted by snapshotting
 * room state, slot occupancy, the Rapier collider count and the event log
 * around every rejected request. The ordering (occupancy → support → line of
 * sight → rate → Energy) is pinned too, so a refusal names the geometry rather
 * than a downstream reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import { BUILD_EVENTS } from "@buildshift/protocol";
import { BUILD_GRID, getStructureConfig } from "@buildshift/game-config";
import { TwoPlayerMovementRoom } from "./TwoPlayerMovementRoom.js";

const CS = BUILD_GRID.cellSize; // 5.12 m per tile

describe("authoritative placement geometry gates (bodies and support)", () => {
  let room: TwoPlayerMovementRoom;
  let internal: any;
  let a: Client;
  let b: Client;
  let handlers: Map<string, (client: Client, message: unknown) => Promise<void> | void>;
  let events: Array<[string, unknown]>;
  let sequence = 5000;

  /** Everything a rejected request must leave untouched. */
  const snapshot = () => ({
    structures: [...internal.bld.structures.values()].map((s: any) => `${s.buildType}@${s.grid.x},${s.grid.y},${s.grid.z}:${s.rotation}`).sort(),
    slots: [...internal.occ].sort(),
    colliders: internal.pw.world.colliders.len(),
    energyA: internal.state.players.get("a")!.energy,
    energyB: internal.state.players.get("b")!.energy,
    placedEvents: events.filter(([type]) => type === BUILD_EVENTS.STRUCTURE_PLACED).length,
  });

  /** One placement request; returns its outcome plus the room's reaction. */
  const place = async (who: Client, buildType: string, grid: { x: number; y: number; z: number }, rotation = 0, extra: Record<string, unknown> = {}) => {
    internal.tc += 100; // clear the per-player placement-rate window between requests
    const sid = who.sessionId;
    const seq = ++sequence;
    const before = snapshot();
    const energyBefore = sid === "a" ? before.energyA : before.energyB;
    await handlers.get(BUILD_EVENTS.PLACEMENT_REQUEST)!(who, { sequence: seq, buildType, grid, rotation, ...extra });
    const after = snapshot();
    const structure = [...internal.bld.structures.values()].find((s: any) => s.createdSequence === seq);
    const rejection = (who.send as ReturnType<typeof vi.fn>).mock.calls
      .find(([type, d]) => type === BUILD_EVENTS.STRUCTURE_REJECTED && (d as any).sequence === seq);
    return {
      structure,
      reason: rejection ? (rejection[1] as any).reason : null,
      energyDelta: internal.state.players.get(sid)!.energy - energyBefore,
      accepted: structure !== undefined,
      /** The zero-side-effect proof: nothing at all moved. */
      unchanged: JSON.stringify(after) === JSON.stringify(before),
    };
  };

  /** Put a body at a world pose (FEET position + stance) — the replicated convention. */
  const stand = (id: "a" | "b", x: number, z: number, opts: { y?: number; crouch?: boolean; eliminated?: boolean } = {}) => {
    const p = internal.state.players.get(id)!;
    p.x = x;
    p.z = z;
    p.y = opts.y ?? 0;
    p.crouch = opts.crouch ?? false;
    p.alive = !(opts.eliminated ?? false);
    p.isEliminated = opts.eliminated ?? false;
  };

  /** A tile centre, and the boundary line between tile `i` and tile `i + 1`. */
  const centre = (i: number) => i * CS;
  const boundary = (i: number) => i * CS + CS / 2;

  /** Destroy a piece through the authoritative damage path. */
  const destroy = (matches: (s: any) => boolean, by = "a") => {
    const s = [...internal.bld.structures.values()].find(matches);
    expect(s, "the fixture piece exists").toBeDefined();
    internal.ks(s.structureId, by);
    return s;
  };

  beforeEach(async () => {
    room = new TwoPlayerMovementRoom();
    internal = room as any;
    await internal.pwp;
    handlers = new Map();
    events = [];
    vi.spyOn(room, "onMessage").mockImplementation(((type: string, fn: any) => { handlers.set(type, fn); }) as any);
    vi.spyOn(room, "setFixedTimestep").mockImplementation(() => {});
    vi.spyOn(room, "broadcast").mockImplementation(((type: string, data: unknown) => { events.push([type, data]); }) as any);
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

  // ─── Bug 1: a piece may not be created inside a body ──────────────────────

  it("refuses the wall that used to be placed through the placer's own body", async () => {
    // A stands ON the −Z boundary line of the tile, so that edge's 0.768 m panel
    // contains the capsule: the historic bug accepted this placement and then
    // depenetrated the player out of solid geometry created around them.
    stand("a", centre(0), boundary(-1));
    stand("b", centre(2), centre(2)); // well out of the way of these pieces
    const r = await place(a, "wall", { x: 0, y: 0, z: 0 }, 0);
    expect(r.reason).toBe("actor_overlap");
    expect(r.accepted).toBe(false);
    expect(r.energyDelta).toBe(0);
    expect(r.unchanged).toBe(true);
  });

  it("accepts the same slot the moment the body is clear of that panel", async () => {
    stand("a", centre(0), centre(0) - 1.6); // same tile, 0.226 m off the panel face
    stand("b", centre(2), centre(2)); // well out of the way of these pieces
    const r = await place(a, "wall", { x: 0, y: 0, z: 0 }, 0);
    expect(r.reason).toBe(null);
    expect(r.structure?.buildType).toBe("wall");
    expect(r.energyDelta).toBe(-getStructureConfig("wall")!.cost);
  });

  it("keeps the legal neighbours: floor under the feet, four walls beside the capsule, roof over the head", async () => {
    stand("a", centre(0), centre(0)); // dead centre: 2.21 m clear of every edge panel
    stand("b", centre(2), centre(2)); // well out of the way of these pieces
    // The floor the body stands on is a walkable plate, not obstruction.
    expect((await place(a, "floor", { x: 0, y: 0, z: 0 })).reason).toBe(null);
    for (const rotation of [0, 1, 2, 3]) {
      const wall = await place(a, "wall", { x: 0, y: 0, z: 0 }, rotation);
      expect([rotation, wall.reason]).toEqual([rotation, null]);
    }
    // A 0.15 m roof slab two metres over the head is a roof, not a wall through
    // the body: sharing a build CELL with a player is not overlap.
    const roof = await place(a, "floor", { x: 0, y: 1, z: 0 });
    expect(roof.reason).toBe(null);
    expect(roof.accepted).toBe(true);
  });

  it("the opponent's capsule blocks a placement exactly like the placer's own", async () => {
    stand("b", centre(0), boundary(-1)); // B on the −Z boundary of the target tile
    stand("a", centre(0) - CS, centre(0)); // A one tile off: in range, out of the panel
    const blocked = await place(a, "wall", { x: 0, y: 0, z: 0 }, 0);
    expect(blocked.reason).toBe("actor_overlap");
    expect(blocked.unchanged).toBe(true);
    stand("b", centre(0), centre(0) - 1.6); // same tile, out of the panel
    expect((await place(a, "wall", { x: 0, y: 0, z: 0 }, 0)).reason).toBe(null);
  });

  it("refuses a full-tile ramp while anyone stands in that tile and accepts it once the tile is empty", async () => {
    stand("b", centre(1), centre(0)); // B in the target tile; A asks for the ramp
    stand("a", centre(0), centre(0));
    const inside = await place(a, "ramp", { x: 1, y: 0, z: 0 }, 1);
    expect(inside.reason).toBe("actor_overlap");
    expect(inside.unchanged).toBe(true);
    stand("b", centre(1), centre(0) + CS); // B steps one tile out (still in range)
    expect((await place(a, "ramp", { x: 1, y: 0, z: 0 }, 1)).reason).toBe(null);
  });

  it("a dead body no longer counts, and the live body's stance is what decides", async () => {
    // The cone's shell reaches into its own axis at standing height, and its
    // 1.92 m apex can never give standing headroom (editGeometry): a standing
    // body on the axis is inside the piece, a crouched one is not. B is where
    // the cone goes but eliminated, so only A's capsule is measured.
    stand("b", centre(0), centre(0), { eliminated: true });
    stand("a", centre(0), centre(0));
    expect((await place(a, "cone", { x: 0, y: 0, z: 0 })).reason).toBe("actor_overlap");
    stand("a", centre(0), centre(0), { crouch: true }); // same place, crouched stance
    expect((await place(a, "cone", { x: 0, y: 0, z: 0 })).reason).toBe(null);
  });

  it("ignores any pose the packet claims and measures the replicated one", async () => {
    // The occupancy input is the authoritative room, never a client assertion:
    // this request carries a pretend far-away pose and still meets B's body.
    stand("b", centre(0), boundary(-1));
    stand("a", centre(0), centre(0));
    const r = await place(a, "wall", { x: 0, y: 0, z: 0 }, 0, { player: { x: 900, y: 900, z: 900 } });
    expect(r.reason).toBe("actor_overlap");
    expect(internal.bld.structures.size).toBe(0);
    expect(internal.occ.size).toBe(0);
  });

  // ─── Bug 2: a piece must stand on something that reaches the ground ───────

  it("refuses an elevated piece with nothing under it, with zero side effects", async () => {
    stand("a", centre(0), centre(0) - CS); // one tile out: in range and looking at it
    const r = await place(a, "floor", { x: 0, y: 2, z: 0 }); // two layers up, empty air
    expect(r.reason).toBe("unsupported");
    expect(r.accepted).toBe(false);
    expect(r.energyDelta).toBe(0);
    expect(r.unchanged).toBe(true);
  });

  it("refuses an airborne island: a neighbour on the same layer is not support", async () => {
    stand("a", centre(0), centre(0)); // under the pair: both anchors are in range
    // Neither of the two mutually-touching floors can start: the pair is
    // internally connected but reaches nothing.
    expect((await place(a, "floor", { x: 0, y: 2, z: 0 })).reason).toBe("unsupported");
    expect((await place(a, "floor", { x: 0, y: 2, z: 1 })).reason).toBe("unsupported");
    expect(internal.bld.structures.size).toBe(0);
    expect(internal.occ.size).toBe(0);
  });

  it("a gap in the chain breaks support and filling the gap completes it", async () => {
    stand("a", centre(0), centre(0)); // beside the column it is building
    expect((await place(a, "wall", { x: 0, y: 0, z: 0 }, 0)).reason).toBe(null); // on the ground
    const gap = await place(a, "wall", { x: 0, y: 2, z: 0 }, 0); // skipping layer 1
    expect(gap.reason).toBe("unsupported");
    expect(gap.unchanged).toBe(true);
    expect((await place(a, "wall", { x: 0, y: 1, z: 0 }, 0)).reason).toBe(null); // fill the gap
    expect((await place(a, "wall", { x: 0, y: 2, z: 0 }, 0)).reason).toBe(null); // now it stands
  });

  it("support travels the designed load path: ramp → crest floor → floor beyond → wall on the roof edge", async () => {
    stand("a", centre(0) - CS, centre(0)); // parked one tile out, everything in reach
    expect((await place(a, "ramp", { x: 0, y: 0, z: 0 }, 1)).reason).toBe(null); // grounded climb
    expect((await place(a, "floor", { x: 0, y: 1, z: 0 })).reason).toBe(null); // rests on the crest
    expect((await place(a, "floor", { x: 0, y: 1, z: 1 })).reason).toBe(null); // edge onto the next tile
    expect((await place(a, "wall", { x: 0, y: 1, z: 1 }, 0)).reason).toBe(null); // stands on that roof
    expect(internal.bld.structures.size).toBe(4);
  });

  it("support is recomputed from what actually stands: destroy the footing and the plane falls", async () => {
    stand("a", centre(0), centre(0));
    expect((await place(a, "wall", { x: 0, y: 0, z: 0 }, 2)).reason).toBe(null); // the +Z edge panel
    expect((await place(a, "floor", { x: 0, y: 1, z: 0 })).reason).toBe(null); // its roof
    // Destroying a support is legal gameplay (demo build-destroy): the roof is
    // left floating, and that is exactly what the next placement must notice.
    destroy((s: any) => s.buildType === "wall");
    const floating = await place(a, "floor", { x: 0, y: 1, z: 1 }); // attaches only through that roof
    expect(floating.reason).toBe("unsupported");
    expect(floating.unchanged).toBe(true);
    destroy((s: any) => s.buildType === "floor");
    expect((await place(a, "floor", { x: 0, y: 1, z: 1 })).reason).toBe("unsupported");
  });

  // ─── Ordering, reasons and cost of a refusal ───────────────────────────────

  it("the geometry gates answer before line of sight, rate and Energy", async () => {
    // Broke and refused at once: the refusal still names the geometry, in the
    // shared order (occupancy → support → LOS → rate → cost).
    stand("a", centre(0), boundary(-1)); // inside the panel it asks for
    internal.state.players.get("a")!.energy = 0;
    expect((await place(a, "wall", { x: 0, y: 0, z: 0 }, 0)).reason).toBe("actor_overlap");
    stand("a", centre(0), centre(0) - CS);
    expect((await place(a, "floor", { x: 0, y: 2, z: 0 })).reason).toBe("unsupported");
    expect(internal.state.players.get("a")!.energy).toBe(0); // nothing was ever charged
  });

  it("a refusal costs nothing and never blocks the next legal placement", async () => {
    stand("a", centre(0), centre(0));
    const energyBefore = internal.state.players.get("a")!.energy;
    const refused = await place(a, "floor", { x: 0, y: 2, z: 0 }); // nothing under it
    expect(refused.reason).toBe("unsupported");
    expect(refused.energyDelta).toBe(0);
    const placed = await place(a, "wall", { x: 0, y: 0, z: 0 }, 1); // immediately after
    expect(placed.reason).toBe(null);
    expect(internal.state.players.get("a")!.energy).toBe(energyBefore - getStructureConfig("wall")!.cost);
  });
});
