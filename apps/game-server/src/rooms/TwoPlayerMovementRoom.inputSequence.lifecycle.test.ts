/**
 * TwoPlayerMovementRoom input-sequence lifecycle regression tests.
 *
 * The input sequence is monotonic for the lifetime of a room session:
 * the room only re-baselines a player's `lastProcessedSequence` (to -1)
 * when a NEW session joins — never on round reset, round advancement,
 * match end, or in-room rematch. The production client mirrors this: it
 * only restarts its sequence for a new session ((re)connect) and keeps
 * advancing it across round/match/rematch boundaries.
 *
 * The cross-round input-sequence freeze happened when the client restarted
 * its sequence from 0 at a round/match reset while the room kept its
 * baseline: every new frame was `<= lastProcessedSequence` and got rejected
 * as stale, freezing the player.
 *
 * These tests drive the canonical room with two real Colyseus SDK clients
 * and a client-side monotonic sequence per session, proving:
 *  1. Round 1 completes and round 2 accepts IMMEDIATE movement and fire
 *     (no catch-up window needed).
 *  2. Round 3 also accepts immediate input.
 *  3. A completed match followed by an in-room rematch accepts immediate
 *     input in the first rematch round, and the same holds after a
 *     repeated (second) rematch.
 *  4. Stale and duplicate sequences are still rejected by the room (the
 *     fix did not weaken authoritative rejection), and a new session
 *     re-baselines its sequence to -1 so its sequence-0 input is accepted.
 *
 * Each test uses a fresh server instance so tests are independent and
 * deterministic. All waits use bounded polling so CI cannot hang.
 */
import { describe, expect, it } from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";

import { MatchPhase } from "@buildshift/protocol";

import { startServer, shutdownServer } from "../server.js";
import type { GameServer } from "../server.js";
import { TWO_PLAYER_MOVEMENT_ROOM, TWO_PLAYER_MOVEMENT_INPUT } from "./TwoPlayerMovementRoom.js";

/** The in-room rematch request message (TwoPlayerMovementRoom handler). */
const REMATCH_REQUEST = "match:rematch_request";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Bounded polling wait. */
async function waitForState(
  room: ClientRoom,
  predicate: (state: unknown) => boolean,
  timeoutMs = 5_000,
  label = "state",
): Promise<void> {
  const startedAt = Date.now();
  if (room.state && predicate(room.state)) return;
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((r) => setTimeout(r, 25));
    if (room.state && predicate(room.state)) return;
  }
  throw new Error(
    `[input-seq-lifecycle] timed out after ${timeoutMs}ms waiting for ${label}; last state=${JSON.stringify(
      room.state,
    )}`,
  );
}

function waitMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function playerFromState(state: unknown, sessionId: string): any {
  const players = (state as Record<string, any>)?.players;
  if (!players) return undefined;
  if (typeof players.get === "function") return players.get(sessionId);
  return players[sessionId];
}

function scoreFromState(state: unknown, sessionId: string): number {
  const rs = (state as Record<string, any>)?.roundScore;
  if (!rs) return 0;
  const e = typeof rs.get === "function" ? rs.get(sessionId) : rs[sessionId];
  return e?.value ?? 0;
}

function phase(state: unknown): string {
  return (state as Record<string, any>)?.matchPhase as string ?? "";
}

/** Bounded teardown. */
async function teardownRoom(room: ClientRoom | null): Promise<void> {
  if (!room) return;
  room.leave().catch(() => {
    /* already gone — ignore */
  });
  try {
    room.connection.close();
  } catch {
    /* connection already closed — ignore */
  }
}

async function deadline<T>(p: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`[input-seq-lifecycle] timeout: ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A session-scoped monotonic sequence generator (mirrors the production
 *  client lifecycle: monotonic across rounds/matches/rematches, restarted
 *  only for a new session). Fire frames are fired at computed offsets, so
 *  `claim` registers any such value as used. */
function createSequence(): { next: () => number; claim: (v: number) => void; last: () => number } {
  let n = -1;
  return {
    next: () => ++n,
    claim: (v: number) => {
      if (v > n) n = v;
    },
    last: () => n,
  };
}

async function setup(): Promise<{ server: GameServer; url: string; a: ClientRoom; b: ClientRoom }> {
  const started = await deadline(startServer(0), 10_000, "startServer");
  const url = `ws://127.0.0.1:${started.port}`;
  const a = await deadline(new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM), 10_000, "joinA");
  const b = await deadline(new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM), 10_000, "joinB");
  await waitForState(
    a,
    (s) => playerFromState(s, a.sessionId) && playerFromState(s, b.sessionId),
    5_000,
    "both players in state",
  );
  return { server: started.server, url, a, b };
}

function sendMovement(room: ClientRoom, sequence: number, moveX: number): void {
  room.send(TWO_PLAYER_MOVEMENT_INPUT, {
    sequence,
    moveX,
    moveZ: 0,
    lookYaw: 0,
    lookPitch: 0,
    jump: false,
    sprint: false,
    crouch: false,
    primaryFire: false,
    secondaryFire: false,
  });
}

/** A (spawn x=-5) aims at B (spawn x=+5): yaw +π/2 fires down the +X axis. */
function sendFire(room: ClientRoom, sequence: number): void {
  room.send(TWO_PLAYER_MOVEMENT_INPUT, {
    sequence,
    moveX: 0,
    moveZ: 0,
    lookYaw: Math.PI / 2,
    lookPitch: 0,
    jump: false,
    sprint: false,
    crouch: false,
    primaryFire: true,
    secondaryFire: false,
  });
}

/**
 * Play one round, asserting the round-boundary invariants:
 *  - the room kept A's sequence baseline across the boundary (no rollback
 *    to the new-session sentinel below the last accepted sequence);
 *  - A's IMMEDIATE next movement input is accepted (position advances);
 *  - A's IMMEDIATE next fire input is accepted (B takes damage);
 * and finish the round by eliminating B.
 *
 * @param expectMatchEnd when true, wait for MATCH_ENDED instead of
 *        ROUND_ENDED (A's third round win).
 */
async function playRound(
  a: ClientRoom,
  b: ClientRoom,
  seq: { next: () => number; claim: (v: number) => void; last: () => number },
  minAccepted: number,
  expectMatchEnd = false,
): Promise<void> {
  const sidA = a.sessionId;
  const sidB = b.sessionId;

  // The round is live (covers the 2s ROUND_ENDED + 3s COUNTDOWN transition).
  await waitForState(a, (s) => phase(s) === MatchPhase.IN_PROGRESS, 15_000, "IN_PROGRESS");

  // The room must have kept A's sequence baseline across the boundary:
  // lastProcessedSequence never rolls back to the new-session sentinel.
  const aBefore = playerFromState(a.state, sidA);
  expect(aBefore, "A present at round start").toBeDefined();
  expect(
    aBefore.lastProcessedSequence,
    "sequence baseline retained across the round boundary",
  ).toBeGreaterThanOrEqual(minAccepted);

  // ── Immediate movement: the very next monotonic input is accepted ──
  const x0 = aBefore.x;
  const moveSeq = seq.next();
  sendMovement(a, moveSeq, -1); // left-strafe at yaw 0 = world +X (toward B, keeps the fire line exact)
  await waitForState(
    a,
    (s) => {
      const p = playerFromState(s, sidA);
      return p && p.lastProcessedSequence >= moveSeq && p.x > x0 + 0.1;
    },
    2_500,
    `round-start movement seq ${moveSeq} accepted immediately`,
  );

  // ── Immediate fire: the next monotonic fire frame is accepted ──
  const b0 = playerFromState(a.state, sidB);
  const total0 = b0.health + b0.shield;
  const fireSeq = moveSeq + 10; // ≥ fireIntervalTicks (8) beyond any prior fire
  seq.claim(fireSeq);
  sendFire(a, fireSeq);
  await waitForState(
    a,
    (s) => {
      const pA = playerFromState(s, sidA);
      const pB = playerFromState(s, sidB);
      return (
        pA && pB &&
        pA.lastProcessedSequence >= fireSeq &&
        pB.health + pB.shield < total0 - 10 // one 20-dmg hit landed
      );
    },
    3_000,
    `round-start fire seq ${fireSeq} accepted immediately`,
  );

  // ── Finish the round: keep firing until B is eliminated ──
  // (A single shot can miss in a transient state; the loop is bounded by
  // time, not by per-shot damage, so a miss never wedges the test.)
  let s = fireSeq;
  const finishedAt = Date.now();
  for (;;) {
    if (playerFromState(a.state, sidB).isEliminated) break;
    if (Date.now() - finishedAt > 12_000) {
      throw new Error(`[input-seq-lifecycle] B not eliminated within 12s; A lastProcessedSequence=${playerFromState(a.state, sidA).lastProcessedSequence}`);
    }
    s += 10; // > fireIntervalTicks (8 @ 30Hz ≈ 267ms) guarantees the fire gate passes
    seq.claim(s);
    sendFire(a, s);
    await waitMs(350);
  }

  await waitForState(
    a,
    (s) =>
      phase(s) ===
      (expectMatchEnd ? MatchPhase.MATCH_ENDED : MatchPhase.ROUND_ENDED),
    5_000,
    expectMatchEnd ? "MATCH_ENDED" : "ROUND_ENDED",
  );
}

async function requestRematch(a: ClientRoom, b: ClientRoom): Promise<void> {
  a.send(REMATCH_REQUEST, {});
  b.send(REMATCH_REQUEST, {});
  await waitForState(
    a,
    (s) => phase(s) === MatchPhase.COUNTDOWN,
    5_000,
    "rematch accepted (COUNTDOWN)",
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("input-sequence lifecycle (session-lifetime monotonic)", () => {
  it("rounds 1–3 accept immediate monotonic movement and fire; match ends", async () => {
    const { server, a, b } = await setup();
    const seq = createSequence();
    let minAccepted = -1;
    try {
      for (let round = 1; round <= 3; round++) {
        await playRound(a, b, seq, minAccepted, round === 3);
        minAccepted = Math.max(minAccepted, seq.last());
      }
      expect(phase(a.state)).toBe(MatchPhase.MATCH_ENDED);
      // A fired in every round and B never counter-attacked.
      expect(scoreFromState(a.state, a.sessionId)).toBe(3);
    } finally {
      await deadline(Promise.all([teardownRoom(b), teardownRoom(a)]), 5_000, "teardown");
      await deadline(shutdownServer(server), 8_000, "shutdown");
    }
  }, 120_000);

  it("in-room rematch and repeated rematches accept immediate monotonic input", async () => {
    const { server, a, b } = await setup();
    const seq = createSequence();
    let minAccepted = -1;
    try {
      // Match 1 → MATCH_ENDED.
      for (let round = 1; round <= 3; round++) {
        await playRound(a, b, seq, minAccepted, round === 3);
        minAccepted = Math.max(minAccepted, seq.last());
      }
      expect(phase(a.state)).toBe(MatchPhase.MATCH_ENDED);

      // Rematch #1 (both connected players vote in-room).
      await requestRematch(a, b);
      minAccepted = Math.max(minAccepted, seq.last());

      // The FIRST rematch round must accept immediate movement + fire, and
      // the rematch match runs to completion on the same monotonic sequence.
      await playRound(a, b, seq, minAccepted, false);
      minAccepted = Math.max(minAccepted, seq.last());
      await playRound(a, b, seq, minAccepted, false);
      minAccepted = Math.max(minAccepted, seq.last());
      await playRound(a, b, seq, minAccepted, true);
      expect(phase(a.state)).toBe(MatchPhase.MATCH_ENDED);

      // Rematch #2 (repeated rematch, same sessions, same sequence).
      await requestRematch(a, b);
      minAccepted = Math.max(minAccepted, seq.last());

      // The first round after the repeated rematch also accepts immediate
      // input (asserted inside playRound); B is eliminated there.
      await playRound(a, b, seq, minAccepted, false);
    } finally {
      await deadline(Promise.all([teardownRoom(b), teardownRoom(a)]), 5_000, "teardown");
      await deadline(shutdownServer(server), 8_000, "shutdown");
    }
  }, 180_000);

  it("stale and duplicate sequences are still rejected; a new session re-baselines to -1", async () => {
    const { server, url, a, b } = await setup();
    let aNew: ClientRoom | null = null;
    try {
      await waitForState(a, (s) => phase(s) === MatchPhase.IN_PROGRESS, 15_000, "IN_PROGRESS");
      const sidA = a.sessionId;

      // seq 0 (move +X) is accepted: position advances one step.
      const x0 = playerFromState(a.state, sidA).x;
      sendMovement(a, 0, -1);
      await waitForState(
        a,
        (s) => {
          const p = playerFromState(s, sidA);
          return p && p.lastProcessedSequence >= 0 && p.x > x0 + 0.1;
        },
        2_500,
        "seq 0 accepted",
      );
      const xAfter0 = playerFromState(a.state, sidA).x;

      // seq 1 (move +X) is accepted: position advances again.
      sendMovement(a, 1, -1);
      await waitForState(
        a,
        (s) => {
          const p = playerFromState(s, sidA);
          return p && p.lastProcessedSequence >= 1 && p.x > xAfter0 + 0.1;
        },
        2_500,
        "seq 1 accepted",
      );
      const xAfter1 = playerFromState(a.state, sidA).x;

      // Duplicate seq 1: rejected (stale) — position and baseline unchanged.
      sendMovement(a, 1, -1);
      await waitMs(500); // ≥ 5 server ticks
      const afterDup = playerFromState(a.state, sidA);
      expect(afterDup.lastProcessedSequence).toBe(1);
      expect(afterDup.x).toBeCloseTo(xAfter1, 3);

      // Stale seq 0 (out of order, lower than baseline): rejected.
      sendMovement(a, 0, -1);
      await waitMs(500);
      const afterStale = playerFromState(a.state, sidA);
      expect(afterStale.lastProcessedSequence).toBe(1);
      expect(afterStale.x).toBeCloseTo(xAfter1, 3);

      // A NEW session (rejoin) re-baselines lastProcessedSequence to -1 and
      // accepts its own sequence-0 input — the mirror of the client
      // restarting its sequence on (re)connect. The room seats two, so the
      // old session drops first and the reconnector joins the same room.
      try { a.connection.close(); } catch { /* already closed — ignore */ }
      await waitForState(
        b,
        (s) => playerFromState(s, a.sessionId) === undefined,
        5_000,
        "old session removed",
      );
      const aNewRoom = await deadline(
        new Client(url).joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM),
        10_000,
        "rejoin",
      );
      aNew = aNewRoom;
      await waitForState(
        aNewRoom,
        (s) => playerFromState(s, aNewRoom.sessionId),
        5_000,
        "new session in state",
      );
      const fresh = playerFromState(aNewRoom.state, aNewRoom.sessionId);
      expect(fresh.lastProcessedSequence).toBe(-1);

      // The new session's sequence-0 and sequence-1 inputs are accepted on
      // the session baseline (round 1 is still live when this runs).
      const xNew0 = fresh.x;
      sendMovement(aNewRoom, 0, -1);
      await waitForState(
        aNewRoom,
        (s) => {
          const p = playerFromState(s, aNewRoom.sessionId);
          return p && p.lastProcessedSequence >= 0 && p.x > xNew0 + 0.1;
        },
        2_500,
        "new session seq 0 accepted",
      );
      sendMovement(aNewRoom, 1, -1);
      await waitForState(
        aNewRoom,
        (s) => {
          const p = playerFromState(s, aNewRoom.sessionId);
          return p && p.lastProcessedSequence >= 1;
        },
        2_500,
        "new session seq 1 accepted",
      );
    } finally {
      await deadline(Promise.all([teardownRoom(b), teardownRoom(a), teardownRoom(aNew)]), 5_000, "teardown");
      await deadline(shutdownServer(server), 8_000, "shutdown");
    }
  }, 60_000);
});
