/**
 * InputBatcher sequence-lifecycle regression tests.
 *
 * Locks in the session-lifetime input-sequence contract that mirrors the
 * authoritative room (TwoPlayerMovementRoom):
 *
 *  - the sequence is monotonic for the lifetime of a session;
 *  - an authoritative round/match boundary within the same session
 *    discards unacknowledged inputs WITHOUT restarting the sequence
 *    (restart = the cross-round input freeze, where every new frame is
 *    rejected as stale against the room's retained lastProcessedSequence);
 *  - only a NEW session ((re)connect) restarts the sequence from 0 —
 *    matching the room re-baselining lastProcessedSequence to -1 for a
 *    fresh join.
 */
import { describe, expect, it } from "vitest";
import type { NetworkClient } from "./NetworkClient";
import { InputBatcher, type InputSample } from "./inputBatcher";

/** A no-op transport: records every input frame handed to it. */
class RecordingClient {
  public readonly sent: number[] = [];
  public sendInput(input: { sequence: number }): void {
    this.sent.push(input.sequence);
  }
}

const SAMPLE: InputSample = {
  moveX: 0,
  moveZ: 1,
  yaw: 0,
  pitch: 0,
  jump: false,
  crouch: false,
  primaryFire: false,
};

function predicted() {
  return { x: 0, y: 0, z: 0, velocityY: 0, grounded: true };
}

describe("InputBatcher sequence lifecycle", () => {
  it("assigns monotonically increasing sequences from 0", () => {
    const client = new RecordingClient();
    const batcher = new InputBatcher();
    for (let i = 0; i < 5; i++) {
      const input = batcher.send(SAMPLE, client as unknown as NetworkClient, predicted());
      expect(input.sequence).toBe(i);
    }
    expect(batcher.nextSequence).toBe(5);
    expect(batcher.lastSentSequence).toBe(4);
    expect(client.sent).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps the sequence monotonic across a round/match boundary discard", () => {
    // Round 1: send a stretch of inputs (the session's sequence climbs).
    const client = new RecordingClient();
    const batcher = new InputBatcher();
    for (let i = 0; i < 4; i++) {
      batcher.send(SAMPLE, client as unknown as NetworkClient, predicted());
    }
    expect(batcher.nextSequence).toBe(4);

    // Authoritative round reset (same session): the room keeps its
    // lastProcessedSequence, so the client must discard unacknowledged
    // inputs but MUST NOT restart the counter.
    batcher.discardUnacknowledged();

    // Round 2 begins: the next input continues the monotonic sequence.
    const next = batcher.send(SAMPLE, client as unknown as NetworkClient, predicted());
    expect(next.sequence).toBe(4);
    expect(batcher.nextSequence).toBe(5);

    // Repeated boundaries (round 3, match end, rematch) keep advancing.
    batcher.discardUnacknowledged();
    const afterSecond = batcher.send(SAMPLE, client as unknown as NetworkClient, predicted());
    expect(afterSecond.sequence).toBe(5);

    // The session-lifetime counter is still intact afterwards.
    expect(batcher.lastSentSequence).toBe(5);
    expect(client.sent).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("discards unacknowledged inputs so reconciliation replays nothing stale", () => {
    const client = new RecordingClient();
    const batcher = new InputBatcher();
    for (let i = 0; i < 5; i++) {
      batcher.send(SAMPLE, client as unknown as NetworkClient, predicted());
    }
    // Server acknowledged up to sequence 2 (round 1's last processed frame).
    expect(batcher.getInputsAfter(2).map((e) => e.input.sequence)).toEqual([3, 4]);
    expect(batcher.pruneUpTo(2)).toBe(3); // 0, 1, 2 pruned

    // Round boundary: unacknowledged 3 and 4 were never processed by the
    // room (it clears its pending buffer at the boundary) — dropping them
    // prevents reconciliation from replaying them on the spawn position.
    batcher.discardUnacknowledged();
    expect(batcher.getInputsAfter(2)).toEqual([]);
    expect(batcher.bufferLength).toBe(0);

    // The next round's inputs are the only ones reconciliation can replay,
    // and they carry the continuing sequences.
    const a = batcher.send(SAMPLE, client as unknown as NetworkClient, predicted());
    const b = batcher.send(SAMPLE, client as unknown as NetworkClient, predicted());
    expect(batcher.getInputsAfter(2).map((e) => e.input.sequence)).toEqual([
      a.sequence,
      b.sequence,
    ]);
  });

  it("restarts the sequence from 0 only for a new session ((re)connect)", () => {
    const client = new RecordingClient();
    const batcher = new InputBatcher();
    for (let i = 0; i < 10; i++) {
      batcher.send(SAMPLE, client as unknown as NetworkClient, predicted());
    }
    expect(batcher.nextSequence).toBe(10);

    // A (re)connect is a NEW session: the room re-baselines
    // lastProcessedSequence to -1, so the local sequence restarts from 0.
    batcher.reset();
    expect(batcher.nextSequence).toBe(0);
    expect(batcher.lastSentSequence).toBe(-1);
    expect(batcher.bufferLength).toBe(0);

    const first = batcher.send(SAMPLE, client as unknown as NetworkClient, predicted());
    expect(first.sequence).toBe(0);
  });
});
