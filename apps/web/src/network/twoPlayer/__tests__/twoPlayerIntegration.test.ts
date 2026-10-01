/**
 * TwoPlayerClient Integration Test — prediction, reconciliation, and
 * interpolation with two simulated peers over 72 frames at 30 Hz.
 *
 * Mirrors GameRuntime construction: TwoPlayerClient + InputSender +
 * LocalPlayerPrediction + RemotePlayerInterpolation, driven by a FakeServer
 * that uses the same stepFullMovement as the real server.
 *
 * Phase 1 (0-29): A moves forward, B idle.
 * Phase 2 (30-71): A idle, B moves forward.
 *
 * Verifies:
 *   1. Independent movement of both players
 *   2. Prediction active before first snapshot
 *   3. Reconciliation converges after authoritative states
 *   4. Interpolation produces values strictly between consecutive snapshots
 */
import { describe, expect, it } from "vitest";
import {
  TwoPlayerClient, InputSender, LocalPlayerPrediction,
  RemotePlayerInterpolation, SIMULATION_TICK_SECONDS,
  CORRECTION_SNAP_THRESHOLD, type InputSample,
} from "../index";
import type { PlayerNetworkInput } from "@buildshift/protocol";
import {
  movementInputToWorld, stepFullMovement,
  type FullMovementState, type HorizontalMovementConfig, type VerticalMovementConfig,
} from "@buildshift/simulation";
import { PLAYER_MOVEMENT, VERTICAL_MOVEMENT } from "@buildshift/game-config";

const TICK = SIMULATION_TICK_SECONDS;
const FMS = TICK * 1000;
const N = 72;
const DL = 2;
const DI = 3;
const HS: Readonly<HorizontalMovementConfig> = { moveSpeed: PLAYER_MOVEMENT.moveSpeed };
const VS: Readonly<VerticalMovementConfig> = {
  gravity: VERTICAL_MOVEMENT.gravity, jumpVelocity: VERTICAL_MOVEMENT.jumpVelocity,
  maxFallSpeed: VERTICAL_MOVEMENT.maxFallSpeed, groundY: VERTICAL_MOVEMENT.groundY,
  jumpSpeed: VERTICAL_MOVEMENT.jumpVelocity,
};

function mkInput(seq: number, mx: number, mz: number, yaw: number, jump = false): PlayerNetworkInput {
  return { sequence: seq, moveX: mx, moveZ: mz, lookYaw: yaw, lookPitch: 0, jump, sprint: false, crouch: false, primaryFire: false, secondaryFire: false };
}

function step(s: FullMovementState, mx: number, mz: number, yaw: number, jump = false): FullMovementState {
  return stepFullMovement(s, movementInputToWorld({ x: mx, z: mz }, yaw), { jump }, TICK, HS, VS);
}

class FakeServer {
  a: FullMovementState = { x: 0, y: VERTICAL_MOVEMENT.groundY, z: 0, yaw: 0, velocityY: 0, grounded: true };
  b: FullMovementState = { x: 0, y: VERTICAL_MOVEMENT.groundY, z: 0, yaw: 0, velocityY: 0, grounded: true };
  sa = -1; sb = -1;
  tickA(i: PlayerNetworkInput): void { if (i.sequence > this.sa) { this.a = step(this.a, i.moveX, i.moveZ, i.lookYaw, i.jump); this.sa = i.sequence; } }
  tickB(i: PlayerNetworkInput): void { if (i.sequence > this.sb) { this.b = step(this.b, i.moveX, i.moveZ, i.lookYaw, i.jump); this.sb = i.sequence; } }
}

interface Snap { f: number; x: number; y: number; z: number; yaw: number; vy: number; grounded: boolean; seq: number }
interface Recon { f: number; ack: number; d: number }
interface Interp { f: number; x: number; y: number; z: number }

describe("TwoPlayerClient integration: two simulated peers, 72 frames @ 30 Hz", () => {
  it("prediction, reconciliation, and interpolation stay consistent", () => {
    const client = new TwoPlayerClient();
    const sender = new InputSender();
    const pred = new LocalPlayerPrediction();
    const interp = new RemotePlayerInterpolation();
    const srv = new FakeServer();

    let vt = 0;
    const bSnaps: Snap[] = [];
    const aSnaps: Snap[] = [];
    const rpos: Interp[] = [];
    const recons: Recon[] = [];
    const predA: Interp[] = [];

    for (let f = 0; f < N; f++) {
      vt += FMS;
      const sA: InputSample = f < 30
        ? { moveX: 0, moveZ: -1, yaw: 0, pitch: 0, jump: false, crouch: false }
        : { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false };
      const bIn = f < 30 ? mkInput(f, 0, 0, 0) : mkInput(f, 0, -1, 0);

      const p = pred.predict(sA);
      const sent = sender.send(sA, client, { x: p.x, y: p.y, z: p.z, velocityY: p.velocityY, grounded: p.grounded });
      predA.push({ f, x: p.x, y: p.y, z: p.z });

      srv.tickA(sent);
      srv.tickB(bIn);

      if (f >= DL && f % DI === DI - 1) {
        const lf = f - DL;
        const aS: Snap = { f: lf, x: srv.a.x, y: srv.a.y, z: srv.a.z, yaw: srv.a.yaw, vy: srv.a.velocityY, grounded: srv.a.grounded, seq: srv.sa };
        const bS: Snap = { f: lf, x: srv.b.x, y: srv.b.y, z: srv.b.z, yaw: srv.b.yaw, vy: srv.b.velocityY, grounded: srv.b.grounded, seq: srv.sb };
        aSnaps.push(aS);
        bSnaps.push(bS);

        const buf = sender.getInputsAfter(aS.seq);
        const cd = pred.onServerState({ x: aS.x, y: aS.y, z: aS.z, yaw: aS.yaw, velocityY: aS.vy, grounded: aS.grounded, sequence: aS.seq }, buf);
        if (cd !== null) recons.push({ f, ack: aS.seq, d: cd });
        sender.pruneUpTo(aS.seq);

        interp.addState({ x: bS.x, y: bS.y, z: bS.z, yaw: bS.yaw, velocityY: bS.vy, grounded: bS.grounded }, vt);
      }

      if (interp.hasData) {
        const ip = interp.getInterpolated(vt);
        rpos.push({ f, x: ip.x, y: ip.y, z: ip.z });
      }
    }

    // ── 1. Independent movement ──────────────────────────────────────────
    // Phase 1 end (frame 29): A moved 30 ticks forward, B stayed at origin.
    expect(predA[29].z).toBeCloseTo(-PLAYER_MOVEMENT.moveSpeed * TICK * 30, 4);
    expect(predA[29].x).toBeCloseTo(0, 8);
    for (const s of bSnaps.filter(s => s.f < 30)) {
      expect(s.z).toBeCloseTo(0, 10);
      expect(s.x).toBeCloseTo(0, 10);
    }
    // Phase 2 end: B moved 42 ticks forward, A stayed put.
    expect(srv.b.z).toBeCloseTo(-PLAYER_MOVEMENT.moveSpeed * TICK * 42, 4);
    const finalA = pred.getCurrentState();
    expect(finalA.z).toBeCloseTo(predA[29].z, 3);
    expect(finalA.x).toBeCloseTo(0, 8);

    // ── 2. Prediction active before first snapshot ──────────────────────
    // First snapshot arrives at frame DL=2. At frames 0 and 1, A's position
    // advanced purely from local prediction with no server state.
    expect(predA[0].z).toBeCloseTo(-PLAYER_MOVEMENT.moveSpeed * TICK, 6);
    expect(predA[1].z).toBeCloseTo(-PLAYER_MOVEMENT.moveSpeed * TICK * 2, 6);
    // The first reconciliation event should occur at frame >= 2
    // (since the first snapshot delivery is at frame DL=2).
    const firstReconFrame = recons.length > 0 ? recons[0].f : Infinity;
    expect(firstReconFrame).toBeGreaterThanOrEqual(DL);

    // ── 3. Reconciliation active ─────────────────────────────────────────
    expect(recons.length).toBeGreaterThanOrEqual(20);
    for (const r of recons) expect(r.d).toBeLessThan(CORRECTION_SNAP_THRESHOLD);
    for (let i = 1; i < recons.length; i++) expect(recons[i].ack).toBeGreaterThan(recons[i - 1].ack);
    expect(pred.lastAckSequence).toBe(recons[recons.length - 1].ack);
    // Final position converges to authoritative (within 1 cm)
    const div = Math.hypot(finalA.x - srv.a.x, finalA.y - srv.a.y, finalA.z - srv.a.z);
    expect(div).toBeLessThan(0.01);

    // ── 4. Interpolation active ──────────────────────────────────────────
    // During phase 2, B is moving. The RemotePlayerInterpolation renders
    // at targetTime = renderTime - REMOTE_INTERPOLATION_DELAY_MS (100ms).
    // Since snapshots arrive every DI frames (= 100ms at 30Hz), the
    // interpolation target at frame f falls between the snapshot delivered
    // at frame (f - DI) and the snapshot delivered at frame f.
    //
    // Therefore, for a pair (lo, hi) of consecutive B snapshots where lo
    // was delivered at frame loDel and hi at frame hiDel, the frames where
    // the interpolation target falls strictly between lo and hi are
    // frames (hiDel+1) through (hiDel + DI - 1), i.e. the frames AFTER hi
    // is delivered but BEFORE the next snapshot arrives.
    const bMoving = bSnaps.filter(s => s.f >= 30);
    expect(bMoving.length).toBeGreaterThanOrEqual(10);

    let strictlyBetweenCount = 0;
    for (let i = 1; i < bMoving.length; i++) {
      const lo = bMoving[i - 1];
      const hi = bMoving[i];
      const dz = hi.z - lo.z;
      if (Math.abs(dz) < 0.001) continue;

      // hi was delivered at frame hi.f + DL.
      // The frames AFTER hi's delivery where interpolation targets
      // fall between lo and hi are: (hiDeliver+1) .. (hiDeliver+DI-1).
      const hiDeliver = hi.f + DL;
      const candidates = rpos.filter(r => r.f > hiDeliver && r.f < hiDeliver + DI);
      for (const c of candidates) {
        const zMin = Math.min(lo.z, hi.z);
        const zMax = Math.max(lo.z, hi.z);
        if (c.z > zMin + 1e-9 && c.z < zMax - 1e-9) {
          strictlyBetweenCount++;
          break; // One per snapshot pair is enough
        }
      }
    }
    expect(strictlyBetweenCount).toBeGreaterThanOrEqual(5);
    expect(rpos.length).toBeGreaterThanOrEqual(20);
  });

  it("verifies jump input changes position independently for each player", () => {
    const client = new TwoPlayerClient();
    const sender = new InputSender();
    const pred = new LocalPlayerPrediction();
    const interp = new RemotePlayerInterpolation();
    const srv = new FakeServer();

    let vt = 0;
    const predA: Interp[] = [];
    const bSnaps: Snap[] = [];

    for (let f = 0; f < 60; f++) {
      vt += FMS;
      const aJump = f === 5;
      const bJump = f === 35;

      const sA: InputSample = { moveX: 0, moveZ: -1, yaw: 0, pitch: 0, jump: aJump, crouch: false };
      const bIn = mkInput(f, 0, -1, 0, bJump);

      const p = pred.predict(sA);
      const sent = sender.send(sA, client, { x: p.x, y: p.y, z: p.z, velocityY: p.velocityY, grounded: p.grounded });
      predA.push({ f, x: p.x, y: p.y, z: p.z });

      srv.tickA(sent);
      srv.tickB(bIn);

      if (f >= DL && f % DI === DI - 1) {
        const lf = f - DL;
        const aS: Snap = { f: lf, x: srv.a.x, y: srv.a.y, z: srv.a.z, yaw: srv.a.yaw, vy: srv.a.velocityY, grounded: srv.a.grounded, seq: srv.sa };
        const bS: Snap = { f: lf, x: srv.b.x, y: srv.b.y, z: srv.b.z, yaw: srv.b.yaw, vy: srv.b.velocityY, grounded: srv.b.grounded, seq: srv.sb };
        bSnaps.push(bS);
        interp.addState({ x: bS.x, y: bS.y, z: bS.z, yaw: bS.yaw, velocityY: bS.vy, grounded: bS.grounded }, vt);

        const buf = sender.getInputsAfter(aS.seq);
        pred.onServerState({ x: aS.x, y: aS.y, z: aS.z, yaw: aS.yaw, velocityY: aS.vy, grounded: aS.grounded, sequence: aS.seq }, buf);
        sender.pruneUpTo(aS.seq);
      }
    }

    // A's y should have changed after the jump at frame 5
    // (At frame 5, A should be airborne: y > groundY)
    expect(predA[5].y).toBeGreaterThan(VERTICAL_MOVEMENT.groundY);
    expect(predA[5].z).toBeLessThan(predA[4].z); // still moving forward

    // B's position is independent of A's jump
    expect(srv.a.y).toBeGreaterThanOrEqual(VERTICAL_MOVEMENT.groundY);
    expect(srv.b.z).toBeLessThan(0); // B moved forward independently
  });
});
