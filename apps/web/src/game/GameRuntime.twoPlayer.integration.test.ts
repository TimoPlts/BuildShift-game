import { describe, expect, it } from "vitest";
import {
  InputSender, LocalPlayerPrediction, RemotePlayerInterpolation,
  TwoPlayerClient, SIMULATION_TICK_SECONDS, INPUT_BUFFER_SIZE,
  CORRECTION_SNAP_THRESHOLD, type InputSample,
} from "../network/twoPlayer";
import type { PlayerNetworkInput, PlayerNetworkState } from "@buildshift/protocol";
import {
  movementInputToWorld, stepFullMovement, type FullMovementState,
} from "@buildshift/simulation";
import { PLAYER_MOVEMENT, VERTICAL_MOVEMENT } from "@buildshift/game-config";

const TICK = SIMULATION_TICK_SECONDS;
const N = 72;
const DI = 3;
const DL = 2;
const FMS = TICK * 1000;
const HS = { moveSpeed: PLAYER_MOVEMENT.moveSpeed };
const VS = {
  gravity: VERTICAL_MOVEMENT.gravity,
  jumpVelocity: VERTICAL_MOVEMENT.jumpVelocity,
  maxFallSpeed: VERTICAL_MOVEMENT.maxFallSpeed,
  groundY: VERTICAL_MOVEMENT.groundY,
  jumpSpeed: VERTICAL_MOVEMENT.jumpVelocity,
};

function mkInput(seq: number, mx: number, mz: number, yaw: number): PlayerNetworkInput {
  return { sequence: seq, moveX: mx, moveZ: mz, lookYaw: yaw, lookPitch: 0, jump: false, sprint: false, crouch: false, primaryFire: false, secondaryFire: false };
}

function step(s: FullMovementState, mx: number, mz: number, yaw: number): FullMovementState {
  const w = movementInputToWorld({ x: mx, z: mz }, yaw);
  return stepFullMovement(s, w, { jump: false }, TICK, HS, VS);
}

function toNet(s: FullMovementState, seq: number): PlayerNetworkState {
  return { x: s.x, y: s.y, z: s.z, vx: 0, vy: s.velocityY, vz: 0, sequence: seq, yaw: s.yaw, pitch: 0 };
}

class FakeServer {
  a: FullMovementState = { x: 0, y: VERTICAL_MOVEMENT.groundY, z: 0, yaw: 0, velocityY: 0, grounded: true };
  b: FullMovementState = { x: 0, y: VERTICAL_MOVEMENT.groundY, z: 0, yaw: 0, velocityY: 0, grounded: true };
  sa = -1; sb = -1;

  tick(ia: PlayerNetworkInput, ib: PlayerNetworkInput): void {
    if (ia.sequence > this.sa) { this.a = step(this.a, ia.moveX, ia.moveZ, ia.lookYaw); this.sa = ia.sequence; }
    if (ib.sequence > this.sb) { this.b = step(this.b, ib.moveX, ib.moveZ, ib.lookYaw); this.sb = ib.sequence; }
  }
}

describe("TwoPlayerClient integration (72 frames, two peers)", () => {
  it("prediction, reconciliation, and interpolation stay consistent", () => {
    const client = new TwoPlayerClient();
    const sender = new InputSender();
    const pred = new LocalPlayerPrediction();
    const interp = new RemotePlayerInterpolation();
    const server = new FakeServer();

    const hist: { A: PlayerNetworkState; B: PlayerNetworkState }[] = [];
    const recons: { f: number; ack: number; d: number }[] = [];
    const rpos: number[] = [];
    let vt = 0;

    for (let f = 0; f < N; f++) {
      vt += FMS;
      const sample: InputSample = { moveX: 0, moveZ: -1, yaw: 0, pitch: 0, jump: false, crouch: false };
      const p = pred.predict(sample);
      const sent = sender.send(sample, client, { x: p.x, y: p.y, z: p.z, velocityY: p.velocityY, grounded: p.grounded });
      const ib = mkInput(f, -1, 0, 0);
      server.tick(sent, ib);
      hist.push({ A: toNet(server.a, server.sa), B: toNet(server.b, server.sb) });

      if (f >= DL && f % DI === DI - 1) {
        const lag = hist[f - DL];
        const buffered = sender.getInputsAfter(lag.A.sequence);
        const cd = pred.onServerState(
          { x: lag.A.x, y: lag.A.y, z: lag.A.z, yaw: lag.A.yaw, velocityY: lag.A.vy, grounded: true, sequence: lag.A.sequence },
          buffered,
        );
        if (cd !== null) recons.push({ f, ack: lag.A.sequence, d: cd });
        sender.pruneUpTo(lag.A.sequence);
        interp.addState({ x: lag.B.x, y: lag.B.y, z: lag.B.z, yaw: lag.B.yaw, velocityY: lag.B.vy, grounded: false }, vt);
      }

      if (interp.hasData) rpos.push(interp.getInterpolated(vt).x);
    }

    const fs = pred.getCurrentState();
    const expZ = -PLAYER_MOVEMENT.moveSpeed * TICK * N;
    expect(fs.z).toBeCloseTo(expZ, 4);
    expect(fs.x).toBeCloseTo(0, 8);
    expect(fs.grounded).toBe(true);
    expect(recons.length).toBeGreaterThanOrEqual(20);
    for (const r of recons) expect(r.d).toBeLessThan(CORRECTION_SNAP_THRESHOLD);
    for (let i = 1; i < recons.length; i++) expect(recons[i].ack).toBeGreaterThan(recons[i - 1].ack);
    expect(rpos.length).toBeGreaterThanOrEqual(20);
    for (let i = 1; i < rpos.length; i++) expect(rpos[i]).toBeGreaterThanOrEqual(rpos[i - 1] - 1e-9);
    expect(rpos[rpos.length - 1]).toBeGreaterThan(0);
    expect(sender.nextSequence).toBe(N);
    expect(sender.bufferLength).toBeLessThanOrEqual(INPUT_BUFFER_SIZE);
    const lastAck = recons.length > 0 ? recons[recons.length - 1].ack : -1;
    expect(pred.lastAckSequence).toBe(lastAck);
  });

  it("snaps on large divergence", () => {
    const client = new TwoPlayerClient();
    const sender = new InputSender();
    const pred = new LocalPlayerPrediction();
    for (let i = 0; i < 5; i++) {
      const s: InputSample = { moveX: 0, moveZ: -1, yaw: 0, pitch: 0, jump: false, crouch: false };
      const p = pred.predict(s);
      sender.send(s, client, { x: p.x, y: p.y, z: p.z, velocityY: p.velocityY, grounded: p.grounded });
    }
    const sv = { x: 2.0, y: VERTICAL_MOVEMENT.groundY, z: -PLAYER_MOVEMENT.moveSpeed * TICK * 3, yaw: 0, velocityY: 0, grounded: true, sequence: 2 };
    const buf = sender.getInputsAfter(2);
    const d = pred.onServerState(sv, buf);
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(CORRECTION_SNAP_THRESHOLD);
    expect(pred.getCurrentState().x).toBeCloseTo(2.0, 6);
  });
});
