/**
 * Canonical room input queue: burst delivery must never overwrite inputs.
 *
 * Regression: the room kept ONE pending input per player
 * (`inb.set(sessionId, input)`), so when a slow client frame delivered
 * seq 72 (jump=true) and seq 73 (jump=false) before the next tick, seq 73
 * overwrote seq 72 and the jump never happened; ~70% of movement inputs were
 * lost the same way. Inputs are now queued per player in sequence order and
 * simulated under a real-time budget: simulated steps = elapsed ticks −
 * unsimulated credit (see PlayerInputQueue). A second defect surfaced by the
 * window acceptance: with an empty queue the room ran an idle step every
 * tick, so a bursty client's jump arc was simulated without its (late)
 * inputs and then the inputs again on the ground. Idle steps now run only
 * once the client is later than the catch-up window.
 *
 * The room is driven deterministically: production message handlers are
 * captured from onMessage and `tick()` is called explicitly, so a "burst" is
 * exactly several inputs delivered before one authoritative tick.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import { PLAYER_MOVEMENT, ROUNDS_TO_WIN, ASSAULT_RIFLE } from "@buildshift/game-config";
import { MatchPhase } from "@buildshift/protocol";

import { TWO_PLAYER_MOVEMENT_INPUT, TwoPlayerMovementRoom } from "./TwoPlayerMovementRoom.js";
import { INPUT_CATCHUP_CREDIT, INPUT_QUEUE_LIMIT, PlayerInputQueue } from "./lifecycle/playerInputQueue.js";

const A = "a";
const B = "b";
const REMATCH_REQUEST = "match:rematch_request";
/** One authoritative standing step at full input (moveSpeed / 30 Hz). */
const STEP = PLAYER_MOVEMENT.moveSpeed / 30;

describe("PlayerInputQueue policy", () => {
  const input = (sequence: number) => ({ sequence });

  it("rejects stale, duplicate/out-of-order and overflowing inputs explicitly", () => {
    const q = new PlayerInputQueue<{ sequence: number }>();
    expect(q.enqueue(input(5), 5)).toBe("stale");
    expect(q.enqueue(input(6), 5)).toBe("queued");
    expect(q.enqueue(input(6), 5)).toBe("out_of_order");
    expect(q.enqueue(input(4), 3)).toBe("out_of_order");
    for (let s = 7; q.size < INPUT_QUEUE_LIMIT; s++) expect(q.enqueue(input(s), 5)).toBe("queued");
    // Tail drop: the new arrival is refused; queued inputs are untouched.
    expect(q.enqueue(input(1000), 5)).toBe("overflow");
    expect(q.size).toBe(INPUT_QUEUE_LIMIT);
  });

  it("keeps simulated steps = elapsed ticks − credit, credit within the catch-up window", () => {
    const q = new PlayerInputQueue<{ sequence: number }>();
    let elapsed = 0, inputSteps = 0, idleSteps = 0;
    const tick = () => {
      q.beginTick(); elapsed++;
      while (q.take()) inputSteps++;
      if (q.settleIdle()) idleSteps++;
    };
    // Late client: credit banks (no idle step) up to the window.
    for (let i = 0; i < INPUT_CATCHUP_CREDIT; i++) tick();
    expect(idleSteps).toBe(0);
    // Beyond the window, one idle step per further silent tick.
    for (let i = 0; i < 5; i++) tick();
    expect(idleSteps).toBe(5);
    // A burst drains only the banked (elapsed, unsimulated) ticks.
    for (let s = 0; s < INPUT_QUEUE_LIMIT; s++) q.enqueue(input(s), -1);
    tick();
    expect(inputSteps).toBe(INPUT_CATCHUP_CREDIT + 1);
    expect(inputSteps + idleSteps).toBeLessThanOrEqual(elapsed);
    for (let i = 0; i < 50; i++) tick();
    expect(inputSteps).toBe(INPUT_QUEUE_LIMIT);
    expect(inputSteps + idleSteps).toBeLessThanOrEqual(elapsed);
    expect(elapsed - (inputSteps + idleSteps)).toBeLessThanOrEqual(INPUT_CATCHUP_CREDIT);
  });
});

describe("TwoPlayerMovementRoom input queue (burst delivery)", () => {
  let room: TwoPlayerMovementRoom;
  let internal: any;
  let a: Client;
  let b: Client;
  let handlers: Map<string, (client: Client, message: unknown) => Promise<void> | void>;
  /** Sequences actually simulated for player A, in order. */
  let simulated: number[];

  const deliver = (client: Client, sequence: number, opts: Partial<{ moveX: number; moveZ: number; jump: boolean; primaryFire: boolean; lookYaw: number; lookPitch: number }> = {}) =>
    handlers.get(TWO_PLAYER_MOVEMENT_INPUT)!(client, {
      sequence,
      moveX: opts.moveX ?? 0,
      moveZ: opts.moveZ ?? 0,
      lookYaw: opts.lookYaw ?? 0,
      lookPitch: opts.lookPitch ?? 0,
      jump: opts.jump ?? false,
      crouch: false,
      primaryFire: opts.primaryFire ?? false,
    });
  const tick = (n = 1) => { for (let i = 0; i < n; i++) internal.tick(); };
  const player = (id: string) => room.state.players.get(id)!;

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
    simulated = [];
    const si = internal.si.bind(room);
    vi.spyOn(internal, "si").mockImplementation((sid: any, p: any, buf: any) => {
      if (sid === A) simulated.push(buf.sequence);
      return si(sid, p, buf);
    });
  });

  afterEach(() => {
    room.onDispose();
    room.clock.clear();
    vi.restoreAllMocks();
  });

  it("jump burst: seq 10 (jump) is not overwritten by seq 11 and each runs once", () => {
    deliver(a, 10, { jump: true });
    deliver(a, 11, { jump: false });
    // Enqueueing does not acknowledge anything.
    expect(player(A).lastProcessedSequence).toBe(-1);
    tick();
    expect(simulated).toEqual([10]);
    expect(player(A).lastProcessedSequence).toBe(10);
    expect(player(A).y).toBeGreaterThan(0);
    expect(player(A).velocityY).toBeGreaterThan(0);
    tick();
    expect(simulated).toEqual([10, 11]);
    expect(player(A).lastProcessedSequence).toBe(11);
    tick(5);
    expect(simulated).toEqual([10, 11]);
  });

  it("movement burst: every forward input is simulated in order at one step each", () => {
    const z0 = player(A).z;
    for (let s = 0; s < 5; s++) deliver(a, s, { moveZ: -1 });
    tick(5);
    expect(simulated).toEqual([0, 1, 2, 3, 4]);
    expect(z0 - player(A).z).toBeCloseTo(5 * STEP, 6);
    tick(5);
    expect(z0 - player(A).z).toBeCloseTo(5 * STEP, 6);
  });

  it("orders processing exactly 20 → 21 → 22 → 23, banked idle credit drains a burst", () => {
    tick(INPUT_CATCHUP_CREDIT); // idle ticks bank catch-up credit
    for (const s of [20, 21, 22, 23]) deliver(a, s, { moveZ: -1 });
    tick();
    expect(simulated).toEqual([20, 21, 22, 23].slice(0, INPUT_CATCHUP_CREDIT));
    tick(4);
    expect(simulated).toEqual([20, 21, 22, 23]);
  });

  it("rejects stale and duplicate sequences: no replayed movement, jump or fire", () => {
    deliver(a, 5, { moveZ: -1 });
    tick();
    const after5 = { z: player(A).z, ammo: player(A).ammo };
    deliver(a, 5, { moveZ: -1, jump: true, primaryFire: true }); // already processed
    deliver(a, 3, { moveZ: -1, jump: true, primaryFire: true }); // older
    tick(3);
    expect(simulated).toEqual([5]);
    expect(player(A).z).toBe(after5.z);
    expect(player(A).y).toBe(0);
    expect(player(A).ammo).toBe(after5.ammo);
    deliver(a, 6, { moveZ: -1 });
    deliver(a, 6, { moveZ: -1, jump: true }); // duplicate while queued
    tick(3);
    expect(simulated).toEqual([5, 6]);
    expect(player(A).y).toBe(0);
    expect(after5.z - player(A).z).toBeCloseTo(STEP, 6);
  });

  it("flood: 1000 future inputs cannot move faster than the 30 Hz budget", () => {
    const z0 = player(A).z;
    for (let s = 0; s < 1000; s++) deliver(a, s, { moveZ: -1 });
    tick(10);
    // Exactly one simulated step per tick (no banked credit at round start).
    expect(simulated).toEqual(Array.from({ length: 10 }, (_, i) => i));
    expect(z0 - player(A).z).toBeCloseTo(10 * STEP, 6);
    tick(100);
    // Only the first INPUT_QUEUE_LIMIT were accepted (tail drop on overflow).
    expect(simulated).toEqual(Array.from({ length: INPUT_QUEUE_LIMIT }, (_, i) => i));
    expect(z0 - player(A).z).toBeCloseTo(INPUT_QUEUE_LIMIT * STEP, 6);
    // Over any T ticks: at most T + INPUT_CATCHUP_CREDIT simulated steps.
    const z1 = player(A).z;
    for (let s = 2000; s < 2100; s++) deliver(a, s, { moveZ: -1 });
    tick(7);
    expect(z1 - player(A).z).toBeLessThanOrEqual((7 + INPUT_CATCHUP_CREDIT) * STEP + 1e-9);
  });

  it("an accepted edge inside a full queue survives overflow", () => {
    for (let s = 0; s < INPUT_QUEUE_LIMIT; s++) deliver(a, s, { jump: s === 3 });
    for (let s = INPUT_QUEUE_LIMIT; s < INPUT_QUEUE_LIMIT + 50; s++) deliver(a, s);
    tick(3);
    expect(player(A).y).toBe(0);
    tick();
    expect(simulated.at(-1)).toBe(3);
    expect(player(A).y).toBeGreaterThan(0);
  });

  it("round boundary: queued inputs do not leak, sequence stays monotonic, next round input is immediate", () => {
    deliver(a, 0, { moveZ: -1 });
    tick();
    for (let s = 1; s <= 8; s++) deliver(a, s, { moveZ: -1, jump: true });
    internal.endRound(B, A);
    expect(room.state.matchPhase).toBe(MatchPhase.ROUND_ENDED);
    internal.bc(); // round reset → COUNTDOWN (players back at spawn)
    deliver(a, 9, { moveZ: -1, jump: true }); // during countdown: not simulated
    internal.br(); // next round IN_PROGRESS
    const spawn = { x: player(A).x, z: player(A).z };
    tick(3);
    expect(simulated).toEqual([0]);
    expect(player(A).lastProcessedSequence).toBe(0); // baseline not reset
    expect({ x: player(A).x, z: player(A).z }).toEqual(spawn);
    expect(player(A).y).toBe(0);
    deliver(a, 10, { moveZ: -1 });
    tick();
    expect(simulated).toEqual([0, 10]);
    expect(spawn.z - player(A).z).toBeCloseTo(STEP, 6);
  });

  it("in-room rematch: queued inputs are dropped and the session sequence continues", () => {
    deliver(a, 0, { moveZ: -1 });
    tick();
    for (let r = 0; r < ROUNDS_TO_WIN; r++) {
      if (r > 0) { internal.bc(); internal.br(); }
      for (let s = 1 + r * 3; s <= 3 + r * 3; s++) deliver(a, s, { moveZ: -1, jump: true });
      internal.endRound(B, A);
    }
    expect(room.state.matchPhase).toBe(MatchPhase.MATCH_ENDED);
    deliver(a, 50, { moveZ: -1, jump: true }); // during MATCH_ENDED: not simulated
    handlers.get(REMATCH_REQUEST)!(a, {});
    handlers.get(REMATCH_REQUEST)!(b, {});
    expect(room.state.matchPhase).toBe(MatchPhase.COUNTDOWN);
    internal.br();
    const spawn = { x: player(A).x, z: player(A).z };
    tick(3);
    expect(simulated).toEqual([0]);
    expect(player(A).lastProcessedSequence).toBe(0);
    expect({ x: player(A).x, z: player(A).z }).toEqual(spawn);
    deliver(a, 51, { moveZ: -1 });
    tick();
    expect(simulated).toEqual([0, 51]);
    expect(player(A).lastProcessedSequence).toBe(51);
  });

  it("late inputs mid-jump are simulated in their own steps (no idle arc, no doubled gravity)", () => {
    // Pure input-driven trajectory for reference: y after k jump steps.
    const yAfter = (k: number) => {
      let y = 0, vy = 0;
      for (let i = 0; i < k; i++) { if (i === 0) vy = 8; vy += -20 / 30; y = Math.max(0, y + vy / 30); }
      return y;
    };
    deliver(a, 0, { jump: true });
    tick();
    expect(player(A).y).toBeCloseTo(yAfter(1), 6);
    // The client's next inputs are late by 5 ticks (one slow frame).
    tick(5);
    expect(player(A).y).toBeCloseTo(yAfter(1), 6); // not simulated without input
    for (let s = 1; s <= 5; s++) deliver(a, s);
    tick();
    expect(simulated).toEqual([0, 1, 2, 3, 4, 5]);
    expect(player(A).y).toBeCloseTo(yAfter(6), 6);
  });

  it("a client that stops sending gets idle physics after the catch-up window", () => {
    deliver(a, 0, { jump: true });
    tick();
    const y1 = player(A).y;
    tick(INPUT_CATCHUP_CREDIT);
    expect(player(A).y).toBe(y1);
    tick(30);
    expect(player(A).y).toBe(0); // fell back to the ground via idle steps
  });

  it("disconnect removes the player's queue", () => {
    deliver(a, 0, { moveZ: -1 });
    deliver(a, 1, { moveZ: -1 });
    room.onLeave(a);
    expect(internal.inq.has(A)).toBe(false);
    tick();
    expect(simulated).toEqual([]);
  });

  it("fire inputs in a burst each go through the authoritative fire gate", () => {
    const yaw = Math.PI / 2;
    const ammo0 = player(A).ammo;
    for (let s = 0; s < ASSAULT_RIFLE.fireIntervalTicks + 1; s++) deliver(a, s, { lookYaw: yaw, primaryFire: true });
    tick(ASSAULT_RIFLE.fireIntervalTicks + 1);
    // Sequence-gated: one shot per fireIntervalTicks inputs, none lost or duplicated.
    expect(ammo0 - player(A).ammo).toBe(2);
  });
});
